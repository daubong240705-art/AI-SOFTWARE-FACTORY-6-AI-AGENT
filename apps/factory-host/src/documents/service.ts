import type { Database } from "better-sqlite3";
import type { ContentStore } from "../artifacts/content-store.js";
import type { KnowledgeIndex } from "../knowledge/index.js";
import { converterFor, extractionPolicy, extractText } from "./policy.js";
import { docWorkerConfig, type DocWorkerConfig } from "./config.js";
import { ExtractionError, fitResult } from "./result.js";
import { runDocumentWorker } from "./runner.js";
import { extractionRecord, extractionText, type ExtractionKey } from "./records.js";

export function createExtractionService(deps: {
  raw: Database; store: ContentStore; knowledge: KnowledgeIndex; config?: DocWorkerConfig; now?: () => Date;
}) {
  const { raw, store, knowledge } = deps; const config = deps.config ?? docWorkerConfig({});
  const clock = () => (deps.now?.() ?? new Date()).toISOString();
  const controller = new AbortController();
  let closed = false; let timer: ReturnType<typeof setImmediate> | undefined; let active: Promise<void> | undefined;
  const schedule = (): void => {
    if (!closed && !timer && !active) timer = setImmediate(() => {
      timer = undefined;
      active = pump().catch(() => { /* Rows remain recoverable after storage failure. */ }).finally(() => { active = undefined; });
    });
  };
  const enqueue = (projectId: string, artifactId: string, version: number): void => {
    const row = raw.prepare("SELECT media_type AS media FROM artifact_versions WHERE project_id=? AND artifact_id=? AND version=?")
      .get(projectId, artifactId, version) as { media: string } | undefined;
    if (!row || closed) return;
    const choice = converterFor(row.media); const stamp = clock();
    raw.prepare(`INSERT OR IGNORE INTO document_extractions(project_id,artifact_id,version,status,converter,converter_version,created_at,updated_at)
      VALUES (?,?,?,'pending',?,?,?,?)`).run(projectId, artifactId, version, choice.converter, choice.version, stamp, stamp);
    schedule();
  };
  const finish = (key: ExtractionKey, status: string, error: string): void => {
    raw.prepare("UPDATE document_extractions SET status=?,error_code=?,updated_at=? WHERE project_id=? AND artifact_id=? AND version=?")
      .run(status, error, clock(), key.projectId, key.artifactId, key.version);
  };
  const perform = async (key: ExtractionKey): Promise<void> => {
    const artifact = raw.prepare("SELECT media_type AS media,content_hash AS hash FROM artifact_versions WHERE project_id=? AND artifact_id=? AND version=?")
      .get(key.projectId, key.artifactId, key.version) as { media: string; hash: string };
    const policy = extractionPolicy(artifact.media); const choice = converterFor(artifact.media);
    if (policy === "skip") { finish(key, "skipped", "not-text"); return; }
    if (policy === "worker" && !config.enabled) { finish(key, "skipped", "worker-disabled"); return; }
    const cached = raw.prepare(`SELECT e.pages,e.chars,e.outline_json,e.text_hash,e.metadata_json,e.warnings_json FROM document_extractions e JOIN artifact_versions v
      ON v.project_id=e.project_id AND v.artifact_id=e.artifact_id AND v.version=e.version
      WHERE v.content_hash=? AND v.media_type=? AND e.status='done' AND e.converter=? AND e.converter_version=? LIMIT 1`)
      .get(artifact.hash, artifact.media, choice.converter, choice.version) as
      { pages: number | null; chars: number; outline_json: string; text_hash: string; metadata_json: string; warnings_json: string } | undefined;
    const cachedBytes = cached ? store.get(cached.text_hash) : null;
    if (cached && cachedBytes !== null) {
      raw.transaction(() => {
        raw.prepare(`UPDATE document_extractions SET status='done',pages=?,chars=?,outline_json=?,text_hash=?,metadata_json=?,warnings_json=?,error_code=NULL,updated_at=?
          WHERE project_id=? AND artifact_id=? AND version=?`).run(cached.pages, cached.chars, cached.outline_json, cached.text_hash, cached.metadata_json, cached.warnings_json,
            clock(), key.projectId, key.artifactId, key.version);
        knowledge.indexExtracted(key.projectId, key.artifactId, key.version, cachedBytes.toString("utf8"));
      })(); return;
    }
    const bytes = store.get(artifact.hash); if (bytes === null) throw new ExtractionError("corrupt");
    let result;
    if (policy === "text") {
      try { result = extractText(bytes); } catch { throw new ExtractionError("corrupt"); }
    } else {
      const run = await runDocumentWorker(bytes, artifact.media, config, { signal: controller.signal });
      if (run.status === "skipped") { finish(key, "skipped", run.errorCode); return; }
      result = run.result;
    }
    if (closed) return;
    result = fitResult(result, store.maxObjectBytes ?? 8 * 1024 * 1024);
    const content = store.put(result.markdown);
    raw.transaction(() => {
      raw.prepare(`UPDATE document_extractions SET status='done',pages=?,chars=?,outline_json=?,text_hash=?,metadata_json=?,warnings_json=?,error_code=NULL,updated_at=?
        WHERE project_id=? AND artifact_id=? AND version=?`).run(result.pages, result.markdown.length, JSON.stringify(result.outline), content.hash,
          JSON.stringify(result.metadata), JSON.stringify(result.warnings), clock(), key.projectId, key.artifactId, key.version);
      knowledge.indexExtracted(key.projectId, key.artifactId, key.version, result.markdown);
    })();
  };
  const pump = async (): Promise<void> => {
    while (!closed) {
      const key = raw.prepare(`SELECT project_id AS projectId,artifact_id AS artifactId,version FROM document_extractions
        WHERE status='pending' ORDER BY created_at,project_id,artifact_id,version LIMIT 1`).get() as ExtractionKey | undefined;
      if (!key) return;
      raw.prepare("UPDATE document_extractions SET status='running',attempts=attempts+1,updated_at=? WHERE project_id=? AND artifact_id=? AND version=?")
        .run(clock(), key.projectId, key.artifactId, key.version);
      try { await perform(key); }
      catch (error) { if (!closed) finish(key, "failed", error instanceof ExtractionError ? error.code : "failed"); }
      if (closed) raw.prepare("UPDATE document_extractions SET status='pending' WHERE project_id=? AND artifact_id=? AND version=? AND status='running'")
        .run(key.projectId, key.artifactId, key.version);
    }
  };
  return {
    enqueue,
    get: (projectId: string, artifactId: string, version: number) => extractionRecord(raw, { projectId, artifactId, version }),
    text: (projectId: string, artifactId: string, version: number) => extractionText(raw, store, { projectId, artifactId, version }),
    retry(projectId: string, artifactId: string, version: number): boolean {
      if (closed) return false;
      const result = raw.prepare(`UPDATE document_extractions SET status='pending',error_code=NULL,updated_at=? WHERE project_id=? AND artifact_id=? AND version=?
        AND attempts<4 AND (status='failed' OR (status='skipped' AND error_code='worker-unavailable'))`)
        .run(clock(), projectId, artifactId, version);
      if (result.changes) schedule(); return Boolean(result.changes);
    },
    recover(): void {
      raw.prepare("UPDATE document_extractions SET status='pending',updated_at=? WHERE status='running'").run(clock());
      for (const key of raw.prepare(`SELECT v.project_id AS projectId,v.artifact_id AS artifactId,v.version FROM artifact_versions v WHERE NOT EXISTS
        (SELECT 1 FROM document_extractions e WHERE e.project_id=v.project_id AND e.artifact_id=v.artifact_id AND e.version=v.version)`).all() as ExtractionKey[])
        enqueue(key.projectId, key.artifactId, key.version);
      schedule();
    },
    async close(): Promise<void> { closed = true; if (timer) clearImmediate(timer); controller.abort(); await active; },
  };
}
export type ExtractionService = ReturnType<typeof createExtractionService>;
