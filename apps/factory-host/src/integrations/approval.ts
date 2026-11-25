import type { Database } from "better-sqlite3";
import type { EventHub } from "../events/hub.js";
import type { TokenGrant } from "../proxy/tokens.js";
import type { HandlerMap } from "../commands/pipeline.js";
import { getApprovalView, publicApprovalText } from "../approvals/service.js";
import { assertActiveGrant, sanitizeAgentText } from "../mcp/security.js";
import { CommandError } from "../commands/errors.js";
import { callHash, object } from "./store.js";

export function createToolApproval({ raw, hub, clock, newId }: { raw: Database; hub: EventHub; clock: () => Date; newId: () => string }) {
  return (grant: TokenGrant, tool: string, args: unknown, revision?: string): string | null => hub.transaction(() => {
    const now = clock();
    assertActiveGrant(raw, grant, now);
    const seat = raw.prepare(`SELECT s.id,s.name FROM attempt_seats a JOIN seats s ON s.id=a.seat_id
      WHERE a.project_id=? AND a.attempt_id=?`).get(grant.projectId, grant.attemptId) as { id: string; name: string } | undefined;
    if (!seat) return "tool is not available";
    const hash = callHash({ tool, revision, args });
    const prior = raw.prepare(`SELECT c.consumed_at, a.state,a.outcome_option_id,a.expires_at FROM tool_call_approvals c
      JOIN approvals a ON a.project_id=c.project_id AND a.id=c.approval_id WHERE c.project_id=? AND c.seat_id=? AND c.call_hash=?`)
      .get(grant.projectId, seat.id, hash) as { consumed_at: string | null; state: string; outcome_option_id: string | null; expires_at: string } | undefined;
    const waiting = "đang chờ người duyệt; thử lại sau khi được duyệt";
    if (prior && Date.parse(prior.expires_at) > now.getTime()) {
      if (prior.state === "pending") return waiting;
      if (prior.state !== "approved" || prior.outcome_option_id !== "approve") return "Người duyệt đã từ chối yêu cầu gọi công cụ.";
      if (prior.consumed_at) return "Lần gọi đã được duyệt đã được sử dụng.";
      raw.prepare("UPDATE tool_call_approvals SET consumed_at=? WHERE project_id=? AND seat_id=? AND call_hash=?")
        .run(now.toISOString(), grant.projectId, seat.id, hash);
      return null;
    }
    const id = newId();
    const agent = publicApprovalText(seat.name).slice(0, 120);
    const subject = `Agent ${agent} muốn gọi ${tool}`.slice(0, 200);
    const summary = `${subject} với ${object(args) ? Math.min(999, Object.keys(args).length) : 0} tham số (giá trị được ẩn).`;
    raw.prepare(`INSERT INTO approvals (project_id,id,revision,kind,task_id,subject,summary,options_json,impact_if_waiting,
      context_digest,approver,requested_at,expires_at,state) VALUES (?,?,1,'question',NULL,?,?,?,?,?,'operator',?,?,'pending')`)
      .run(grant.projectId, id, subject, summary, JSON.stringify([
        { id: "approve", label: "Cho phép", consequence: "Cho phép một lần gọi giống hệt." },
        { id: "reject", label: "Từ chối", consequence: "Không gọi công cụ." },
      ]), "Công cụ chưa được gọi.", hash, now.toISOString(), new Date(now.getTime() + 86_400_000).toISOString());
    raw.prepare(`INSERT INTO tool_call_approvals VALUES (?,?,?,?,NULL) ON CONFLICT(project_id,seat_id,call_hash)
      DO UPDATE SET approval_id=excluded.approval_id,consumed_at=NULL`).run(grant.projectId, seat.id, hash, id);
    hub.append({ projectId: grant.projectId, causationId: id, payload: { type: "entity.changed", entity: { kind: "approval", id, revision: 1 } } });
    return waiting;
  });
}

export function withToolApprovalDecisions(decide: HandlerMap["approvals.decide"]): HandlerMap["approvals.decide"] {
  return (ctx, command) => {
    const { projectId, payload } = command;
    const { raw } = ctx;
    if (!raw.prepare("SELECT 1 FROM tool_call_approvals WHERE project_id=? AND approval_id=?").get(projectId, payload.approvalId)) return decide(ctx, command);
    const approval = getApprovalView(raw, projectId, payload.approvalId);
    const now = ctx.clock();
    if (approval?.state !== "pending" || Date.parse(approval.expiresAt) <= now.getTime())
      throw new CommandError("conflict", "Approval is no longer pending", "refresh");
    if (approval.revision !== payload.expectedRevision || approval.context.digest !== payload.contextDigest)
      throw new CommandError("conflict", "Approval changed", "refresh", { currentRevision: approval.revision });
    if (payload.optionId !== "approve" && payload.optionId !== "reject") throw new CommandError("validation", "Unknown approval option", "correct-input");
    raw.prepare(`UPDATE approvals SET state=?,outcome_option_id=?,outcome_actor_id=?,decided_at=?,revision=revision+1
      WHERE project_id=? AND id=?`).run(payload.optionId === "approve" ? "approved" : "rejected", payload.optionId,
      ctx.actorId, now.toISOString(), projectId, payload.approvalId);
    raw.prepare("INSERT INTO approval_comments VALUES (?,?,?)").run(projectId, payload.approvalId, sanitizeAgentText(payload.comment).slice(0, 32000));
    return { effects: [{ kind: "approval", id: approval.id, revision: approval.revision + 1 }] };
  };
}
