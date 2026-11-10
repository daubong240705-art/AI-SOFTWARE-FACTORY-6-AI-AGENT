import type { Clock } from "../ids.js";

export type BreakerState = "closed" | "open" | "half-open";
export interface BreakerSnapshot {
  key: string; state: BreakerState; openedAt: string | null; consecutiveFailures: number; windowFailures: number; windowSize: number;
}
interface Entry { state: BreakerState; openedAt: number | null; consecutiveFailures: number; outcomes: boolean[] }
export interface RouteBreaker {
  allow(key: string): { allowed: boolean; state: BreakerState };
  record(key: string, outcome: "ok" | "fail"): void;
  /** Release an unused trial (local rejection, client error, or caller cancellation). */
  abandon(key: string): void;
  snapshot(): BreakerSnapshot[];
}

/** Bounded, process-local model route health. Map order is key creation order. */
export class CircuitBreaker implements RouteBreaker {
  private readonly entries = new Map<string, Entry>();
  private lastTime = -Infinity;
  constructor(private readonly options: {
    clock: Clock; consecutiveFailures: number; window: number; failureRatio: number; cooldownMs: number;
  }) {
    if (!Number.isSafeInteger(options.consecutiveFailures) || options.consecutiveFailures < 1
      || !Number.isSafeInteger(options.window) || options.window < 1
      || !Number.isFinite(options.failureRatio) || options.failureRatio < 0 || options.failureRatio > 1
      || !Number.isSafeInteger(options.cooldownMs) || options.cooldownMs < 0) throw new Error("Invalid breaker configuration");
  }
  private now(): number {
    // Freeze elapsed time during a wall-clock rollback, including failed trials.
    this.lastTime = Math.max(this.lastTime, this.options.clock().getTime());
    return this.lastTime;
  }
  private entry(key: string): Entry | undefined {
    const stored = this.entries.get(key);
    if (stored) return stored;
    if (this.entries.size === 64) {
      const oldest = [...this.entries].find(([, entry]) => entry.state === "closed");
      // Never forget an unhealthy route to admit a new key.
      if (!oldest) return undefined;
      this.entries.delete(oldest[0]);
    }
    const entry: Entry = { state: "closed", openedAt: null, consecutiveFailures: 0, outcomes: [] };
    this.entries.set(key, entry);
    return entry;
  }
  allow(key: string): { allowed: boolean; state: BreakerState } {
    const now = this.now();
    const entry = this.entry(key);
    if (!entry) return { allowed: false, state: "open" };
    if (entry.state === "closed") return { allowed: true, state: "closed" };
    if (entry.state === "open" && entry.openedAt !== null
      && now - entry.openedAt >= this.options.cooldownMs) {
      entry.state = "half-open";
      return { allowed: true, state: "half-open" };
    }
    return { allowed: false, state: entry.state };
  }
  record(key: string, outcome: "ok" | "fail"): void {
    const entry = this.entry(key);
    if (!entry || entry.state === "open") return;
    if (entry.state === "half-open") {
      if (outcome === "ok") {
        entry.state = "closed"; entry.openedAt = null; entry.consecutiveFailures = 0; entry.outcomes = [];
        return;
      }
      entry.consecutiveFailures += 1;
      entry.outcomes.push(true);
      if (entry.outcomes.length > this.options.window) entry.outcomes.shift();
      entry.state = "open";
      entry.openedAt = this.now();
      return;
    }
    entry.consecutiveFailures = outcome === "fail" ? entry.consecutiveFailures + 1 : 0;
    entry.outcomes.push(outcome === "fail");
    if (entry.outcomes.length > this.options.window) entry.outcomes.shift();
    if (entry.consecutiveFailures >= this.options.consecutiveFailures
      || entry.outcomes.length === this.options.window
      && entry.outcomes.filter(Boolean).length / this.options.window > this.options.failureRatio) {
      entry.state = "open"; entry.openedAt = this.now();
    }
  }
  abandon(key: string): void {
    const entry = this.entries.get(key);
    if (entry?.state === "half-open") entry.state = "open";
  }
  snapshot(): BreakerSnapshot[] {
    return [...this.entries].map(([key, entry]) => ({ key, state: entry.state,
      openedAt: entry.openedAt === null ? null : new Date(entry.openedAt).toISOString(),
      consecutiveFailures: entry.consecutiveFailures, windowFailures: entry.outcomes.filter(Boolean).length,
      windowSize: entry.outcomes.length }));
  }
}
export function createRouteBreaker(options: {
  clock: Clock; consecutiveFailures?: number; window?: number; failureRatio?: number; cooldownMs?: number;
}): RouteBreaker {
  return new CircuitBreaker({ consecutiveFailures: 5, window: 20, failureRatio: 0.5, cooldownMs: 300_000, ...options });
}
