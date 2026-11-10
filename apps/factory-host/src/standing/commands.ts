import { STANDING_MAX_DAYS, standingCreateSchema } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import type { HandlerContext, HandlerMap } from "../commands/pipeline.js";
import { getStandingApproval } from "./service.js";

export const STANDING_COMMANDS = ["standing-approvals.create", "standing-approvals.revoke"] as const;
function project(ctx: HandlerContext, projectId: string): void {
  if (!ctx.raw.prepare("SELECT id FROM projects WHERE id=?").get(projectId))
    throw new CommandError("not-found", "project not found", "correct-input");
}
export function createStandingApprovalHandlers(): Partial<HandlerMap> {
  return {
    "standing-approvals.create": (ctx, { projectId, payload }) => {
      project(ctx, projectId);
      const parsed = standingCreateSchema.safeParse(payload);
      if (!parsed.success) throw new CommandError("validation", parsed.error.issues[0]?.message ?? "invalid standing approval", "correct-input");
      const input = parsed.data, now = ctx.clock(), expires = Date.parse(input.expiresAt);
      if (input.scope.kind === "project" && input.scope.ref !== projectId)
        throw new CommandError("validation", "project scope must match project id", "correct-input");
      if (input.scope.kind === "team" && !ctx.raw.prepare("SELECT id FROM teams WHERE id=?").get(input.scope.ref))
        throw new CommandError("not-found", "team not found", "correct-input");
      if (expires <= now.getTime() || expires > now.getTime() + STANDING_MAX_DAYS * 86_400_000)
        throw new CommandError("validation", "standing approval must expire in the future within 30 days", "correct-input");
      if (getStandingApproval(ctx.raw, projectId, input.standingId))
        throw new CommandError("conflict", "standing approval id already exists", "correct-input");
      const { n } = ctx.raw.prepare("SELECT count(*) AS n FROM standing_approvals WHERE project_id=? AND state='active'")
        .get(projectId) as { n: number };
      if (n >= 20) throw new CommandError("resource-exhausted", "active standing approval limit reached", "correct-input");
      ctx.raw.prepare(`INSERT INTO standing_approvals (project_id,id,revision,action_kind,scope_kind,scope_ref,
        limit_per_day,max_tokens_per_use,state,created_at,expires_at,revoked_at) VALUES (?,?,1,?,?,?,?,?,'active',?,?,NULL)`)
        .run(projectId, input.standingId, input.actionKind, input.scope.kind, input.scope.ref, input.limitPerDay,
          input.maxTokensPerUse ?? null, now.toISOString(), new Date(expires).toISOString());
      return { effects: [{ kind: "standing-approval", id: input.standingId, revision: 1 }] };
    },
    "standing-approvals.revoke": (ctx, { projectId, payload }) => {
      project(ctx, projectId);
      const row = getStandingApproval(ctx.raw, projectId, payload.standingId);
      if (!row) throw new CommandError("not-found", "standing approval not found", "correct-input");
      if (row.revision !== payload.expectedRevision)
        throw new CommandError("conflict", "standing approval revision changed", "refresh", { currentRevision: row.revision });
      if (row.state === "revoked") return { effects: [] };
      ctx.raw.prepare("UPDATE standing_approvals SET state='revoked',revoked_at=?,revision=revision+1 WHERE project_id=? AND id=?")
        .run(ctx.clock().toISOString(), projectId, row.id);
      return { effects: [{ kind: "standing-approval", id: row.id, revision: row.revision + 1 }] };
    },
  };
}
