import { z } from "zod";
import { idSchema, labelSchema, timestampSchema } from "./base.js";
import { attemptIdentitySchema } from "./models.js";

/**
 * Side effects outside the sandbox are performed ONLY by the Host's Effect Executor (E-07). Nodes
 * send an intent; the Host writes an Effect Record BEFORE acting. M0-lite knows one effect: pushing
 * the attempt's branch.
 */
export const effectKindSchema = z.enum(["git.push-branch"]);
export const effectStateSchema = z.enum(["pending", "done", "failed", "unknown"]);
export type EffectState = z.infer<typeof effectStateSchema>;

export const EFFECT_TRANSITIONS: Readonly<
  Record<EffectState, readonly EffectState[]>
> = {
  pending: ["done", "failed", "unknown"],
  unknown: ["done", "failed"], // only after reconciliation against the real remote
  done: [],
  failed: [],
};
export const canTransitionEffect = (from: EffectState, to: EffectState): boolean =>
  EFFECT_TRANSITIONS[from].includes(to);

export const effectRecordSchema = z
  .strictObject({
    id: idSchema,
    projectId: idSchema,
    attempt: attemptIdentitySchema,
    kind: effectKindSchema,
    // Same key = same effect. Derived by the Host from attempt + action; never accepted from a node.
    idempotencyKey: z.string().min(16).max(200),
    target: z.strictObject({ remote: labelSchema, branch: labelSchema }),
    state: effectStateSchema,
    error: z.string().max(2_000).nullable(),
    createdAt: timestampSchema,
    completedAt: timestampSchema.nullable(),
  })
  .superRefine((effect, ctx) => {
    if ((effect.state === "done" || effect.state === "failed") && !effect.completedAt)
      ctx.addIssue({ code: "custom", message: "a finished effect needs completedAt" });
    if (effect.state === "failed" && !effect.error)
      ctx.addIssue({ code: "custom", message: "a failed effect explains why" });
    if (/^(refs\/heads\/)?(main|master)$/.test(effect.target.branch))
      ctx.addIssue({
        code: "custom",
        message: "M0-lite pushes attempt branches only, never main/master",
      });
  });
export type EffectRecord = z.infer<typeof effectRecordSchema>;

/** `unknown` is never retried automatically: reconcile with the remote first (03 §14). */
export const mayAutoRetryEffect = (state: EffectState): boolean => state === "failed";
