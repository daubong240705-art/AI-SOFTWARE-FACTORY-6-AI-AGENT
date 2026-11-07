import { createHash, randomBytes as secureRandomBytes } from "node:crypto";
import type { Clock } from "../ids.js";

export interface TokenGrant {
  readonly attemptId: string; readonly projectId: string; readonly taskId: string; readonly epoch: number;
  readonly allowedModels: readonly string[]; readonly expiresAt: number;
}
export interface TokenRegistry {
  issue(input: { attemptId: string; projectId: string; taskId: string; epoch: number; allowedModels: string[] }): { token: string };
  resolve(token: unknown): TokenGrant | null;
  revoke(attemptId: string): void;
  revokeAll(): void;
  onRevoke(attemptId: string, listener: () => void): () => void;
}

export function createTokenRegistry(options: {
  clock: Clock; randomBytes?: (size: number) => Uint8Array; maxLifetimeMs?: number;
}): TokenRegistry {
  const { clock, randomBytes = secureRandomBytes, maxLifetimeMs = 6 * 60 * 60_000 } = options;
  if (!Number.isSafeInteger(maxLifetimeMs) || maxLifetimeMs < 1 || maxLifetimeMs > 6 * 60 * 60_000)
    throw new Error("Invalid token lifetime");
  const grants = new Map<string, TokenGrant>();
  const attempts = new Map<string, { hash: string; timer: ReturnType<typeof setTimeout> }>();
  const listeners = new Map<string, Set<() => void>>();
  const digest = (token: string): string => createHash("sha256").update(token).digest("hex");
  const revoke = (attemptId: string): void => {
    const previous = attempts.get(attemptId);
    if (previous) { grants.delete(previous.hash); clearTimeout(previous.timer); attempts.delete(attemptId); }
    const callbacks = listeners.get(attemptId);
    listeners.delete(attemptId);
    for (const listener of callbacks ?? []) { try { listener(); } catch { /* Revocation must complete. */ } }
  };
  return {
    issue(input) {
      if (!input.attemptId || !input.projectId || !input.taskId || !Number.isSafeInteger(input.epoch) || input.epoch < 1
        || !Array.isArray(input.allowedModels) || input.allowedModels.some((model) => typeof model !== "string" || !model || /\s/u.test(model)))
        throw new Error("Invalid token grant");
      let bytes: Uint8Array;
      try { bytes = randomBytes(32); } catch { throw new Error("Token generation failed"); }
      if (!(bytes instanceof Uint8Array) || bytes.length !== 32) throw new Error("Token generation failed");
      const token = `fpx_${Buffer.from(bytes).toString("base64url")}`;
      const hash = digest(token);
      if (grants.has(hash)) throw new Error("Token generation failed");
      revoke(input.attemptId);
      const grant: TokenGrant = Object.freeze({ ...input,
        allowedModels: Object.freeze([...input.allowedModels]), expiresAt: clock().getTime() + maxLifetimeMs });
      grants.set(hash, grant);
      const timer = setTimeout(() => revoke(input.attemptId), maxLifetimeMs).unref();
      attempts.set(input.attemptId, { hash, timer });
      return { token };
    },
    resolve(token) {
      try {
        if (typeof token !== "string" || !/^fpx_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(token)) return null;
        const grant = grants.get(digest(token));
        if (!grant) return null;
        if (clock().getTime() >= grant.expiresAt) { revoke(grant.attemptId); return null; }
        return grant;
      } catch { return null; }
    },
    revoke,
    revokeAll() { for (const id of new Set([...attempts.keys(), ...listeners.keys()])) revoke(id); },
    onRevoke(attemptId, listener) {
      let callbacks = listeners.get(attemptId);
      if (!callbacks) { callbacks = new Set(); listeners.set(attemptId, callbacks); }
      callbacks.add(listener);
      return () => { callbacks.delete(listener); if (!callbacks.size && listeners.get(attemptId) === callbacks) listeners.delete(attemptId); };
    },
  };
}
