import { workflowPatchSchema } from "@factory/contracts";
import type { TokenGrant } from "../proxy/tokens.js";
import { assertActiveGrant, McpToolError } from "../mcp/security.js";
import { createToolPolicy } from "../mcp/policy.js";
import type { ToolResult } from "../mcp/tools.js";
import type { WorkflowEngineDeps } from "./engine.js";
import { PatchError, proposePatch } from "./patch.js";

export function createWorkflowPatchMcp(deps: WorkflowEngineDeps) {
  const calls = new Map<string, number>();
  const policy = createToolPolicy(deps.raw);
  const result = (text: string, isError = false): ToolResult => ({ content: [{ type: "text", text }], isError });
  return { call(grant: TokenGrant, name: string, input: unknown): ToolResult {
    if (name !== "workflow.patch" || !policy(grant).allows(name)) return result("tool is not available", true);
    try {
      return deps.hub.transaction(() => {
        assertActiveGrant(deps.raw, grant, deps.clock());
        const link = deps.raw.prepare("SELECT instance_id FROM workflow_stage_tasks WHERE project_id = ? AND task_id = ?")
          .get(grant.projectId, grant.taskId) as { instance_id: string } | undefined;
        if (!link) return result("tool is not available", true);
        const used = calls.get(grant.attemptId) ?? 0;
        if (used >= 20) return result("tool limit reached", true);
        calls.set(grant.attemptId, used + 1);
        const parsed = workflowPatchSchema.safeParse(input);
        if (!parsed.success) return result("invalid tool input", true);
        const patch = proposePatch(deps, { projectId: grant.projectId, instanceId: link.instance_id,
          ...parsed.data, proposedBy: "lead", sourceTaskId: grant.taskId });
        return result(JSON.stringify({ number: patch.number, state: patch.state, ...(patch.refusal === null ? {} : { refusal: patch.refusal }) }));
      });
    } catch (error) {
      return result(error instanceof McpToolError ? error.reason : error instanceof PatchError ? "patch could not be proposed" : "tool could not be completed", true);
    }
  } };
}
