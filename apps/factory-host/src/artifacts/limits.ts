import type { Database } from "better-sqlite3";

export interface DocumentConfig { maxBytes: number; quotaBytes: number }
export const DEFAULT_DOCUMENT_CONFIG: DocumentConfig = { maxBytes: 25 * 1024 * 1024, quotaBytes: 2 * 1024 * 1024 * 1024 };

/** Count every version, including superseded versions and duplicate content references. Call inside the write transaction. */
export function withinDocumentQuota(raw: Database, projectId: string, size: number, quota: number): boolean {
  const row = raw.prepare("SELECT COALESCE(SUM(size_bytes),0) AS used FROM artifact_versions WHERE project_id = ?")
    .get(projectId) as { used: number };
  return size <= quota - row.used;
}
