import type { Database } from "better-sqlite3";
import { appendAttemptEvent } from "./attempts.js";

/** Older runtimes stored CLI/tool lifecycle chatter as progress. Keep it out of work reports. */
export const meaningfulProgressSql = (alias: string): string => `
  json_type(${alias}.body_json, '$.message') = 'text'
  AND trim(json_extract(${alias}.body_json, '$.message')) <> ''
  AND lower(trim(json_extract(${alias}.body_json, '$.message'))) NOT IN ('working', 'starting')
  AND lower(trim(json_extract(${alias}.body_json, '$.message'))) NOT LIKE 'tool:%'
  AND lower(trim(json_extract(${alias}.body_json, '$.message'))) NOT LIKE 'tool failed:%'`;
/** A repeated report still renews the caller's lease, but does not create another timeline entry. */
export function appendProgressReport(raw: Database, input: {
  projectId: string; attemptId: string; at: string; body: { type: "progress"; message: string; percent?: number };
}): void {
  const previous = raw.prepare(`SELECT json_extract(body_json, '$.message') AS message,
    json_extract(body_json, '$.percent') AS percent FROM attempt_events
    WHERE project_id = ? AND attempt_id = ? AND kind = 'progress' ORDER BY seq DESC LIMIT 1`)
    .get(input.projectId, input.attemptId) as { message: unknown; percent: unknown } | undefined;
  const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
  if (previous && typeof previous.message === "string" && normalize(previous.message) === normalize(input.body.message)
    && previous.percent === (input.body.percent ?? null)) return;
  appendAttemptEvent(raw, { ...input, kind: "progress" });
}
