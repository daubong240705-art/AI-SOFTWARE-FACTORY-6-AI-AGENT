import type { Database } from "better-sqlite3";
import { ARTIFACT_TRANSITIONS, type ArtifactStatus } from "@factory/contracts";
import type { ContentStore } from "./content-store.js";
import { cleanArtifactSummary } from "./summary.js";
import { mediaKind, sniffMedia } from "./media.js";
import { DEFAULT_DOCUMENT_CONFIG, withinDocumentQuota, type DocumentConfig } from "./limits.js";
import type { TokenGrant } from "../proxy/tokens.js";
import { agentOutputInputSchema, type AgentOutputInput } from "../mcp/tools.js";
import { assertActiveGrant, McpToolError, readWorkspaceOutput, sanitizeAgentText } from "../mcp/security.js";
import { ArtifactLifecycleError, collectLifecycleChanges, supersedeForRegistration, transitionArtifactVersion } from "../knowledge/lifecycle.js";

export interface ResultRef { artifactId: string; version: number; kind: string; contentHash: string }
type AfterRegister = (ref: { projectId: string; artifactId: string; version: number }) => void;
export function afterRegister(hook: AfterRegister | undefined, projectId: string, artifactId: string, version: number): void {
  try { hook?.({ projectId, artifactId, version }); } catch { /* Missing index entries are recovered by backfill. */ }
}
export interface AttemptResultsInput {
  projectId: string; taskId: string; attemptId: string; epoch: number;
  outcome: "completed" | "failed"; summary: string | null;
}
export interface ArtifactVersionRecord {
  version: number; status: ArtifactStatus; mediaType: string; sizeBytes: number; contentHash: string;
  abstractL0: string; abstractL1: string | null; producedByAttemptId: string | null;
  supersedesVersion: number | null; createdAt: string; origin: "agent" | "upload"; fileName: string | null;
}
export interface ArtifactRecord {
  artifactId: string; kind: string; title: string; versions: ArtifactVersionRecord[];
}
type VersionRow = ArtifactVersionRecord & { artifactId: string; kind: string; title: string };
const columns = `v.artifact_id AS artifactId, v.version, v.kind, v.title, v.status,
  v.media_type AS mediaType, v.size_bytes AS sizeBytes, v.content_hash AS contentHash,
  v.abstract_l0 AS abstractL0, v.abstract_l1 AS abstractL1, v.produced_by_attempt_id AS producedByAttemptId,
  v.supersedes_version AS supersedesVersion, v.created_at AS createdAt, v.origin, v.file_name AS fileName`;

export function getArtifactVersion(raw: Database, projectId: string, artifactId: string, version: number): VersionRow | null {
  return raw.prepare(`SELECT ${columns} FROM artifact_versions v
    WHERE v.project_id = ? AND v.artifact_id = ? AND v.version = ?`).get(projectId, artifactId, version) as VersionRow | undefined ?? null;
}

export function listTaskArtifacts(raw: Database, projectId: string, taskId: string): ArtifactRecord[] {
  const rows = raw.prepare(`SELECT ${columns} FROM artifact_versions v JOIN attempts a
    ON a.project_id = v.project_id AND a.id = v.produced_by_attempt_id
    WHERE v.project_id = ? AND a.task_id = ? ORDER BY v.artifact_id, v.version DESC`).all(projectId, taskId) as VersionRow[];
  const artifacts = new Map<string, ArtifactRecord>();
  for (const { artifactId, kind, title, ...version } of rows) {
    let artifact = artifacts.get(artifactId);
    if (!artifact) { artifact = { artifactId, kind, title, versions: [] }; artifacts.set(artifactId, artifact); }
    artifact.versions.push(version);
  }
  return [...artifacts.values()];
}

