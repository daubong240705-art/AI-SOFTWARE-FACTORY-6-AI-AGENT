import type { HandlerMap } from "../commands/pipeline.js";
import { CommandError } from "../commands/errors.js";
import { appendMessage, listConversations } from "../chat/service.js";

/** This wrapper runs inside approvals.decide's pipeline transaction. No remote call is allowed here. */
export function withPortalDecision(decide: HandlerMap["approvals.decide"]): HandlerMap["approvals.decide"] {
  return (ctx, command) => {
    const { raw, hub } = ctx, { projectId, payload } = command;
    const action = raw.prepare("SELECT id,game_id FROM portal_actions WHERE project_id=? AND approval_id=? AND state='proposed'")
      .get(projectId, payload.approvalId) as { id: string; game_id: string } | undefined;
    if (action && ctx.actorIsOperator !== true)
      throw new CommandError("forbidden", "Only the operator can approve Portal changes.", "correct-input");
    const result = decide(ctx, command);
    if (!action) return result;
    const rejected = payload.optionId === "reject", now = ctx.clock().toISOString();
    raw.prepare("UPDATE portal_actions SET state=?,decided_at=?,completed_at=? WHERE id=? AND state='proposed'")
      .run(rejected ? "rejected" : "running", now, rejected ? now : null, action.id);
    const conversation = listConversations(raw, projectId)[0];
    if (conversation) {
      const { message } = appendMessage(raw, { projectId, conversationId: conversation.id, id: ctx.newId(), speaker: "system", agentId: null,
        text: rejected ? `Đã từ chối đề xuất cho ${action.game_id}. Portal giữ nguyên.` : `Đã duyệt thao tác cho ${action.game_id}. Đang thực hiện.`, createdAt: now });
      hub.append({ projectId, causationId: command.commandId, payload: { type: "message.appended", message } });
    }
    return result;
  };
}
