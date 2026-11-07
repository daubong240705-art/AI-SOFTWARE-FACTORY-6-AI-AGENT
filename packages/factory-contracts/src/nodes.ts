import { z } from "zod";
import {
  freshnessSchema,
  idSchema,
  labelSchema,
  revisionSchema,
  timestampSchema,
} from "./base.js";
import { runtimeKindSchema } from "./attempt.js";

/** Namespaced capability id, e.g. "code.typescript", "runtime.opencode", "node.os.linux". */
export const capabilityIdSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/);

/**
 * declared: someone said so. verified: probed, fresh. observed: completed real work with evidence.
 * Only verified/observed AND fresh may be used as a hard filter when placing work (01 §7.3).
 */
export const capabilityLevelSchema = z.enum(["declared", "verified", "observed"]);
export const nodeCapabilitySchema = z.strictObject({
  id: capabilityIdSchema,
  level: capabilityLevelSchema,
  freshness: freshnessSchema.nullable(),
});

export const nodeTrustSchema = z.enum([
  "personal-trusted",
  "server-sandboxed",
  "shared-compute",
  "quarantined",
]);
export const nodeStateSchema = z.enum([
  "online",
  "busy",
  "draining",
  "offline",
  "lost",
  "quarantined",
]);
export const nodeSchema = z
  .strictObject({
    id: idSchema,
    revision: revisionSchema,
    name: labelSchema,
    platform: z.enum(["linux", "windows"]),
    trust: nodeTrustSchema,
    state: nodeStateSchema,
    slots: z.strictObject({
      total: z.number().int().min(1).max(64),
      used: z.number().int().min(0).max(64),
    }),
    runtimes: z.array(runtimeKindSchema).max(8),
    capabilities: z.array(nodeCapabilitySchema).max(200),
    lastHeartbeatAt: timestampSchema.nullable(),
  })
  .superRefine((node, ctx) => {
    if (node.slots.used > node.slots.total)
      ctx.addIssue({ code: "custom", message: "used slots exceed total" });
    if (node.trust === "quarantined" && node.state !== "quarantined")
      ctx.addIssue({
        code: "custom",
        message: "A quarantined trust level requires the quarantined state",
      });
    const seen = new Set<string>();
    for (const capability of node.capabilities) {
      if (seen.has(capability.id))
        ctx.addIssue({ code: "custom", message: `duplicate capability ${capability.id}` });
      seen.add(capability.id);
      if (capability.level !== "declared" && !capability.freshness)
        ctx.addIssue({
          code: "custom",
          message: `${capability.id}: verified/observed needs freshness`,
        });
    }
  });
export type NodeInfo = z.infer<typeof nodeSchema>;

/** Capabilities a placement decision may rely on at `now`. */
export function usableCapabilities(
  node: Pick<NodeInfo, "capabilities">,
  now: Date,
): Set<string> {
  const usable = new Set<string>();
  for (const capability of node.capabilities) {
    if (capability.level === "declared") continue;
    if (!capability.freshness) continue;
    if (Date.parse(capability.freshness.staleAfter) < now.getTime()) continue;
    usable.add(capability.id);
  }
  return usable;
}

/** Hard filter: may this node take work needing `required` right now? Never scores, only decides. */
export function nodeCanTake(
  node: NodeInfo,
  required: readonly string[],
  now: Date,
): { ok: true } | { ok: false; reason: string } {
  if (node.state !== "online" && node.state !== "busy")
    return { ok: false, reason: `node is ${node.state}` };
  if (node.trust === "quarantined") return { ok: false, reason: "node is quarantined" };
  if (node.slots.used >= node.slots.total)
    return { ok: false, reason: "no free slot" };
  const usable = usableCapabilities(node, now);
  const missing = required.filter((id) => !usable.has(id));
  return missing.length
    ? { ok: false, reason: `missing verified capability: ${missing.join(", ")}` }
    : { ok: true };
}
