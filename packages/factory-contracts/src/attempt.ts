import { z } from "zod";
import {
  idSchema,
  labelSchema,
  revisionSchema,
  timestampSchema,
} from "./base.js";
import { attemptIdentitySchema } from "./models.js";

/**
 * Attempt lifecycle (ADR-T04 layer 3, 03 §12.2). An Attempt is ONE execution of a Task on one node.
 * It never moves between nodes: a retry is a NEW Attempt with epoch + 1.
 */
export const attemptStateSchema = z.enum([
  "queued",
  "leased",
  "preparing",
  "running",
  "waiting-input",
  "parked", // session ended with a checkpoint, slot released; a new Attempt resumes the Task
  "stopping",
  "stopped",
  "submitting",
  "succeeded",
  "failed",
  "lease-expired",
  "unknown", // the effect on the outside world is not known; never replay automatically
  "reconciling",
  "requeued", // closed because a new Attempt (epoch + 1) replaces it
]);
export type AttemptState = z.infer<typeof attemptStateSchema>;

export const ATTEMPT_TRANSITIONS: Readonly<
  Record<AttemptState, readonly AttemptState[]>
> = {
  queued: ["leased", "stopped"],
  leased: ["preparing", "lease-expired", "stopped"],
  preparing: ["running", "failed", "lease-expired", "stopping"],
  running: [
    "waiting-input",
    "stopping",
    "submitting",
    "lease-expired",
    "failed",
  ],
  "waiting-input": ["running", "parked", "stopping", "lease-expired"],
  parked: [],
  stopping: ["stopped", "unknown"],
  stopped: [],
  submitting: ["succeeded", "failed", "lease-expired"],
  succeeded: [],
  failed: [],
  "lease-expired": ["unknown", "requeued"],
  unknown: ["reconciling"],
  reconciling: ["requeued", "succeeded", "failed"],
  requeued: [],
};

export const TERMINAL_ATTEMPT_STATES: ReadonlySet<AttemptState> = new Set(
  (Object.keys(ATTEMPT_TRANSITIONS) as AttemptState[]).filter(
    (state) => ATTEMPT_TRANSITIONS[state].length === 0,
  ),
);
/**
 * Live attempts hold the Task's single execution slot. This includes lease-expired, unknown and
 * reconciling: while the outcome is uncertain no new Attempt may start (prevents duplicate work).
 */
export const LIVE_ATTEMPT_STATES: ReadonlySet<AttemptState> = new Set(
  (Object.keys(ATTEMPT_TRANSITIONS) as AttemptState[]).filter(
    (state) => !TERMINAL_ATTEMPT_STATES.has(state),
  ),
);

export const canTransitionAttempt = (
  from: AttemptState,
  to: AttemptState,
): boolean => ATTEMPT_TRANSITIONS[from].includes(to);
export const isLiveAttempt = (state: AttemptState): boolean =>
  LIVE_ATTEMPT_STATES.has(state);

export const runtimeKindSchema = z.enum([
  "fake",
  "native-opencode",
  "api-agent",
  "acp",
]);
export const reasoningEffortSchema = z.enum([
  "low",
  "medium",
  "high",
  "xhigh",
]); // "max" and "ultra" are deliberately not representable (budget and delegation risk)

export const attemptSchema = z
  .strictObject({
    id: idSchema,
    identity: attemptIdentitySchema,
    taskId: idSchema,
    revision: revisionSchema,
    state: attemptStateSchema,
    outcome: z.enum(["known", "unknown"]),
    nodeId: idSchema.nullable(),
    runtime: runtimeKindSchema,
    provider: labelSchema,
    model: labelSchema,
    effort: reasoningEffortSchema.nullable(),
    leaseExpiresAt: timestampSchema.nullable(),
    startedAt: timestampSchema.nullable(),
    endedAt: timestampSchema.nullable(),
  })
  .superRefine((attempt, ctx) => {
    const leasedStates: AttemptState[] = [
      "leased",
      "preparing",
      "running",
      "waiting-input",
      "stopping",
      "submitting",
    ];
    if (leasedStates.includes(attempt.state) && !attempt.leaseExpiresAt)
      ctx.addIssue({
        code: "custom",
        message: "A leased attempt needs leaseExpiresAt",
      });
    if (attempt.state === "queued" && attempt.nodeId)
      ctx.addIssue({
        code: "custom",
        message: "A queued attempt is not bound to a node yet",
      });
    if (attempt.state === "unknown" && attempt.outcome !== "unknown")
      ctx.addIssue({
        code: "custom",
        message: "State unknown requires outcome unknown",
      });
    if (TERMINAL_ATTEMPT_STATES.has(attempt.state) && !attempt.endedAt)
      ctx.addIssue({
        code: "custom",
        message: "A terminal attempt needs endedAt",
      });
    if (attempt.identity.epoch < 1)
      ctx.addIssue({ code: "custom", message: "epoch starts at 1" });
  });
export type Attempt = z.infer<typeof attemptSchema>;

/**
 * May the Host start a replacement Attempt on another node after a lease expired?
 * Only when nothing outside the sandbox can have happened and the work is not tied to one machine
 * (E-06, 03 §12.3). Anything else waits for reconciliation or for the node to return.
 */
export function canRequeueAfterLeaseExpiry(task: {
  placement: "portable" | "repo-bound" | "node-bound" | "session-bound";
  sideEffect:
    | "none"
    | "artifact"
    | "external-idempotent"
    | "external-irreversible";
}): boolean {
  return (
    (task.placement === "portable" || task.placement === "repo-bound") &&
    (task.sideEffect === "none" || task.sideEffect === "artifact")
  );
}
