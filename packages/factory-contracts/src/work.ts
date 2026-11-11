import { z } from "zod";
import {
  entityRefSchema,
  idSchema,
  labelSchema,
  revisionSchema,
  textSchema,
  timestampSchema,
} from "./base.js";
import type { AttemptState } from "./attempt.js";
import { artifactRefSchema } from "./knowledge.js";
import { capabilityIdSchema } from "./nodes.js";

/**
 * Task lifecycle (ADR-T04 layer 2): BUSINESS state only. Execution state lives on the Attempt.
 * Waiting / Queued / Interrupted / Paused are NOT task states: see deriveDisplayStatus and `disposition`.
 */
export const taskStateSchema = z.enum([
  "draft",
  "proposed",
  "accepted",
  "ready",
  "awaiting-go", // ready but the Execution Gate is closed (C-04)
  "active", // has, or is about to get, a live Attempt
  "in-review",
  "done",
  "failed",
  "cancelled",
  "declined",
  "superseded",
]);
export type TaskState = z.infer<typeof taskStateSchema>;

export const TASK_TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  draft: ["proposed", "accepted", "cancelled"],
  proposed: ["accepted", "declined", "cancelled"],
  accepted: ["ready", "cancelled"],
  ready: ["awaiting-go", "active", "cancelled"],
  "awaiting-go": ["active", "cancelled"],
  active: ["in-review", "failed", "cancelled"],
  "in-review": ["done", "active", "cancelled"], // back to active = changes requested
  failed: ["active", "cancelled"], // retry after a decision
  done: ["superseded"],
  cancelled: [],
  declined: [],
  superseded: [],
};
export const canTransitionTask = (from: TaskState, to: TaskState): boolean =>
  TASK_TRANSITIONS[from].includes(to);

export const holdKindSchema = z.enum([
  "input",
  "dependency",
  "cross-team",
  "decision",
  "capacity",
  "budget",
  "permission",
]);
export const holdSchema = z.strictObject({
  kind: holdKindSchema,
  reason: z.string().min(1).max(1_000),
  ref: entityRefSchema.nullable(),
  since: timestampSchema,
  // Set by the Host when a person or a configuration change is needed. Otherwise the hold resolves by itself.
  needsAction: z.boolean(),
});
export type Hold = z.infer<typeof holdSchema>;

export const requestKindSchema = z.enum([
  "clarify",
  "consult",
  "produce",
  "review",
  "decision",
  "notify",
]);
export const taskOriginSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("operator") }),
  z.strictObject({ kind: z.literal("delegation"), parentTaskId: idSchema }),
  // A cross-team request IS a Task (AP-R8): it carries who asked and what kind of request it is.
  z.strictObject({
    kind: z.literal("cross-team"),
    requesterTaskId: idSchema,
    requestKind: requestKindSchema,
    hop: z.number().int().min(0).max(3),
  }),
]);

export const placementSchema = z.enum(["portable", "repo-bound", "node-bound", "session-bound"]);
export const sideEffectSchema = z.enum([
  "none",
  "artifact",
  "external-idempotent",
  "external-irreversible",
]);
/** E-06: a task that does not say otherwise is treated as the most restrictive combination. */
export const DEFAULT_PLACEMENT = "node-bound" as const;
export const DEFAULT_SIDE_EFFECT = "external-irreversible" as const;

export const reviewPolicySchema = z.enum(["human-final", "automatic", "hybrid"]);

