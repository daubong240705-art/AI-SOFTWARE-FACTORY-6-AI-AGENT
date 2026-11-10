import { z } from "zod";
import { labelSchema } from "./base.js";
import { artifactKindSchema } from "./knowledge.js";

export const monitorKindSchema = z.enum(["artifact-age", "approval-overdue", "workflow-stalled", "disk-free"]);
export const monitorStatusSchema = z.enum(["unknown", "ok", "tripped"]);
const artifactParams = z.strictObject({ kind: artifactKindSchema, days: z.number().int().min(1).max(3650) });
const approvalParams = z.strictObject({ hours: z.number().int().min(1).max(8760) });
const emptyParams = z.strictObject({});
const diskParams = z.strictObject({ path: z.literal("state") });
const fields = {
  name: labelSchema, kind: monitorKindSchema,
  params: z.union([artifactParams, approvalParams, emptyParams, diskParams]),
  comparator: z.enum(["gt", "lt"]).optional(), threshold: z.number().finite().min(0),
  tripAfter: z.number().int().min(1).max(10).default(3),
  recoverAfter: z.number().int().min(1).max(10).default(1),
  intervalSeconds: z.number().int().min(60).max(86400).default(300), enabled: z.boolean().default(true),
};
export const monitorCreateSchema = z.strictObject(fields).superRefine((value, ctx) => {
  const schema = value.kind === "artifact-age" ? artifactParams : value.kind === "approval-overdue" ? approvalParams
    : value.kind === "disk-free" ? diskParams : emptyParams;
  if (!schema.safeParse(value.params).success) ctx.addIssue({ code: "custom", path: ["params"], message: "Invalid monitor parameters" });
});
export const monitorInputSchema = monitorCreateSchema.transform((value) => ({ ...value, comparator: value.comparator ?? (value.kind === "disk-free" ? "lt" as const : "gt" as const) }));
// A patch is validated against its persisted kind after merging.
export const monitorPatchSchema = z.strictObject({
  name: fields.name.optional(), params: fields.params.optional(), comparator: fields.comparator,
  threshold: fields.threshold.optional(), tripAfter: fields.tripAfter.removeDefault().optional(),
  recoverAfter: fields.recoverAfter.removeDefault().optional(), intervalSeconds: fields.intervalSeconds.removeDefault().optional(),
  enabled: fields.enabled.removeDefault().optional(),
});
export type MonitorInput = z.infer<typeof monitorInputSchema>;
