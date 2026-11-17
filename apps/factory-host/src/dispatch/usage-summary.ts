import type { Database } from "better-sqlite3";

export type Usage = {
  inputTokens: number | null; cachedInputTokens: number | null; outputTokens: number | null;
  reasoningOutputTokens: number | null; records: number;
};

/** A partial report cannot establish a total: SQLite SUM alone would hide NULLs. */
export function attemptUsage(raw: Database, projectId: string, attemptIds: string[]): Map<string, Usage> {
  if (!attemptIds.length) return new Map();
  const rows = raw.prepare(`SELECT attempt_id AS attemptId,
    CASE WHEN COUNT(input_tokens) = COUNT(*) THEN SUM(input_tokens) END AS inputTokens,
    CASE WHEN COUNT(cached_input_tokens) = COUNT(*) THEN SUM(cached_input_tokens) END AS cachedInputTokens,
    CASE WHEN COUNT(output_tokens) = COUNT(*) THEN SUM(output_tokens) END AS outputTokens,
    CASE WHEN COUNT(reasoning_output_tokens) = COUNT(*) THEN SUM(reasoning_output_tokens) END AS reasoningOutputTokens,
    COUNT(*) AS records FROM usage_records
    WHERE project_id = ? AND attempt_id IN (${attemptIds.map(() => "?").join(",")}) GROUP BY attempt_id`)
    .all(projectId, ...attemptIds) as Array<Usage & { attemptId: string }>;
  return new Map(rows.map(({ attemptId, ...usage }) => [attemptId, usage]));
}
