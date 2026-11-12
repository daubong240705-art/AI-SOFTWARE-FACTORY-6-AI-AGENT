import { z } from "zod";
import { reasoningEffortSchema } from "./attempt.js";
import { revisionSchema } from "./base.js";

export const modelNameSchema = z.string().min(1).max(256)
  .refine((value) => !/[\s\p{Cc}]/u.test(value), "Model names must not contain whitespace or control characters.");
export const agentModelsSchema = z.array(modelNameSchema).min(1).max(8)
  .refine((value) => new Set(value).size === value.length, "Agent models must be unique.");
export const modelSettingsSetSchema = z.strictObject({
  leadModel: modelNameSchema, leadEffort: reasoningEffortSchema,
  agentModels: agentModelsSchema, expectedRevision: revisionSchema.nullable(),
});
