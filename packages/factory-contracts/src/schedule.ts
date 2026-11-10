import { z } from "zod";
import { labelSchema } from "./base.js";
import { workflowKeySchema } from "./workflow.js";

export const scheduleKindSchema = z.enum(["cron", "interval", "once"]);
export const scheduleActionSchema = z.strictObject({
  definitionKey: workflowKeySchema, packKey: workflowKeySchema.optional(),
  params: z.record(z.string(), z.union([z.boolean(), z.string().max(500), z.number().finite()])).optional(),
  title: labelSchema.optional(), autoStart: z.boolean().default(true),
});
const fields = {
  name: labelSchema, kind: scheduleKindSchema, expr: z.string().min(1).max(200),
  timezone: z.string().min(1).max(64).default("Asia/Ho_Chi_Minh"), action: scheduleActionSchema,
  missedPolicy: z.enum(["skip", "coalesce-once", "catch-up-limited"]).default("skip"),
  catchUpLimit: z.number().int().min(1).max(5).default(3),
  concurrency: z.enum(["skip-if-running", "queue-one", "allow-parallel"]).default("skip-if-running"),
  parallelLimit: z.number().int().min(2).max(5).optional(), enabled: z.boolean().default(true),
};
export const scheduleInputSchema = z.strictObject(fields).superRefine((value, ctx) => {
  let valid = true;
  if (value.kind === "cron") valid = [5, 6].includes(value.expr.trim().split(/\s+/).length);
  if (value.kind === "interval") valid = /^[0-9]+$/.test(value.expr) && Number(value.expr) >= 60 && Number(value.expr) <= 2592000;
  if (value.kind === "once") valid = z.iso.datetime({ offset: true }).safeParse(value.expr).success;
  if (!valid) ctx.addIssue({ code: "custom", path: ["expr"], message: "Invalid schedule expression" });
  if (value.concurrency === "allow-parallel" && value.parallelLimit === undefined)
    ctx.addIssue({ code: "custom", path: ["parallelLimit"], message: "Parallel limit required" });
});
// Validate a patch again after merging it with the persisted schedule.
export const schedulePatchSchema = z.strictObject({
  name: fields.name.optional(), expr: fields.expr.optional(), timezone: fields.timezone.removeDefault().optional(),
  action: fields.action.optional(), missedPolicy: fields.missedPolicy.removeDefault().optional(),
  catchUpLimit: fields.catchUpLimit.removeDefault().optional(), concurrency: fields.concurrency.removeDefault().optional(),
  parallelLimit: fields.parallelLimit, enabled: fields.enabled.removeDefault().optional(),
});
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;
export type ScheduleAction = z.infer<typeof scheduleActionSchema>;
