import type { Database } from "better-sqlite3";
import type { ArtifactStatus } from "@factory/contracts";
import type { ContentStore } from "../artifacts/content-store.js";
import { visibleToScope, type KnowledgeScope, type SqlPredicate } from "./permissions.js";
import { buildMatchQuery, normalizeForSearch, snippetOf } from "./text.js";

export { visibleToScope, type KnowledgeScope } from "./permissions.js";
export interface KnowledgeQuery {
  query: string; kinds?: readonly string[] | undefined; statuses?: readonly string[] | undefined;
  latestOnly?: boolean | undefined; limit?: number | undefined; offset?: number | undefined;
}
export interface KnowledgeResult {
  artifactId: string; version: number; kind: string; title: string; status: ArtifactStatus;
  visibility: "team-draft" | "project" | "shared"; abstractL0: string; snippet: string; rank: number; projectId: string;
}
export interface KnowledgeGetInput { artifactId: string; version?: number | undefined; level?: "l0" | "l1" | "l2" | undefined }
export interface KnowledgeDocument extends Omit<KnowledgeResult, "rank" | "snippet"> {
  level: "l0" | "l1" | "l2"; text: string; sizeBytes: number; truncated: boolean;
}
export class KnowledgeError extends Error {
  constructor(readonly reason: "not found" | "content is not readable as text" | "search is temporarily unavailable") { super(reason); }
}
const readable = new Set(["text/markdown", "text/plain", "application/json"]);
const summaryColumns = `v.project_id AS projectId, v.artifact_id AS artifactId, v.version, v.kind, v.title, v.status,
  CASE v.visibility WHEN 'organization' THEN 'shared' ELSE v.visibility END AS visibility,
  v.abstract_l0 AS abstractL0`;
type StoredVersion = Omit<KnowledgeResult, "rank" | "snippet"> & {
  abstractL1: string | null; contentHash: string; mediaType: string; sizeBytes: number;
};

