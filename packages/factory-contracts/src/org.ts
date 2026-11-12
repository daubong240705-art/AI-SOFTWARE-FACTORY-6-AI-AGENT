import { z } from "zod";
import {
  idSchema,
  labelSchema,
  revisionSchema,
  timestampSchema,
  versionedRefSchema,
} from "./base.js";
import { runtimeKindSchema } from "./attempt.js";

export const seatRuntimeInputSchema = z.strictObject({
  seatId: idSchema,
  expectedRevision: revisionSchema.nullable(),
  runtime: z.enum(["inherit", "native-opencode", "acp"]),
  cli: z.enum(["codex", "claude"]).optional(),
  model: z.string().min(1).max(256).regex(/^[^\s\p{Cc}]+$/u).nullable().optional(),
  effort: z.enum(["low", "medium", "high", "xhigh"]).nullable().optional(),
  permission: z.enum(["autonomous", "workspace-write"]).optional(),
}).refine((value) => (value.runtime === "acp") === (value.cli !== undefined), {
  message: "cli is required exactly when runtime is acp", path: ["cli"],
});
export type SeatRuntimeInput = z.infer<typeof seatRuntimeInputSchema>;

/**
 * Teams come from Packs (a folder under packs/), so the MVP has no "teams.create" command.
 * Organization is intentionally absent in M0-lite: every table is scoped by project, and an
 * org_id column can be added later with a default value (07 §2.14).
 */
export const teamSchema = z.strictObject({
  id: idSchema,
  revision: revisionSchema,
  name: labelSchema,
  charter: z.string().max(2_000),
  pack: z.strictObject({ key: labelSchema, version: labelSchema }).nullable(),
  lifecycle: z.enum(["active", "paused", "archived"]),
});
export type Team = z.infer<typeof teamSchema>;

/** A Seat is a position in a Team: a role plus an Agent Profile revision. It is NOT bound to a machine. */
export const seatSchema = z
  .strictObject({
    id: idSchema,
    teamId: idSchema,
    revision: revisionSchema,
    name: labelSchema,
    role: labelSchema, // free text; permissions never come from the role name (07, E-11)
    profile: versionedRefSchema, // Agent Profile revision pinned per Attempt
    runtime: runtimeKindSchema,
    slots: z.number().int().min(1).max(8),
    nodePolicy: z.enum(["elastic", "dedicated"]),
    dedicatedNodeId: idSchema.nullable(),
    isLead: z.boolean(),
  })
  .superRefine((seat, ctx) => {
    if (seat.nodePolicy === "dedicated" && !seat.dedicatedNodeId)
      ctx.addIssue({
        code: "custom",
        message: "A dedicated seat names its node",
      });
    if (seat.nodePolicy === "elastic" && seat.dedicatedNodeId)
      ctx.addIssue({
        code: "custom",
        message: "An elastic seat is not bound to a node",
      });
  });
export type Seat = z.infer<typeof seatSchema>;

/** Team serves Project. Minimal in M0-lite: link, priority and a concurrency cap. */
export const engagementSchema = z.strictObject({
  id: idSchema,
  projectId: idSchema,
  teamId: idSchema,
  revision: revisionSchema,
  priority: z.number().int().min(0).max(100),
  maxConcurrent: z.number().int().min(1).max(32),
  state: z.enum(["active", "paused", "ended"]),
  createdAt: timestampSchema,
});
export type Engagement = z.infer<typeof engagementSchema>;