/** Agent identity comes only from the authenticated grant, never from tool arguments. */
export function registerAgentOutput(deps: {
  raw: Database; store: ContentStore; now: () => Date; newId: () => string;
  afterRegister?: AfterRegister;
  documents?: DocumentConfig;
}, input: { grant: TokenGrant } & AgentOutputInput): ResultRef {
  const { raw, store } = deps;
  return collectLifecycleChanges(raw, () => raw.transaction(() => {
    const { grant } = input;
    assertActiveGrant(raw, grant);
    const { grant: _grant, ...fields } = input;
    const parsed = agentOutputInputSchema.safeParse(fields);
    if (!parsed.success) throw new McpToolError("output could not be registered");
    const data = parsed.data;
    const abstractL1 = cleanArtifactSummary(data.abstractL0, data.abstractL1);
    const count = raw.prepare(`SELECT COUNT(*) AS n FROM artifact_versions WHERE project_id = ? AND produced_by_attempt_id = ?`)
      .get(grant.projectId, grant.attemptId) as { n: number };
    if (count.n >= 50) throw new McpToolError("tool limit reached");
    for (const ref of data.inputs) {
      if (!getArtifactVersion(raw, grant.projectId, ref.artifactId, ref.version))
        throw new McpToolError("output could not be registered");
    }
    const documents = deps.documents ?? DEFAULT_DOCUMENT_CONFIG;
    const bytes = readWorkspaceOutput(grant, data.path, mediaKind(data.mediaType) === "binary" ? documents.maxBytes : 8 * 1024 * 1024);
    // Existing agent text outputs retain their strict decoder/JSON behavior and 8 MiB limit.
    if (["text/plain", "text/markdown", "application/json"].includes(data.mediaType)) {
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (data.mediaType === "application/json") JSON.parse(text) as unknown;
      } catch { throw new McpToolError("output could not be registered"); }
    } else if (!sniffMedia(data.mediaType, bytes)) throw new McpToolError("output could not be registered");
    if (!withinDocumentQuota(raw, grant.projectId, bytes.length, documents.quotaBytes))
      throw new McpToolError("output could not be registered");
    const title = sanitizeAgentText(data.title).trim() || "Output";
    const previous = data.kind === "dossier" ? raw.prepare(`SELECT artifact_id AS artifactId,version,status FROM artifact_versions
      WHERE project_id=? AND kind='dossier' ORDER BY created_at DESC,version DESC,artifact_id LIMIT 1`)
      .get(grant.projectId) as { artifactId: string; version: number; status: ArtifactStatus } | undefined
      : raw.prepare(`SELECT v.artifact_id AS artifactId, v.version, v.status FROM artifact_versions v
      JOIN attempts a ON a.project_id = v.project_id AND a.id = v.produced_by_attempt_id
      WHERE v.project_id = ? AND a.task_id = ? AND v.kind = ? AND v.title = ? ORDER BY v.version DESC LIMIT 1`)
      .get(grant.projectId, grant.taskId, data.kind, title) as { artifactId: string; version: number; status: ArtifactStatus } | undefined;
    // Filesystem and content-store operations are synchronous: the fence cannot change between these effects.
    assertActiveGrant(raw, grant);
    const content = store.put(bytes);
    const artifactId = previous?.artifactId ?? deps.newId();
    const version = (previous?.version ?? 0) + 1;
    raw.prepare(`INSERT INTO artifact_versions (project_id, artifact_id, version, kind, title, media_type, content_hash,
      size_bytes, status, abstract_l0, abstract_l1, produced_by_attempt_id, supersedes_version, visibility, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, 'project', ?)`)
      .run(grant.projectId, artifactId, version, data.kind, title, data.mediaType, content.hash, content.size,
        sanitizeAgentText(data.abstractL0), abstractL1,
        grant.attemptId, previous?.version ?? null, deps.now().toISOString());
    const insert = raw.prepare(`INSERT OR IGNORE INTO artifact_inputs (project_id, artifact_id, version, input_artifact_id, input_version)
      VALUES (?, ?, ?, ?, ?)`);
    for (const ref of data.inputs) insert.run(grant.projectId, artifactId, version, ref.artifactId, ref.version);
    if (previous) supersedeForRegistration(raw, {
      projectId: grant.projectId, artifactId, supersededVersion: previous.version, byVersion: version, now: deps.now().toISOString(),
    });
    afterRegister(deps.afterRegister, grant.projectId, artifactId, version);
    return { artifactId, version, kind: data.kind, contentHash: content.hash };
  }).immediate()).result;
}

