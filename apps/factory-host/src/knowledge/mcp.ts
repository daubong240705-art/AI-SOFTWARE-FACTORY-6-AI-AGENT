import type { Database } from "better-sqlite3";
import { artifactRefSchema, knowledgeGetInputSchema, knowledgeSearchInputSchema } from "@factory/contracts";
import { KnowledgeError, type KnowledgeIndex, type KnowledgeResult, type KnowledgeScope } from "./index.js";
import type { TokenGrant } from "../proxy/tokens.js";
import { assertActiveGrant, sanitizeAgentText } from "../mcp/security.js";
import type { ToolResult } from "../mcp/tools.js";

/** Identity and context grants come exclusively from the running task, never tool arguments. */
export function knowledgeScopeForGrant(raw: Database, grant: Pick<TokenGrant, "projectId" | "taskId" | "attemptId" | "epoch">): KnowledgeScope {
  const row = raw.prepare(`SELECT s.team_id AS teamId FROM attempt_seats a JOIN seats s ON s.id = a.seat_id
    WHERE a.project_id = ? AND a.attempt_id = ?`).get(grant.projectId, grant.attemptId) as { teamId: string } | undefined;
  const ctr = raw.prepare(`SELECT m.context_refs_json FROM tasks t JOIN ctr_meta m ON m.project_id = t.project_id AND m.task_id = t.id
    WHERE t.project_id = ? AND t.id = ? AND t.origin_kind = 'cross-team' AND m.triage_state = 'accepted'
      AND t.state NOT IN ('done','cancelled','declined','superseded')`).get(grant.projectId, grant.taskId) as { context_refs_json: string } | undefined;
  const parsed = artifactRefSchema.array().max(20).safeParse(ctr ? JSON.parse(ctr.context_refs_json) as unknown : []);
  return { projectId: grant.projectId, teamId: row?.teamId ?? null, viewer: "agent", grants: parsed.success ? parsed.data : [] };
}

/** Grant-derived knowledge reads, with an independent per-attempt read budget. */
export function createKnowledgeMcp(deps: { raw: Database; knowledge: KnowledgeIndex; now?: () => Date }) {
  const calls = new Map<string, number>();
  const scopeFor = (grant: TokenGrant): KnowledgeScope => {
    assertActiveGrant(deps.raw, grant, deps.now?.());
    return knowledgeScopeForGrant(deps.raw, grant);
  };
  const clean = <T extends Pick<KnowledgeResult, "title" | "abstractL0" | "projectId">>(row: T): Omit<T, "projectId"> => {
    const { projectId: _projectId, ...fields } = row;
    return { ...fields, title: sanitizeAgentText(row.title), abstractL0: sanitizeAgentText(row.abstractL0) };
  };
  const result = (text: string, isError = false): ToolResult => ({ content: [{ type: "text", text }], isError });
  return {
    call(grant: TokenGrant, name: string, input: unknown): ToolResult {
      try {
        const scope = scopeFor(grant);
        const key = `${grant.projectId}:${grant.attemptId}`;
        const used = calls.get(key) ?? 0;
        if (used >= 200) return result("tool limit reached", true);
        calls.set(key, used + 1);
        if (name === "knowledge.search") {
          const parsed = knowledgeSearchInputSchema.safeParse(input);
          if (!parsed.success) return result("invalid tool input", true);
          const limit = parsed.data.limit ?? 10; const offset = parsed.data.offset ?? 0;
          const rows = deps.knowledge.search(scope, parsed.data);
          const truncated = rows.length === limit && deps.knowledge.search(scope, { ...parsed.data, limit: 1, offset: offset + limit }).length > 0;
          return result(JSON.stringify({ results: rows.map((row) => ({ ...clean(row), snippet: sanitizeAgentText(row.snippet) })), truncated }));
        }
        const parsed = knowledgeGetInputSchema.safeParse(input);
        if (!parsed.success) return result("invalid tool input", true);
        const row = deps.knowledge.get(scope, parsed.data);
        if (!row) throw new KnowledgeError("not found");
        return result(JSON.stringify({ ...clean(row), text: row.level === "l2" ? row.text : sanitizeAgentText(row.text) }));
      } catch (error) {
        const reason = error instanceof KnowledgeError ? error.reason
          : error instanceof Error && error.message === "attempt is not active" ? "attempt is not active" : "search is temporarily unavailable";
        return result(reason, true);
      }
    },
  };
}

