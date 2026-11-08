import { z } from "zod";
import { idSchema, timestampSchema } from "./base.js";
import { artifactKindSchema, artifactRefSchema, artifactStatusSchema } from "./knowledge.js";
import { placementSchema, sideEffectSchema } from "./work.js";

export const contextPackSchema = z.strictObject({
  forTask: idSchema, forSeat: idSchema, builtAt: timestampSchema,
  budget: z.strictObject({ maxTokens: z.number().int().min(500).max(32000) }),
  tokens: z.number().int().nonnegative(),
  sections: z.strictObject({
    brief: z.strictObject({ goal: z.string(), brief: z.string(), acceptance: z.array(z.string()).max(30), outputContract: z.string() }),
    constraints: z.strictObject({ placement: placementSchema, requiresGo: z.boolean(), sideEffect: sideEffectSchema, readScope: z.string() }),
    inputs: z.array(z.strictObject({ ref: artifactRefSchema, tier: z.enum(["L0", "L1"]), title: z.string(),
      kind: artifactKindSchema, status: artifactStatusSchema, stale: z.boolean(),
      why: z.enum(["declared input", "request context"]), text: z.string() })).max(100),
    decisions: z.array(z.strictObject({ approvalId: idSchema, oneLine: z.string().max(200) })).max(5),
    openQuestions: z.array(z.strictObject({ approvalId: idSchema, text: z.string() })).max(5),
    handoff: z.strictObject({ text: z.string().max(2000) }).nullable(),
    retrievalHints: z.array(z.string()).max(100),
  }),
  omitted: z.array(z.strictObject({ ref: artifactRefSchema, reason: z.enum(["over-budget", "no-access", "not-found"]) })).max(100),
});
export type ContextPack = z.infer<typeof contextPackSchema>;

/** Deterministic estimate, independent of a model tokenizer and safe in browsers. */
export const estimateContextTokens = (text: string): number => Math.ceil(new TextEncoder().encode(text).length / 4);
