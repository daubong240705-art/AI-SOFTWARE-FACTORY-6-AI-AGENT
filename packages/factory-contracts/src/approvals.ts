import { z } from "zod";
import {
  idSchema,
  labelSchema,
  revisionSchema,
  sha256Schema,
  textSchema,
  timestampSchema,
} from "./base.js";
import { artifactRefSchema } from "./knowledge.js";

/**
 * Approval is the ONLY question-and-answer mechanism (05 I5). M0-lite ships three kinds; more kinds
 * (budget, action-intent, plan-patch...) are added later without changing existing ones.
 *   question   - a business decision the operator must make
 *   review     - accept or send back an output version (human-final / hybrid policy)
 *   start-gate - release a Task that is waiting at the Execution Gate (C-04, AP-R12)
 */
export const approvalKindSchema = z.enum(["question", "review", "start-gate"]);

export const approvalStateSchema = z.enum([
  "requested",
  "pending",
  "approved",
  "rejected",
  "changes-requested",
  "superseded",
  "expired",
  "withdrawn",
  "applied",
]);
export type ApprovalState = z.infer<typeof approvalStateSchema>;

export const APPROVAL_TRANSITIONS: Readonly<
  Record<ApprovalState, readonly ApprovalState[]>
> = {
  requested: ["pending", "withdrawn"],
  pending: [
    "approved",
    "rejected",
    "changes-requested",
    "superseded",
    "expired",
    "withdrawn",
  ],
  approved: ["applied", "superseded"],
  rejected: [],
  "changes-requested": [],
  superseded: [],
  expired: [],
  withdrawn: [],
  applied: [],
};
export const canTransitionApproval = (
  from: ApprovalState,
  to: ApprovalState,
): boolean => APPROVAL_TRANSITIONS[from].includes(to);

export const approvalOptionSchema = z.strictObject({
  id: labelSchema,
  label: labelSchema,
  consequence: z.string().max(1_000),
});

export const approvalSchema = z
  .strictObject({
    id: idSchema,
    projectId: idSchema,
    revision: revisionSchema,
    kind: approvalKindSchema,
    taskId: idSchema.nullable(),
    subject: labelSchema,
    summary: textSchema.max(4_000),
    options: z.array(approvalOptionSchema).min(1).max(6),
    recommendation: labelSchema.nullable(),
    impactIfWaiting: z.string().max(1_000),
    // The digest of the context the question was asked about. A different digest means the answer
    // would apply to something else: the approval is superseded, never silently re-used.
    context: z.strictObject({
      refs: z.array(artifactRefSchema).max(100),
      digest: sha256Schema,
    }),
    approver: z.enum(["operator", "project-lead"]),
    requestedAt: timestampSchema,
    expiresAt: timestampSchema,
    state: approvalStateSchema,
    outcome: z
      .strictObject({
        optionId: labelSchema,
        actorId: idSchema,
        decidedAt: timestampSchema,
        comment: z.string().max(32_000),
      })
      .nullable(),
    appliedByCommandId: idSchema.nullable(),
  })
  .superRefine((approval, ctx) => {
    const ids = approval.options.map((o) => o.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "duplicate option ids" });
    if (approval.recommendation && !ids.includes(approval.recommendation))
      ctx.addIssue({
        code: "custom",
        message: "recommendation must be one of the options",
      });
    if (Date.parse(approval.expiresAt) <= Date.parse(approval.requestedAt))
      ctx.addIssue({ code: "custom", message: "expiresAt must be after requestedAt" });
    const decided: ApprovalState[] = [
      "approved",
      "rejected",
      "changes-requested",
      "applied",
    ];
    if (decided.includes(approval.state) !== Boolean(approval.outcome))
      ctx.addIssue({
        code: "custom",
        message: "outcome is present exactly when the approval was decided",
      });
    if (approval.outcome && !ids.includes(approval.outcome.optionId))
      ctx.addIssue({ code: "custom", message: "outcome option is not an option" });
    if ((approval.state === "applied") !== Boolean(approval.appliedByCommandId))
      ctx.addIssue({
        code: "custom",
        message: "appliedByCommandId is present exactly when the approval is applied (exactly-once)",
      });
    if (approval.kind === "start-gate" && !approval.taskId)
      ctx.addIssue({ code: "custom", message: "a start-gate concerns a Task" });
  });
export type Approval = z.infer<typeof approvalSchema>;

/** An expired approval is never auto-approved: expiring means "not done" (04 §10.3). */
export function isExpired(approval: Pick<Approval, "state" | "expiresAt">, now: Date): boolean {
  return (
    (approval.state === "pending" || approval.state === "requested") &&
    Date.parse(approval.expiresAt) <= now.getTime()
  );
}

/** True when the context moved on since the question was asked. */
export const isContextStale = (
  approval: Pick<Approval, "context">,
  currentDigest: string,
): boolean => approval.context.digest !== currentDigest;
