import { notifySendInternalInputSchema } from "@factory/contracts";
import type { TokenGrant } from "../proxy/tokens.js";
import { assertActiveGrant, McpToolError } from "../mcp/security.js";
import { createToolPolicy } from "../mcp/policy.js";
import type { ToolResult } from "../mcp/tools.js";
import { createIdGenerator } from "../ids.js";
import { sendInternalNotification, type StandingDeps } from "./service.js";

export function createStandingApprovalMcp(deps: StandingDeps) {
  const policy = createToolPolicy(deps.raw), newId = createIdGenerator(deps.clock);
  const result = (text: string, isError = false): ToolResult => ({ content: [{ type: "text", text }], isError });
  return { call(grant: TokenGrant, name: string, input: unknown): ToolResult {
    if (name !== "notify.send-internal" || !policy(grant).allows(name)) return result("tool is not available", true);
    try {
      return deps.hub.transaction(() => {
        const now = deps.clock();
        assertActiveGrant(deps.raw, grant, now);
        const parsed = notifySendInternalInputSchema.safeParse(input);
        if (!parsed.success) return result("invalid tool input", true);
        // Team identity is pinned to the granted attempt's seat, never an argument or a mutable task assignment.
        const seat = deps.raw.prepare(`SELECT s.team_id FROM attempt_seats a JOIN seats s ON s.id=a.seat_id
          WHERE a.project_id=? AND a.attempt_id=?`).get(grant.projectId, grant.attemptId) as { team_id: string } | undefined;
        const sent = sendInternalNotification(deps, { ...parsed.data, projectId: grant.projectId,
          ...(seat === undefined ? {} : { teamId: seat.team_id }), now, id: newId() });
        return sent.allowed ? result("notification sent") : result(`standing approval refused: ${sent.reason}`, true);
      });
    } catch (error) {
      return result(error instanceof McpToolError ? error.reason : "tool could not be completed", true);
    }
  } };
}
