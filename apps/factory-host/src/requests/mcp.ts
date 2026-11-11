import { requestCreateInputSchema, requestGetInputSchema, requestReplyInputSchema } from "@factory/contracts";
import type { TokenGrant } from "../proxy/tokens.js";
import { assertActiveGrant, McpToolError } from "../mcp/security.js";
import { createRequest, getRequest, replyRequest, RequestError, type RequestDeps } from "./service.js";
import type { ToolResult } from "../mcp/tools.js";

export function createRequestsMcp(deps: RequestDeps) {
  const calls = new Map<string, number>();
  const result = (text: string, isError = false): ToolResult => ({ content: [{ type: "text", text }], isError });
  return { call(grant: TokenGrant, name: string, input: unknown): ToolResult {
    try {
      assertActiveGrant(deps.raw, grant, deps.now());
      if (!deps.multiTeam) return result("multi-team is disabled", true);
      const key = `${grant.projectId}:${grant.attemptId}`; const used = calls.get(key) ?? 0;
      if (used >= 100) return result("tool limit reached", true);
      calls.set(key, used + 1);
      if (name === "request.create") {
        const parsed = requestCreateInputSchema.safeParse(input);
        if (!parsed.success) return result("invalid tool input", true);
        return result(JSON.stringify(createRequest(deps, { grant, input: parsed.data })));
      }
      if (name === "request.reply") {
        const parsed = requestReplyInputSchema.safeParse(input);
        if (!parsed.success) return result("invalid tool input", true);
        return result(JSON.stringify(replyRequest(deps, { grant, ...parsed.data })));
      }
      if (name !== "request.get") return result("tool is not available", true);
      const parsed = requestGetInputSchema.safeParse(input);
      if (!parsed.success) return result("invalid tool input", true);
      const view = getRequest(deps.raw, { grantOrOperator: grant, requestId: parsed.data.requestId });
      // Keep the response under the relay's byte budget, including multibyte text.
      while (Buffer.byteLength(JSON.stringify(view)) > 48000 && view.thread.length) view.thread.shift();
      while (Buffer.byteLength(JSON.stringify(view)) > 48000 && view.deliverables.length) view.deliverables.pop();
      return result(JSON.stringify(view));
    } catch (error) {
      return result(error instanceof RequestError ? error.reason : error instanceof McpToolError ? error.reason : "request could not be completed", true);
    }
  } };
}
