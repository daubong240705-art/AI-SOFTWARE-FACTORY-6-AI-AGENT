import { z } from "zod";
import { idSchema, labelSchema, timestampSchema } from "./base.js";
import { reasoningEffortSchema } from "./attempt.js";
import { attemptIdentitySchema } from "./models.js";

const tokens = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** Token counts exactly as the runtime reports them. Cached tokens are NOT subtracted from input. */
export const usageSchema = z.strictObject({
  inputTokens: tokens,
  cachedInputTokens: tokens,
  outputTokens: tokens,
  reasoningOutputTokens: tokens,
});
export type Usage = z.infer<typeof usageSchema>;

/**
 * Cost is unknown unless a price list exists. "Unknown" is a value of its own and is never
 * silently counted as zero (V2 README, 04 §17.1).
 */
export const costSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("unknown"), reason: z.string().max(500) }),
  z.strictObject({
    kind: z.literal("known"),
    amount: z.number().nonnegative(),
    currency: z.string().length(3),
  }),
]);

export const usageRecordSchema = z.strictObject({
  id: idSchema,
  projectId: idSchema,
  taskId: idSchema,
  attempt: attemptIdentitySchema,
  provider: labelSchema,
  model: labelSchema,
  effort: reasoningEffortSchema.nullable(),
  usage: usageSchema.nullable(), // null: the runtime reported nothing (do not guess)
  cost: costSchema,
  recordedAt: timestampSchema,
});
export type UsageRecord = z.infer<typeof usageRecordSchema>;

/** Budget in tokens. M0-lite has two scopes; more (engagement, team, chain) arrive with their features. */
export const budgetSchema = z
  .strictObject({
    id: idSchema,
    projectId: idSchema,
    scope: z.enum(["task", "day"]),
    // task id for scope "task"; calendar date YYYY-MM-DD (Asia/Saigon unless configured) for "day"
    scopeRef: z.string().min(1).max(64),
    limitTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    warnAtPercent: z.number().int().min(1).max(99),
  })
  .superRefine((budget, ctx) => {
    if (budget.scope === "day" && !/^\d{4}-\d{2}-\d{2}$/.test(budget.scopeRef))
      ctx.addIssue({ code: "custom", message: "day budgets use YYYY-MM-DD" });
    if (budget.scope === "task" && !idSchema.safeParse(budget.scopeRef).success)
      ctx.addIssue({ code: "custom", message: "task budgets use a task id" });
  });
export type Budget = z.infer<typeof budgetSchema>;

export type BudgetVerdict = "ok" | "warn" | "exceeded";

/** What counts against a budget: input + output (cached input is already part of input). */
export const billableTokens = (usage: Usage): number =>
  usage.inputTokens + usage.outputTokens;

export function evaluateBudget(
  budget: Pick<Budget, "limitTokens" | "warnAtPercent">,
  usedTokens: number,
): BudgetVerdict {
  if (usedTokens >= budget.limitTokens) return "exceeded";
  return usedTokens * 100 >= budget.limitTokens * budget.warnAtPercent ? "warn" : "ok";
}

/** A call is admitted only if the reservation fits: reserve BEFORE dispatch, settle afterwards. */
export const canReserve = (
  budget: Pick<Budget, "limitTokens">,
  usedTokens: number,
  reserveTokens: number,
): boolean => usedTokens + reserveTokens <= budget.limitTokens;