/** A savepoint rolls back ALL metadata on failure, while leaving the outcome transaction intact. */
export function registerAttemptResults(deps: {
  raw: Database; store: ContentStore; now: () => Date; newId: () => string; onError?: (error: Error) => void;
  afterRegister?: AfterRegister;
}, input: AttemptResultsInput & { evidenceDir: string }): ResultRef[] {
  try {
    return collectLifecycleChanges(deps.raw, () => deps.raw.transaction(() => {
      const { raw } = deps;
      const task = raw.prepare(`SELECT t.code FROM tasks t JOIN attempts a ON a.project_id = t.project_id AND a.task_id = t.id
        WHERE t.project_id = ? AND t.id = ? AND a.id = ? AND a.epoch = ?`)
        .get(input.projectId, input.taskId, input.attemptId, input.epoch) as { code: string } | undefined;
      if (!task) return [];
      const created: ResultRef[] = [];
      if (input.outcome === "completed") {
        const drafts = raw.prepare(`SELECT artifact_id AS artifactId, version, kind, content_hash AS contentHash
          FROM artifact_versions WHERE project_id = ? AND produced_by_attempt_id = ? AND status = 'draft'`)
          .all(input.projectId, input.attemptId) as ResultRef[];
        raw.prepare(`UPDATE artifact_versions SET status = 'in-review' WHERE project_id = ? AND produced_by_attempt_id = ? AND status = 'draft'`)
          .run(input.projectId, input.attemptId);
        created.push(...drafts);
      }
      // Task summaries and workspace patches remain attempt records, never documents.
      // Only files explicitly registered through output.register enter Knowledge.
      return created;
    })()).result;
  } catch {
    try { deps.onError?.(new Error("Artifact registration failed")); } catch { /* Observers cannot change outcomes. */ }
    return [];
  }
}

/** Follow contract edges to the requested status; final versions are untouched. */
export function setTaskArtifactStatus(raw: Database, input: {
  projectId: string; taskId: string; to: "approved" | "rejected" | "withdrawn" | "reviewed"; multiTeam?: boolean;
}): ResultRef[] {
  try {
    return collectLifecycleChanges(raw, () => raw.transaction(() => {
      const refs: ResultRef[] = [];
      for (const artifact of listTaskArtifacts(raw, input.projectId, input.taskId)) {
        const version = artifact.versions[0];
        if (!version || !["draft", "in-review", "reviewed"].includes(version.status)) continue;
        const queue: ArtifactStatus[][] = [[version.status]];
        const seen = new Set<ArtifactStatus>();
        let path: ArtifactStatus[] | undefined;
        while (queue.length) {
          const candidate = queue.shift();
          const status = candidate?.at(-1);
          if (!candidate || !status || seen.has(status)) continue;
          seen.add(status);
          if (status === input.to) { path = candidate; break; }
          for (const next of ARTIFACT_TRANSITIONS[status]) queue.push([...candidate, next]);
        }
        if (!path) throw new Error("Artifact transition not allowed");
        for (const status of path.slice(1)) transitionArtifactVersion(raw, {
          projectId: input.projectId, artifactId: artifact.artifactId, version: version.version,
          to: status, actorId: "operator", now: new Date().toISOString(),
          ...(input.multiTeam === true ? { multiTeam: true } : {}),
        });
        refs.push({ artifactId: artifact.artifactId, version: version.version, kind: artifact.kind, contentHash: version.contentHash });
      }
      return refs;
    })()).result;
  } catch (error) {
    if (error instanceof ArtifactLifecycleError) throw error;
    throw new Error("Artifact transition not allowed");
  }
}
