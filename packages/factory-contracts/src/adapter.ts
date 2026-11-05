import { z } from "zod";
import {
  apiErrorSchema,
  idSchema,
  labelSchema,
  timestampSchema,
  textSchema,
  versionedRefSchema,
} from "./base.js";
import { attemptIdentitySchema, runtimeSessionSchema } from "./models.js";
import { effectiveGrantSchema } from "./permissions.js";
import type { AttemptIdentity, RuntimeSession } from "./models.js";
import type { ExecutionProfile, EffectiveGrant } from "./permissions.js";
import type { ApiError } from "./base.js";

const capabilitySchema = z.discriminatedUnion("supported", [
  z.strictObject({ supported: z.literal(true) }),
  z.strictObject({
    supported: z.literal(false),
    reason: z.string().min(1).max(2000),
  }),
]);
export const adapterProbeSchema = z.strictObject({
  adapterId: labelSchema,
  connectionId: idSchema,
  observedAt: timestampSchema,
  installed: z.boolean(),
  version: z.string().max(256).nullable(),
  authentication: z.enum(["authenticated", "needs-auth", "unknown"]),
  compatibility: z.enum(["compatible", "incompatible", "unknown"]),
  reason: z.string().max(2000).optional(),
  capabilities: z.strictObject({
    streaming: capabilitySchema,
    resume: capabilitySchema,
    interrupt: capabilitySchema,
    modelSelection: capabilitySchema,
    managedPermissions: capabilitySchema,
    childSessionVisibility: capabilitySchema,
  }),
});
export const adapterCallbackSchema = z.strictObject({
  attempt: attemptIdentitySchema,
  callbackId: idSchema,
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  observedAt: timestampSchema,
  payload: z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("started"),
      session: runtimeSessionSchema,
    }),
    z.strictObject({ type: z.literal("text.delta"), text: textSchema }),
    z.strictObject({
      type: z.literal("waiting-input"),
      reason: z.enum([
        "business-decision",
        "permission-configuration",
        "authentication",
      ]),
    }),
    z.strictObject({
      type: z.literal("exited"),
      result: z.enum(["succeeded", "failed", "interrupted"]),
      evidence: z.strictObject({
        source: z.enum(["owned-process-exit", "runtime-protocol"]),
        reference: z.string().min(1).max(1024),
      }),
      externalEffects: z.enum(["known", "unknown"]),
    }),
    z.strictObject({ type: z.literal("error"), error: apiErrorSchema }),
  ]),
});
export type AdapterProbe = z.infer<typeof adapterProbeSchema>;
export type AdapterCallback = z.infer<typeof adapterCallbackSchema>;

// Internal Host interfaces. These are never decoded from a browser command.
export interface TrustedActor {
  readonly actorId: string;
  readonly sessionId: string;
  readonly authority: "human" | "agent" | "automation" | "host";
}
export interface RuntimeStart {
  readonly attempt: AttemptIdentity;
  readonly connectionId: string;
  readonly modelId: string;
  readonly prompt: string;
  readonly workspaceRoot: string;
  readonly profile: ExecutionProfile;
  readonly grant: Extract<EffectiveGrant, { state: "ready" }>;
  readonly skills: readonly z.infer<typeof versionedRefSchema>[];
  readonly tools: readonly z.infer<typeof versionedRefSchema>[];
  readonly resume: RuntimeSession | null;
}
export interface OwnedExecution {
  readonly attempt: AttemptIdentity;
  readonly session: RuntimeSession;
  // Ack only requests stop. Terminal state requires exit/protocol evidence.
  requestStop(signal: AbortSignal): Promise<"requested" | "already-exited">;
  waitForExit(): Promise<
    Extract<AdapterCallback["payload"], { type: "exited" }>
  >;
}
export interface RuntimeAdapter {
  readonly id: string;
  probe(connectionId: string, signal: AbortSignal): Promise<AdapterProbe>;
  prepareGrant(
    profile: ExecutionProfile,
    signal: AbortSignal,
  ): Promise<EffectiveGrant>;
  start(
    input: RuntimeStart,
    emit: (event: AdapterCallback) => Promise<void>,
    signal: AbortSignal,
  ): Promise<OwnedExecution>;
  // Probe an existing session/owned process; must not resend the prompt.
  reconcile(
    attempt: AttemptIdentity,
    session: RuntimeSession | null,
    signal: AbortSignal,
  ): Promise<
    | { state: "running" }
    | {
        state: "exited";
        evidence: Extract<AdapterCallback["payload"], { type: "exited" }>;
      }
    | { state: "outcome-unknown"; error: ApiError }
  >;
}
/** Extra boundary guard, not a substitute for transactional lease/epoch checks in SQLite. */
export function acceptsCallback(
  active: AttemptIdentity,
  expiresAtMs: number,
  callback: AdapterCallback,
  hostNowMs: number,
): boolean {
  return (
    Number.isFinite(hostNowMs) &&
    Number.isFinite(expiresAtMs) &&
    hostNowMs < expiresAtMs &&
    active.projectId === callback.attempt.projectId &&
    active.runId === callback.attempt.runId &&
    active.assignmentId === callback.attempt.assignmentId &&
    active.epoch === callback.attempt.epoch &&
    active.leaseId === callback.attempt.leaseId
  );
}
/** Reject a grant for another config/environment before spawning. Runtime still enforces actual scope. */
export function grantMatches(
  profile: ExecutionProfile,
  adapterId: string,
  raw: unknown,
): boolean {
  const grant = effectiveGrantSchema.safeParse(raw);
  return (
    grant.success &&
    grant.data.state === "ready" &&
    grant.data.adapterId === adapterId &&
    grant.data.profile.id === profile.id &&
    grant.data.profile.revision === profile.revision &&
    grant.data.environmentId === profile.environmentId
  );
}
