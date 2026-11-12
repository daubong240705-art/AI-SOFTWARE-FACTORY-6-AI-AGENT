import type { Database } from "better-sqlite3";
import type { ContentStore } from "../artifacts/content-store.js";
import { cleanDocumentText, type OutlineEntry } from "./result.js";

export interface ExtractionKey { projectId: string; artifactId: string; version: number }
export interface ExtractionRecord {
  status: "pending" | "running" | "done" | "failed" | "skipped"; pages: number | null; chars: number | null;
  outline: OutlineEntry[]; converter: string; errorCode: string | null; updatedAt: string;
}
export function extractionSummary(raw: Database, key: ExtractionKey): Pick<ExtractionRecord, "status" | "pages"> | null {
  return raw.prepare("SELECT status,pages FROM document_extractions WHERE project_id=? AND artifact_id=? AND version=?")
    .get(key.projectId, key.artifactId, key.version) as Pick<ExtractionRecord, "status" | "pages"> | undefined ?? null;
}
export function extractionRecord(raw: Database, key: ExtractionKey): ExtractionRecord | null {
  const row = raw.prepare(`SELECT status,pages,chars,outline_json AS outlineJson,converter,error_code AS errorCode,updated_at AS updatedAt
    FROM document_extractions WHERE project_id=? AND artifact_id=? AND version=?`).get(key.projectId, key.artifactId, key.version) as
    (Omit<ExtractionRecord, "outline"> & { outlineJson: string }) | undefined;
  if (!row) return null;
  const { outlineJson, ...fields } = row;
  return { ...fields, outline: JSON.parse(outlineJson) as OutlineEntry[] };
}
export function extractionText(raw: Database, store: ContentStore, key: ExtractionKey): string | null {
  const row = raw.prepare("SELECT text_hash AS hash FROM document_extractions WHERE project_id=? AND artifact_id=? AND version=? AND status='done'")
    .get(key.projectId, key.artifactId, key.version) as { hash: string | null } | undefined;
  if (!row?.hash) return null;
  const bytes = store.get(row.hash); return bytes === null ? null : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
/** Offsets refer to stored text, before redaction changes its length. */
export function textWindow(text: string, from: number, limit: number, until = text.length) {
  const start = Math.min(text.length, Math.max(0, from)); const end = Math.max(start, Math.min(text.length, until, start + limit));
  return { text: cleanDocumentText(text.slice(start, end)).slice(0, limit), from: start, next: end < until ? end : null, total: text.length };
}