/** Decode all bytes strictly, then truncate at a UTF-8 boundary without introducing replacement characters. */
function textBytes(bytes: Buffer, limit: number): string {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  decoder.decode(bytes);
  let end = Math.min(bytes.length, limit);
  for (;;) {
    try { return decoder.decode(bytes.subarray(0, end)); } catch { end--; }
  }
}
function filters(query: { kinds?: readonly string[] | undefined; statuses?: readonly string[] | undefined }): SqlPredicate {
  const parts: string[] = []; const params: string[] = [];
  for (const [column, values] of [["v.kind", query.kinds], ["v.status", query.statuses]] as const) {
    if (values === undefined) continue;
    parts.push(values.length ? `${column} IN (${values.map(() => "?").join(",")})` : "0");
    params.push(...values);
  }
  return { sql: parts.length ? parts.join(" AND ") : "1", params };
}
const bounded = (value: number | undefined, fallback: number, min: number, max: number): number =>
  value !== undefined && Number.isSafeInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function createKnowledgeIndex({ raw, store }: { raw: Database; store: ContentStore }) {
  const indexVersion = (projectId: string, artifactId: string, version: number): boolean => raw.transaction(() => {
    const row = raw.prepare(`SELECT title, abstract_l0 AS l0, abstract_l1 AS l1,
      content_hash AS hash, media_type AS media FROM artifact_versions
      WHERE project_id = ? AND artifact_id = ? AND version = ?`).get(projectId, artifactId, version) as
      { title: string; l0: string; l1: string | null; hash: string; media: string } | undefined;
    if (!row) return false;
    let body = ""; let bodyIndexed = 0;
    if (readable.has(row.media)) {
      try {
        const bytes = store.get(row.hash);
        if (bytes !== null) { body = textBytes(bytes, 256 * 1024); bodyIndexed = 1; }
      } catch { /* Unverified or invalid text still has searchable metadata. */ }
    }
    raw.prepare("DELETE FROM knowledge_index WHERE project_id = ? AND artifact_id = ? AND version = ?")
      .run(projectId, artifactId, version);
    raw.prepare("INSERT INTO knowledge_index (title, abstract, body, project_id, artifact_id, version) VALUES (?,?,?,?,?,?)")
      .run(normalizeForSearch(row.title), normalizeForSearch(`${row.l0} ${row.l1 ?? ""}`), normalizeForSearch(body), projectId, artifactId, version);
    raw.prepare(`INSERT INTO knowledge_indexed (project_id, artifact_id, version, body_indexed, indexed_at) VALUES (?,?,?,?,?)
      ON CONFLICT(project_id, artifact_id, version) DO UPDATE SET body_indexed = excluded.body_indexed, indexed_at = excluded.indexed_at`)
      .run(projectId, artifactId, version, bodyIndexed, new Date().toISOString());
    return true;
  })();
  const missingSql = `FROM artifact_versions v WHERE NOT EXISTS (SELECT 1 FROM knowledge_indexed k
    WHERE k.project_id = v.project_id AND k.artifact_id = v.artifact_id AND k.version = v.version)`;
  const stats = () => {
    const versions = (raw.prepare("SELECT COUNT(*) AS n FROM artifact_versions").get() as { n: number }).n;
    const row = raw.prepare("SELECT COUNT(*) AS indexed, COALESCE(SUM(body_indexed),0) AS bodyIndexed FROM knowledge_indexed")
      .get() as { indexed: number; bodyIndexed: number };
    return { versions, ...row, missing: versions - row.indexed };
  };
  const indexAllMissing = ({ limit = 200 }: { limit?: number } = {}) => {
    const rows = raw.prepare(`SELECT v.project_id AS projectId, v.artifact_id AS artifactId, v.version ${missingSql}
      ORDER BY v.project_id, v.artifact_id, v.version LIMIT ?`).all(bounded(limit, 200, 1, 1000)) as
      { projectId: string; artifactId: string; version: number }[];
    const deadline = Date.now() + 1900; let indexed = 0;
    for (const row of rows) {
      if (Date.now() >= deadline) break;
      try { if (indexVersion(row.projectId, row.artifactId, row.version)) indexed++; }
      catch { /* Keep the missing marker for a later backfill. */ }
    }
    return { indexed, remaining: (raw.prepare(`SELECT COUNT(*) AS n ${missingSql}`).get() as { n: number }).n };
  };
  const search = (scope: KnowledgeScope, input: KnowledgeQuery | string, options: { maxLimit?: 20 | 50; projectOnly?: boolean } = {}): KnowledgeResult[] => {
    const query = typeof input === "string" ? { query: input } : input;
    const match = buildMatchQuery(query.query);
    if (!match) return [];
    const permission = visibleToScope(scope); const filter = filters(query);
    const newer = visibleToScope(scope, "newer");
    const latest = query.latestOnly === false ? "" : `AND v.status <> 'withdrawn' AND NOT EXISTS (
      SELECT 1 FROM artifact_versions newer WHERE newer.project_id = v.project_id AND newer.artifact_id = v.artifact_id
      AND newer.version > v.version AND newer.status <> 'withdrawn' AND ${newer.sql})`;
    const max = scope.viewer === "operator" ? options.maxLimit ?? 20 : 20;
    const rows = raw.prepare(`SELECT ${summaryColumns}, bm25(knowledge_index, 10.0, 5.0, 1.0) AS rank
      FROM knowledge_index JOIN artifact_versions v ON v.project_id = knowledge_index.project_id
        AND v.artifact_id = knowledge_index.artifact_id AND v.version = knowledge_index.version
      WHERE knowledge_index MATCH ? AND ${permission.sql} AND ${filter.sql} ${latest} ${options.projectOnly ? "AND v.project_id = ?" : ""}
      ORDER BY rank, v.version DESC, v.project_id, v.artifact_id LIMIT ? OFFSET ?`)
      .all(match, ...permission.params, ...filter.params, ...(query.latestOnly === false ? [] : newer.params),
        ...(options.projectOnly ? [scope.projectId] : []),
        bounded(query.limit, 10, 1, max), bounded(query.offset, 0, 0, Number.MAX_SAFE_INTEGER)) as Omit<KnowledgeResult, "snippet">[];
    return rows.map((row) => ({ ...row, snippet: snippetOf(row.abstractL0) }));
  };
  const get = (scope: KnowledgeScope, input: KnowledgeGetInput): KnowledgeDocument | null => {
    const permission = visibleToScope(scope);
    const row = raw.prepare(`SELECT ${summaryColumns}, v.abstract_l1 AS abstractL1, v.content_hash AS contentHash,
      v.media_type AS mediaType, v.size_bytes AS sizeBytes FROM artifact_versions v
      WHERE v.artifact_id = ? AND ${permission.sql} ${input.version === undefined ? "" : "AND v.version = ?"}
      ORDER BY (v.status = 'approved') DESC, v.version DESC, (v.project_id = ?) DESC, v.project_id LIMIT 1`)
      .get(input.artifactId, ...permission.params, ...(input.version === undefined ? [] : [input.version]), scope.projectId) as StoredVersion | undefined;
    if (!row) return null;
    const { abstractL1, contentHash, mediaType, ...summary } = row;
    const level = input.level ?? "l1";
    let text = level === "l0" ? row.abstractL0 : abstractL1 ?? row.abstractL0; let truncated = false;
    if (level === "l2") {
      if (!readable.has(mediaType)) throw new KnowledgeError("content is not readable as text");
      try {
        const bytes = store.get(contentHash);
        if (bytes === null || bytes.length !== row.sizeBytes) throw new Error();
        text = textBytes(bytes, 32 * 1024).replace(/[^\P{Cc}\n\t]|\p{Cf}/gu, " ");
        truncated = bytes.length > 32 * 1024;
      } catch { throw new KnowledgeError("not found"); }
    }
    return { ...summary, text, level, truncated };
  };
  const rebuild = async () => {
    raw.transaction(() => { raw.prepare("DELETE FROM knowledge_index").run(); raw.prepare("DELETE FROM knowledge_indexed").run(); })();
    for (;;) {
      const batch = indexAllMissing();
      if (!batch.remaining || !batch.indexed) return stats();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
  return { indexVersion, indexAllMissing, rebuild, search, get, stats,
    // Status and visibility are read from authoritative rows; K1b can use the same hook.
    afterStatusChange: indexVersion };
}
export type KnowledgeIndex = ReturnType<typeof createKnowledgeIndex>;

/** Operator browsing is always restricted to the route's project, even for shared documents. */
export function listKnowledgeArtifacts(raw: Database, scope: KnowledgeScope, query: Omit<KnowledgeQuery, "query"> = {}) {
  const permission = visibleToScope(scope); const filter = filters(query); const newer = visibleToScope(scope, "newer");
  return raw.prepare(`SELECT ${summaryColumns}, v.media_type AS mediaType, v.size_bytes AS sizeBytes,
    v.created_at AS createdAt, (SELECT COUNT(*) FROM artifact_versions newer
      WHERE newer.project_id = v.project_id AND newer.artifact_id = v.artifact_id AND ${newer.sql}) AS versionCount
    FROM artifact_versions v WHERE v.project_id = ? AND ${permission.sql} AND ${filter.sql}
      AND v.version = (SELECT MAX(newer.version) FROM artifact_versions newer
        WHERE newer.project_id = v.project_id AND newer.artifact_id = v.artifact_id AND ${newer.sql})
    ORDER BY v.created_at DESC, v.artifact_id LIMIT ? OFFSET ?`)
    .all(...newer.params, scope.projectId, ...permission.params, ...filter.params, ...newer.params,
      bounded(query.limit, 10, 1, 50), bounded(query.offset, 0, 0, Number.MAX_SAFE_INTEGER));
}

export function getKnowledgeArtifact(raw: Database, scope: KnowledgeScope, artifactId: string) {
  const permission = visibleToScope(scope);
  const versions = raw.prepare(`SELECT ${summaryColumns}, v.media_type AS mediaType, v.size_bytes AS sizeBytes,
    v.abstract_l1 AS abstractL1, v.produced_by_attempt_id AS producedByAttemptId,
    v.supersedes_version AS supersedesVersion, v.created_at AS createdAt
    FROM artifact_versions v WHERE v.project_id = ? AND v.artifact_id = ? AND ${permission.sql} ORDER BY v.version DESC`)
    .all(scope.projectId, artifactId, ...permission.params) as (Omit<StoredVersion, "contentHash"> & {
      producedByAttemptId: string | null; supersedesVersion: number | null; createdAt: string;
    })[];
  const first = versions[0]; if (!first) return null;
  const provenance = (dependants: boolean) => raw.prepare(`SELECT DISTINCT v.artifact_id AS artifactId, v.version, v.title
    FROM artifact_inputs i JOIN artifact_versions v ON v.project_id = i.project_id
      AND v.artifact_id = ${dependants ? "i.artifact_id" : "i.input_artifact_id"}
      AND v.version = ${dependants ? "i.version" : "i.input_version"}
    WHERE i.project_id = ? AND ${dependants ? "i.input_artifact_id" : "i.artifact_id"} = ? AND ${permission.sql}
    ORDER BY v.artifact_id, v.version`).all(scope.projectId, artifactId, ...permission.params) as
    { artifactId: string; version: number; title: string }[];
  return { artifactId, kind: first.kind, title: first.title, versions, inputs: provenance(false), dependants: provenance(true) };
}
