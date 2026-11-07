import fs from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { Database } from "better-sqlite3";
import { ARTIFACT_TRANSITIONS, type ArtifactStatus } from "@factory/contracts";
import { assertInside } from "../workspace/paths.js";
import type { ContentStore } from "./content-store.js";

export interface ResultRef { artifactId: string; version: number; kind: string; contentHash: string }
export interface AttemptResultsInput {
  projectId: string; taskId: string; attemptId: string; epoch: number;
  outcome: "completed" | "failed"; summary: string | null;
}
export interface ArtifactVersionRecord {
  version: number; status: ArtifactStatus; mediaType: string; sizeBytes: number; contentHash: string;
  abstractL0: string; abstractL1: string | null; producedByAttemptId: string | null;
  supersedesVersion: number | null; createdAt: string;
}
export interface ArtifactRecord {
  artifactId: string; kind: string; title: string; versions: ArtifactVersionRecord[];
}
type VersionRow = ArtifactVersionRecord & { artifactId: string; kind: string; title: string };
const columns = `v.artifact_id AS artifactId, v.version, v.kind, v.title, v.status,
  v.media_type AS mediaType, v.size_bytes AS sizeBytes, v.content_hash AS contentHash,
  v.abstract_l0 AS abstractL0, v.abstract_l1 AS abstractL1, v.produced_by_attempt_id AS producedByAttemptId,
  v.supersedes_version AS supersedesVersion, v.created_at AS createdAt`;

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

const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const hashPattern = /^[0-9a-f]{64}$(?![\s\S])/;
const patchPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.patch$(?![\s\S])/i;
const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
function patchBytes(evidence: Record<string, unknown>, dir: string, attemptId: string): Buffer | null {
  if (evidence.patchSafe !== true || evidence.patchTruncated !== false || typeof evidence.patchFile !== "string"
    || !patchPattern.test(evidence.patchFile) || evidence.patchFile !== `${attemptId}.patch`
    || typeof evidence.patchSha256 !== "string" || !hashPattern.test(evidence.patchSha256)) return null;
  try {
    if (fs.lstatSync(dir).isSymbolicLink()) return null;
    const root = assertInside(dirname(dir), dir);
    const file = join(root, evidence.patchFile);
    if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) return null;
    const fd = fs.openSync(assertInside(root, file), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      if (!fs.fstatSync(fd).isFile() || fs.fstatSync(fd).size > 8 * 1024 * 1024) return null;
      const bytes = fs.readFileSync(fd);
      return digest(bytes) === evidence.patchSha256 ? bytes : null;
    } finally { fs.closeSync(fd); }
  } catch { return null; }
}
function summaryBytes(summary: string): Buffer {
  const bytes = Buffer.from(summary.trim());
  // A fatal decoder prevents cutting through a UTF-8 character at the byte limit.
  let end = Math.min(bytes.length, 32 * 1024);
  for (;;) {
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end)); return bytes.subarray(0, end); }
    catch { end--; }
  }
}

