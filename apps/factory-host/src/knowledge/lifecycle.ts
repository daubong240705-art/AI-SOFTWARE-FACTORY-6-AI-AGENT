import type { Database } from "better-sqlite3";
import { canTransitionArtifact, type ArtifactStatus, type EntityRef } from "@factory/contracts";
import { visibleToScope, type KnowledgeScope } from "./permissions.js";
import { sanitizeAgentText } from "../mcp/security.js";

export class ArtifactLifecycleError extends Error {
  constructor(readonly code: "not-found" | "transition-not-allowed" | "not-latest" | "visibility-not-allowed" | "validation") {
    super(code);
  }
}
interface VersionKey { projectId: string; artifactId: string; version: number }
export interface StaleReason { becauseArtifactId: string; becauseVersion: number; since: string }
export interface StaleItem extends StaleReason { artifactId: string; version: number; title: string }
const effect = (artifactId: string, version: number): EntityRef => ({ kind: "artifact-version", id: artifactId, revision: version });
const unique = (entities: EntityRef[]): EntityRef[] => [...new Map(entities.map((e) => [`${e.kind}:${e.id}:${e.revision}`, e])).values()];

// A synchronous collector lets existing review/registration callers include every lifecycle
// change in their own transaction's events, without publishing before commit or on replay.
const collectors = new WeakMap<Database, EntityRef[]>();
export function collectLifecycleChanges<T>(raw: Database, run: () => T): { result: T; effects: EntityRef[] } {
  const parent = collectors.get(raw); const changes: EntityRef[] = [];
  collectors.set(raw, changes);
  try {
    const result = run();
    parent?.push(...changes);
    return { result, effects: unique(changes) };
  } finally {
    if (parent) collectors.set(raw, parent); else collectors.delete(raw);
  }
}
function changed(raw: Database, entities: EntityRef[]): EntityRef[] {
  const effects = unique(entities); collectors.get(raw)?.push(...effects); return effects;
}
function versionOf(raw: Database, input: VersionKey): { status: ArtifactStatus; visibility: string } {
  if (!Number.isSafeInteger(input.version) || input.version < 1) throw new ArtifactLifecycleError("validation");
  const row = raw.prepare("SELECT status, visibility FROM artifact_versions WHERE project_id = ? AND artifact_id = ? AND version = ?")
    .get(input.projectId, input.artifactId, input.version) as { status: ArtifactStatus; visibility: string } | undefined;
  if (!row) throw new ArtifactLifecycleError("not-found");
  return row;
}

/** Direct dependants only: the Lead decides what to redo; stale never propagates transitively. */
export function markDependantsStale(raw: Database, input: {
  projectId: string; artifactId: string; supersededVersion: number; byVersion: number; now: string;
}): EntityRef[] {
  const { projectId, artifactId, supersededVersion, byVersion, now } = input;
  const source = raw.prepare("SELECT title FROM artifact_versions WHERE project_id = ? AND artifact_id = ? AND version = ?")
    .get(projectId, artifactId, supersededVersion) as { title: string } | undefined;
  if (!source) throw new ArtifactLifecycleError("not-found");
  versionOf(raw, { projectId, artifactId, version: byVersion });
  const effects: EntityRef[] = [];
  const dependants = raw.prepare(`SELECT v.artifact_id AS artifactId, v.version FROM artifact_versions v JOIN artifact_inputs i
    ON i.project_id = v.project_id AND i.artifact_id = v.artifact_id AND i.version = v.version
    WHERE i.project_id = ? AND i.input_artifact_id = ? AND i.input_version = ?
      AND v.status NOT IN ('withdrawn','rejected','superseded') ORDER BY v.artifact_id, v.version`)
    .all(projectId, artifactId, supersededVersion) as { artifactId: string; version: number }[];
  const insert = raw.prepare("INSERT OR IGNORE INTO knowledge_stale VALUES (?,?,?,?,?,?)");
  for (const row of dependants) {
    if (insert.run(projectId, row.artifactId, row.version, artifactId, byVersion, now).changes)
      effects.push(effect(row.artifactId, row.version));
  }
  const tasks = raw.prepare(`SELECT t.id, t.revision FROM tasks t WHERE t.project_id = ?
    AND t.state NOT IN ('done','cancelled','declined','superseded') AND EXISTS (
      SELECT 1 FROM json_each(t.inputs_json) i WHERE json_extract(i.value, '$.artifactId') = ?
        AND json_extract(i.value, '$.version') = ?) ORDER BY t.id`)
    .all(projectId, artifactId, supersededVersion) as { id: string; revision: number }[];
  const reason = sanitizeAgentText(`Input ${source.title} v${supersededVersion} was superseded by v${byVersion}`).slice(0, 1000);
  for (const task of tasks) {
    const inserted = raw.prepare(`INSERT OR IGNORE INTO task_holds
      (project_id,task_id,kind,reason,ref_kind,ref_id,since,needs_action) VALUES (?,?,'input',?,'artifact-version',?,?,1)`)
      .run(projectId, task.id, reason, artifactId, now);
    if (!inserted.changes) continue;
    raw.prepare("UPDATE tasks SET revision = revision + 1 WHERE project_id = ? AND id = ?").run(projectId, task.id);
    effects.push({ kind: "task", id: task.id, revision: task.revision + 1 });
  }
  // Attempts are deliberately untouched, including running attempts.
  return changed(raw, effects);
}