export const taskSchema = z
  .strictObject({
    id: idSchema,
    projectId: idSchema,
    revision: revisionSchema,
    code: z.string().regex(/^[A-Z]{2,6}-\d{3,6}$/),
    title: labelSchema,
    goal: z.string().min(1).max(500),
    brief: textSchema,
    parentTaskId: idSchema.nullable(),
    engagementId: idSchema.nullable(),
    ownerSeatId: idSchema.nullable(),
    origin: taskOriginSchema,
    state: taskStateSchema,
    holds: z.array(holdSchema).max(30),
    disposition: z.enum(["active", "parked", "archived"]),
    requiredCapabilities: z.array(capabilityIdSchema).max(30),
    placement: placementSchema,
    sideEffect: sideEffectSchema,
    reviewPolicy: reviewPolicySchema,
    gate: z.strictObject({ requiresGo: z.boolean() }),
    acceptance: z.array(z.string().min(1).max(500)).max(30),
    inputs: z.array(artifactRefSchema).max(100),
    dependsOn: z.array(idSchema).max(50),
  })
  .superRefine((task, ctx) => {
    if (task.parentTaskId === task.id)
      ctx.addIssue({ code: "custom", message: "a task cannot be its own parent" });
    if (task.dependsOn.includes(task.id))
      ctx.addIssue({ code: "custom", message: "a task cannot depend on itself" });
    if (new Set(task.dependsOn).size !== task.dependsOn.length)
      ctx.addIssue({ code: "custom", message: "duplicate dependency" });
    if (task.state === "awaiting-go" && !task.gate.requiresGo)
      ctx.addIssue({
        code: "custom",
        message: "awaiting-go requires a task that goes through the Execution Gate",
      });
    if (task.state === "done" && task.holds.length > 0)
      ctx.addIssue({ code: "custom", message: "a done task has no holds" });
    if (task.origin.kind === "cross-team" && !task.ownerSeatId && task.state !== "draft" && task.state !== "proposed")
      ctx.addIssue({
        code: "custom",
        message: "an accepted cross-team request has an owner seat",
      });
  });
export type Task = z.infer<typeof taskSchema>;

// ---- The five states people see (W-06) are a PROJECTION, never stored ------------------------------
export type DisplayStatus =
  | "waiting"
  | "running"
  | "blocked"
  | "approval-required"
  | "completed"
  | "closed";

export function deriveDisplayStatus(input: {
  state: TaskState;
  holds: readonly Pick<Hold, "kind" | "needsAction">[];
  disposition: "active" | "parked" | "archived";
  reviewPolicy: z.infer<typeof reviewPolicySchema>;
  liveAttempt: AttemptState | null;
}): { status: DisplayStatus; reason: string } {
  const { state, holds, disposition, reviewPolicy, liveAttempt } = input;
  if (state === "done") return { status: "completed", reason: "done" };
  if (state === "cancelled" || state === "declined" || state === "superseded")
    return { status: "closed", reason: state };
  if (state === "failed") return { status: "blocked", reason: "failed: needs a decision" };
  if (disposition === "parked") return { status: "blocked", reason: "parked by an operator" };
  if (state === "awaiting-go") return { status: "approval-required", reason: "waiting for the start gate" };
  if (state === "in-review")
    return reviewPolicy === "automatic"
      ? { status: "waiting", reason: "automatic review in progress" }
      : { status: "approval-required", reason: "waiting for review" };
  const stuck = holds.find((h) => h.needsAction);
  if (stuck) return { status: "blocked", reason: `hold ${stuck.kind} needs action` };
  if (holds.some((h) => h.kind === "decision"))
    return { status: "approval-required", reason: "waiting for a decision" };
  if (liveAttempt === "unknown" || liveAttempt === "reconciling")
    return { status: "blocked", reason: "outcome unknown: reconcile before continuing" };
  if (
    liveAttempt === "leased" ||
    liveAttempt === "preparing" ||
    liveAttempt === "running" ||
    liveAttempt === "waiting-input" ||
    liveAttempt === "submitting" ||
    liveAttempt === "stopping"
  )
    return { status: "running", reason: `attempt ${liveAttempt}` };
  if (holds.length > 0) return { status: "waiting", reason: `hold ${holds[0]?.kind}` };
  return { status: "waiting", reason: state === "active" ? "queued for a node" : `task is ${state}` };
}

