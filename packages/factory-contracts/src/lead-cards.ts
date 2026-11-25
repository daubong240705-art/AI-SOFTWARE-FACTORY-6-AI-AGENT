import { z } from "zod";
import { idSchema, revisionSchema, labelSchema } from "./base.js";

export const chatIntentSchema = z.enum(["auto", "discuss", "delegate"]);
export const leadChatModeSchema = z.enum(["auto", "classic"]);
export const flowRunStateSchema = z.enum(["queued", "running", "waiting", "paused", "stalled", "succeeded", "failed", "cancelled"]);
export const leadCardSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("brief"), artifactId: idSchema, version: revisionSchema, title: labelSchema }),
  z.strictObject({ kind: z.literal("run"), runId: idSchema, revision: revisionSchema, title: labelSchema, state: flowRunStateSchema }),
  z.strictObject({ kind: z.literal("tasks"), tasks: z.array(z.strictObject({ id: idSchema, title: labelSchema })).min(1).max(30) }),
]);
export type LeadCard = z.infer<typeof leadCardSchema>;
export type LeadChatMode = z.infer<typeof leadChatModeSchema>;