export function transitionArtifactVersion(raw: Database, input: VersionKey & {
  to: ArtifactStatus; actorId: string; now: string;
}): EntityRef[] {
  const { projectId, artifactId, version, to } = input;
  const previous = versionOf(raw, input);
  if (!canTransitionArtifact(previous.status, to)) throw new ArtifactLifecycleError("transition-not-allowed");
  if (to === "approved" && raw.prepare(`SELECT 1 FROM artifact_versions WHERE project_id = ? AND artifact_id = ?
    AND version > ? AND status <> 'withdrawn' LIMIT 1`).get(projectId, artifactId, version))
    throw new ArtifactLifecycleError("not-latest");
  const effects: EntityRef[] = [effect(artifactId, version)];
  raw.prepare(`UPDATE artifact_versions SET status = ?, visibility = CASE
    WHEN ? = 'approved' AND visibility = 'team-draft' THEN 'project' ELSE visibility END
    WHERE project_id = ? AND artifact_id = ? AND version = ?`).run(to, to, projectId, artifactId, version);
  if (to === "approved") {
    const older = raw.prepare(`SELECT version FROM artifact_versions WHERE project_id = ? AND artifact_id = ?
      AND version <> ? AND status = 'approved' ORDER BY version`).all(projectId, artifactId, version) as { version: number }[];
    for (const row of older) {
      raw.prepare("UPDATE artifact_versions SET status = 'superseded' WHERE project_id = ? AND artifact_id = ? AND version = ?")
        .run(projectId, artifactId, row.version);
      effects.push(effect(artifactId, row.version), ...markDependantsStale(raw, {
        projectId, artifactId, supersededVersion: row.version, byVersion: version, now: input.now,
      }));
    }
  } else if (previous.status === "approved" && to === "superseded") {
    // Explicit invalidation has no replacement; the invalidated version is the stale reason.
    effects.push(...markDependantsStale(raw, { projectId, artifactId, supersededVersion: version, byVersion: version, now: input.now }));
  }
  return changed(raw, effects);
}

export function shareArtifactVersion(raw: Database, input: VersionKey & { visibility: "team-draft" | "project" | "shared" }): EntityRef[] {
  const row = versionOf(raw, input);
  if (["withdrawn", "rejected", "superseded"].includes(row.status)
    || (input.visibility === "shared" && row.status !== "approved")
    || (input.visibility === "team-draft" && row.status === "approved")) throw new ArtifactLifecycleError("visibility-not-allowed");
  const visibility = input.visibility === "shared" ? "organization" : input.visibility;
  if (visibility === row.visibility) return [];
  raw.prepare("UPDATE artifact_versions SET visibility = ? WHERE project_id = ? AND artifact_id = ? AND version = ?")
    .run(visibility, input.projectId, input.artifactId, input.version);
  return changed(raw, [effect(input.artifactId, input.version)]);
}

/** Registration historically replaces unfinished versions too; preserve that behavior. */
export function supersedeForRegistration(raw: Database, input: {
  projectId: string; artifactId: string; supersededVersion: number; byVersion: number; now: string;
}): EntityRef[] {
  const row = versionOf(raw, { ...input, version: input.supersededVersion });
  if (["superseded", "rejected", "withdrawn"].includes(row.status)) return [];
  raw.prepare("UPDATE artifact_versions SET status = 'superseded' WHERE project_id = ? AND artifact_id = ? AND version = ?")
    .run(input.projectId, input.artifactId, input.supersededVersion);
  return changed(raw, [effect(input.artifactId, input.supersededVersion),
    ...(row.status === "approved" ? markDependantsStale(raw, input) : [])]);
}

export function clearStale(raw: Database, input: VersionKey & { becauseArtifactId: string; becauseVersion: number }): EntityRef[] {
  versionOf(raw, input);
  if (!raw.prepare(`DELETE FROM knowledge_stale WHERE project_id = ? AND artifact_id = ? AND version = ?
    AND because_artifact_id = ? AND because_version = ?`)
    .run(input.projectId, input.artifactId, input.version, input.becauseArtifactId, input.becauseVersion).changes)
    throw new ArtifactLifecycleError("not-found");
  return changed(raw, [effect(input.artifactId, input.version)]);
}

export function versionStale(raw: Database, input: VersionKey, scope?: KnowledgeScope): StaleReason[] {
  const permission = scope ? visibleToScope(scope) : { sql: "1", params: [] };
  return raw.prepare(`SELECT s.because_artifact_id AS becauseArtifactId, s.because_version AS becauseVersion, s.since
    FROM knowledge_stale s JOIN artifact_versions v ON v.project_id = s.project_id
      AND v.artifact_id = s.because_artifact_id AND v.version = s.because_version
    WHERE s.project_id = ? AND s.artifact_id = ? AND s.version = ? AND ${permission.sql}
    ORDER BY s.since, s.because_artifact_id, s.because_version`)
    .all(input.projectId, input.artifactId, input.version, ...permission.params) as StaleReason[];
}
export function isVersionStale(raw: Database, input: VersionKey): boolean {
  return Boolean(raw.prepare("SELECT 1 FROM knowledge_stale WHERE project_id = ? AND artifact_id = ? AND version = ? LIMIT 1")
    .get(input.projectId, input.artifactId, input.version));
}
export function listStale(raw: Database, projectId: string): StaleItem[] {
  return raw.prepare(`SELECT s.artifact_id AS artifactId, s.version, v.title, s.because_artifact_id AS becauseArtifactId,
    s.because_version AS becauseVersion, s.since FROM knowledge_stale s JOIN artifact_versions v
    ON v.project_id = s.project_id AND v.artifact_id = s.artifact_id AND v.version = s.version
    WHERE s.project_id = ? ORDER BY s.since, s.artifact_id, s.version, s.because_artifact_id, s.because_version LIMIT 200`)
    .all(projectId) as StaleItem[];
}