/** A savepoint rolls back ALL metadata on failure, while leaving the outcome transaction intact. */
export function registerAttemptResults(deps: {
  raw: Database; store: ContentStore; now: () => Date; newId: () => string; onError?: (error: Error) => void;
}, input: AttemptResultsInput & { evidenceDir: string }): ResultRef[] {
  try {
    return deps.raw.transaction(() => {
      const { raw, store } = deps;
      const task = raw.prepare(`SELECT t.code FROM tasks t JOIN attempts a ON a.project_id = t.project_id AND a.task_id = t.id
        WHERE t.project_id = ? AND t.id = ? AND a.id = ? AND a.epoch = ?`)
        .get(input.projectId, input.taskId, input.attemptId, input.epoch) as { code: string } | undefined;
      if (!task || raw.prepare("SELECT 1 FROM artifact_versions WHERE project_id = ? AND produced_by_attempt_id = ?")
        .get(input.projectId, input.attemptId)) return [];
      const rows = raw.prepare(`SELECT body_json FROM attempt_events WHERE project_id = ? AND attempt_id = ?
        AND kind = 'evidence' ORDER BY seq DESC`).all(input.projectId, input.attemptId) as { body_json: string }[];
      const evidence = rows.map((row) => object(JSON.parse(row.body_json) as unknown))
        .find((body) => body && Array.isArray(body.files) && "patchFile" in body && "patchSha256" in body);
      // Runtime-only evidence is not workspace evidence; it cannot produce Results.
      if (!evidence) return [];
      const created: ResultRef[] = [];
      const register = (role: "Changes" | "Summary", kind: "code-ref" | "other", media: string,
        bytes: Buffer, l0: string, l1: string | null): void => {
        const previous = raw.prepare(`SELECT v.artifact_id AS artifactId, v.version, v.status FROM artifact_versions v
          JOIN attempts a ON a.project_id = v.project_id AND a.id = v.produced_by_attempt_id
          WHERE v.project_id = ? AND a.task_id = ? AND v.kind = ? AND v.title LIKE ?
          ORDER BY v.version DESC LIMIT 1`)
          .get(input.projectId, input.taskId, kind, `${role} %`) as { artifactId: string; version: number; status: ArtifactStatus } | undefined;
        const artifactId = previous?.artifactId ?? deps.newId();
        const version = previous ? previous.version + 1 : 1;
        const content = store.put(bytes);
        if (previous && !["superseded", "rejected", "withdrawn"].includes(previous.status)) {
          raw.prepare("UPDATE artifact_versions SET status = 'superseded' WHERE project_id = ? AND artifact_id = ? AND version = ?")
            .run(input.projectId, artifactId, previous.version);
        }
        raw.prepare(`INSERT INTO artifact_versions (project_id, artifact_id, version, kind, title, media_type, content_hash,
          size_bytes, status, abstract_l0, abstract_l1, produced_by_attempt_id, supersedes_version, visibility, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'project', ?)`)
          .run(input.projectId, artifactId, version, kind, `${role} ${task.code} (epoch ${input.epoch})`.slice(0, 160), media,
            content.hash, content.size, input.outcome === "completed" ? "in-review" : "draft", l0, l1,
            input.attemptId, previous?.version ?? null, deps.now().toISOString());
        created.push({ artifactId, version, kind, contentHash: content.hash });
      };
      const patch = patchBytes(evidence, input.evidenceDir, input.attemptId);
      if (patch !== null) {
        const totals = object(evidence.totals);
        const count = (value: unknown): number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
        const l0 = `${count(totals?.files)} files changed, +${count(totals?.additions)} -${count(totals?.deletions)}`;
        const l1 = (evidence.files as unknown[]).map(object).filter((file) => file && typeof file.path === "string"
          && !/^(?:[\\/]|[a-z]:)/i.test(file.path) && !file.path.includes("\0") && typeof file.status === "string")
          .map((file) => `${String(file?.status)} ${String(file?.path)}`).join("\n").slice(0, 6000);
        register("Changes", "code-ref", "text/x-diff", patch, l0.slice(0, 400), l1 || null);
      }
      if (input.outcome === "completed" && input.summary?.trim()) {
        const bytes = summaryBytes(input.summary);
        register("Summary", "other", "text/markdown", bytes, (bytes.toString("utf8").split(/\r?\n/, 1)[0] ?? "Summary").trim().slice(0, 400) || "Summary", null);
      }
      return created;
    })();
  } catch {
    try { deps.onError?.(new Error("Artifact registration failed")); } catch { /* Observers cannot change outcomes. */ }
    return [];
  }
}

/** Follow contract edges to the requested status; final versions are untouched. */
export function setTaskArtifactStatus(raw: Database, input: {
  projectId: string; taskId: string; to: "approved" | "rejected" | "withdrawn" | "reviewed";
}): ResultRef[] {
  try {
    return raw.transaction(() => {
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
        for (const status of path.slice(1)) raw.prepare("UPDATE artifact_versions SET status = ? WHERE project_id = ? AND artifact_id = ? AND version = ?")
          .run(status, input.projectId, artifact.artifactId, version.version);
        refs.push({ artifactId: artifact.artifactId, version: version.version, kind: artifact.kind, contentHash: version.contentHash });
      }
      return refs;
    })();
  } catch { throw new Error("Artifact transition not allowed"); }
}
