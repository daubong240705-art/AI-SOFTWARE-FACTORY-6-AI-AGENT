import { z } from "zod";
import {
  idSchema,
  revisionSchema,
  linuxPathSchema,
  labelSchema,
  timestampSchema,
  versionedRefSchema,
} from "./base.js";

const originSchema = z.url().refine((value) => {
  try {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}, "Expected an HTTP(S) origin without credentials, query or path");

export const actionSchema = z.enum([
  "read",
  "edit",
  "shell",
  "build",
  "test",
  "job",
  "publish",
  "spend",
  "system-config",
  "credentials",
]);
export const executionProfileSchema = z.strictObject({
  id: idSchema,
  revision: revisionSchema,
  environmentId: idSchema,
  name: labelSchema,
  mode: z.enum(["scoped", "full-environment"]),
  filesystem: z
    .array(
      z.strictObject({
        root: linuxPathSchema,
        access: z.enum(["read", "read-write"]),
      }),
    )
    .min(1)
    .max(100),
  toolIds: z.array(idSchema).max(100),
  network: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("deny") }),
    z.strictObject({
      mode: z.literal("allow-list"),
      origins: z.array(originSchema).min(1).max(100),
    }),
    z.strictObject({ mode: z.literal("environment") }),
  ]),
  actions: z.array(actionSchema).min(1).max(10),
  limits: z.strictObject({
    maxConcurrentRuns: z.number().int().min(1).max(64),
    maxConcurrentJobs: z.number().int().min(1).max(64),
    maxRunSeconds: z.number().int().min(1).max(604800),
    maxOutputBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    maxAutoFixRoundsPerIssue: z.number().int().min(0).max(3),
  }),
});
export const grantBlockerSchema = z.strictObject({
  dimension: z.enum([
    "filesystem",
    "network",
    "tools",
    "actions",
    "budget",
    "runtime-policy",
  ]),
  reason: z.string().min(1).max(2000),
  remedy: z.string().min(1).max(2000),
});
// Host-only attestation: a validated profile alone is never evidence that the adapter enforces it.
export const effectiveGrantSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("ready"),
    profile: versionedRefSchema,
    environmentId: idSchema,
    adapterId: labelSchema,
    observedAt: timestampSchema,
    configurationDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.strictObject({
    state: z.literal("blocked"),
    profile: versionedRefSchema,
    environmentId: idSchema,
    adapterId: labelSchema,
    observedAt: timestampSchema,
    blockers: z.array(grantBlockerSchema).min(1).max(50),
  }),
]);
export type ExecutionProfile = z.infer<typeof executionProfileSchema>;
export type EffectiveGrant = z.infer<typeof effectiveGrantSchema>;
