import type { Database } from "better-sqlite3";
import { projectBriefingInputSchema } from "@factory/contracts";
import type { ContentStore } from "../artifacts/content-store.js";
import type { TokenGrant } from "../proxy/tokens.js";
import type { ToolResult } from "../mcp/tools.js";
import { assertActiveGrant, McpToolError } from "../mcp/security.js";
import { knowledgeScopeForGrant } from "../knowledge/mcp.js";
import { buildBriefing } from "./briefing.js";

export function createBriefingMcp(deps: { raw: Database; store: ContentStore; now: () => Date }) {
  const calls = new Map<string,number>();
  const result = (text: string,isError = false): ToolResult => ({ content: [{ type: "text",text }],isError });
  return { call(grant: TokenGrant,_name: string,input: unknown): ToolResult {
    try {
      assertActiveGrant(deps.raw,grant,deps.now());
      const key = `${grant.projectId}:${grant.attemptId}`; const used = calls.get(key) ?? 0;
      if (used >= 100) return result("tool limit reached",true);
      calls.set(key,used+1);
      if (!projectBriefingInputSchema.safeParse(input).success) return result("invalid tool input",true);
      const view = { apiVersion: 1,ok: true,...buildBriefing(deps.raw,{ projectId: grant.projectId,now: deps.now(),
        scope: knowledgeScopeForGrant(deps.raw,grant),store: deps.store }) };
      const size = (): number => Buffer.byteLength(JSON.stringify(view));
      for (const change of Object.values(view.changes)) while (size()>48000 && change.examples.length) change.examples.pop();
      while (size()>48000 && view.freshness.stale.length) view.freshness.stale.pop();
      while (size()>48000 && view.freshness.awaitingReview.length) view.freshness.awaitingReview.pop();
      while (size()>48000 && view.teams.length) view.teams.pop();
      return size() <= 48000 ? result(JSON.stringify(view)) : result("briefing unavailable",true);
    } catch (error) { return result(error instanceof McpToolError ? error.reason : "briefing unavailable",true); }
  } };
}
