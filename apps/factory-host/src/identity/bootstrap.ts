import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { systemClock, type Clock } from "../ids.js";

export interface BootstrapGate {
  /** Read once for the caller to display; subsequent reads return undefined. */
  readonly token: string | undefined;
  consume(candidate: unknown): "ok" | "invalid" | "locked" | "used";
}

export interface BootstrapOptions {
  clock?: Clock;
  token?: string;
  maxFailures?: number;
  lockMs?: number;
  /** A token the operator chose (FACTORY_LOGIN_TOKEN) that signs in any number of times: for a Host reachable over a network. */
  reusable?: boolean;
}

export function createBootstrapGate({
  clock = systemClock, token, maxFailures = 5, lockMs = 60_000, reusable = false,
}: BootstrapOptions = {}): BootstrapGate {
  if (!Number.isSafeInteger(maxFailures) || maxFailures < 1 || !Number.isSafeInteger(lockMs) || lockMs < 1)
    throw new Error("Bootstrap limits must be positive integers");
  let displayToken: string | undefined = token ?? randomBytes(32).toString("hex");
  const digest = createHash("sha256").update(displayToken).digest();
  token = undefined;
  let used = false;
  let failures = 0;
  let lockedUntil: number | null = null;

  const gate: BootstrapGate = {
    get token() {
      // Only this one-time handoff retains plaintext; authentication retains the digest.
      const value = displayToken;
      displayToken = undefined;
      return value;
    },
    consume(candidate) {
      if (used && !reusable) return "used";
      const now = clock().getTime();
      if (lockedUntil !== null) {
        if (now < lockedUntil) return "locked";
        lockedUntil = null;
        failures = 0;
      }
      const supplied = createHash("sha256").update(typeof candidate === "string" ? candidate : "").digest();
      const matches = timingSafeEqual(digest, supplied);
      if (matches && typeof candidate === "string") {
        if (!reusable) used = true;
        failures = 0;
        displayToken = undefined;
        return "ok";
      }
      if (++failures >= maxFailures) {
        lockedUntil = now + lockMs;
        return "locked";
      }
      return "invalid";
    },
  };
  // Serializing the gate must neither disclose nor consume the display token.
  Object.defineProperty(gate, "token", { enumerable: false });
  return gate;
}
