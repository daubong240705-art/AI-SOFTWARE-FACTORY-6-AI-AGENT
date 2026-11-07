import { canRequeueAfterLeaseExpiry, type AttemptState } from "@factory/contracts";
import type { EventHub } from "../events/hub.js";
import { createIdGenerator, systemClock, type Clock } from "../ids.js";
import type { Storage } from "../storage/database.js";
import { getTask } from "../work/service.js";
import {
  AttemptError, appendAttemptEvent, createAttempt, getAttempt, isStaleCallback, listLiveAttempts,
  PLACED_ATTEMPT_STATES, renewLease, transitionAttempt,
} from "./attempts.js";
import { buildHandoff } from "./handoff.js";
import { ensureLocalNode, LOCAL_NODE_ID, markNodeSlots, nodeLoad, seatLoad } from "./node.js";
import type { AttemptContext, RuntimeEvent, RuntimeRegistry, RuntimeSession } from "./runtime.js";
import { applyAttemptOutcome, eventsForAttempt, eventsForTask } from "./tasks.js";
import type { AttemptRecord, RuntimeKind } from "./types.js";

export interface DispatcherConfig {
  nodeSlots: number; leaseMs: number; leaseRenewMs: number; leaseCheckMs: number; stopTimeoutMs: number;
}
export const DEFAULT_DISPATCHER_CONFIG: DispatcherConfig = {
  nodeSlots: 2, leaseMs: 60_000, leaseRenewMs: 20_000, leaseCheckMs: 5_000, stopTimeoutMs: 10_000,
};
export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}
export interface RecoverSummary { leaseExpired: number; unknown: number; requeued: number; untouched: number }
export interface Dispatcher {
  start(): RecoverSummary;
  kick(): void;
  enqueue(input: { projectId: string; taskId: string; seatId: string }): AttemptRecord;
  stopAttempt(projectId: string, attemptId: string): Promise<AttemptRecord>;
  reconcileAttempt(projectId: string, attemptId: string): AttemptRecord;
  recover(): RecoverSummary;
  idle(): Promise<void>;
  stop(): Promise<void>;
  status(): { live: number; queued: number; nodeUsed: number; nodeTotal: number };
}
interface Live {
  controller: AbortController; session?: RuntimeSession; done: Promise<void>;
  startSettled: Promise<void>; finishStart(): void;
  fenced: Promise<void>; fence(): void; stopSession?: Promise<void>;
}
const defaultTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms).unref(),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, ms) => setInterval(callback, ms).unref(),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export function createDispatcher(deps: {
  storage: Storage; hub: EventHub; registry: RuntimeRegistry; clock?: Clock; newId?: () => string;
  config?: Partial<DispatcherConfig>; timers?: Timers; onError?: (error: unknown) => void;
}): Dispatcher {
  const { raw } = deps.storage;
  const { hub, registry } = deps;
  const clock = deps.clock ?? systemClock;
  const newId = deps.newId ?? createIdGenerator(clock);
  const timers = deps.timers ?? defaultTimers;
  const config = { ...DEFAULT_DISPATCHER_CONFIG, ...deps.config };
  for (const value of Object.values(config)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid dispatcher configuration");
  }
  const live = new Map<string, Live>();
  const stops = new Map<string, Promise<AttemptRecord>>();
  const waiters = new Set<() => void>();
  let stopped = false;
  let started = false;
  let pumping = false;
  let again = false;
  let scheduled: ReturnType<typeof setImmediate> | undefined;
  let checkTimer: unknown;
  let renewTimer: unknown;
  let stopPromise: Promise<void> | undefined;
  let signalShutdown!: () => void;
  const shutdown = new Promise<void>((resolve) => { signalShutdown = resolve; });
  const report = (error: unknown): void => { try { deps.onError?.(error); } catch { /* Observers cannot break dispatch. */ } };
  const now = (): string => clock().toISOString();
  const current = (projectId: string, id: string): AttemptRecord => {
    const attempt = getAttempt(raw, projectId, id);
    if (!attempt) throw new AttemptError("not-found");
    return attempt;
  };
  const changed = (a: AttemptRecord): void => {
    hub.append({ projectId: a.projectId, causationId: a.id, rootCausationId: a.id, payload: eventsForAttempt(a) });
  };
  const stateEvent = (a: AttemptRecord, body: unknown): void => {
    appendAttemptEvent(raw, { projectId: a.projectId, attemptId: a.id, kind: "state", body, at: now() });
  };
  const move = (a: AttemptRecord, to: AttemptState,
    patch: Parameters<typeof transitionAttempt>[3] = { now: now() },
  ): AttemptRecord => {
    const next = transitionAttempt(raw, a, to, { ...patch, expectedState: a.state, expectedLeaseId: a.leaseId });
    changed(next);
    return next;
  };
  const taskOutcome = (a: AttemptRecord, outcome: "succeeded" | "failed" | "stopped"): void => {
    const task = applyAttemptOutcome(raw, a.projectId, a.taskId, outcome, now());
    if (task) hub.append({ projectId: a.projectId, causationId: a.id, rootCausationId: a.id, payload: eventsForTask(task) });
  };
  const settle = (): void => {
    if (pumping || scheduled !== undefined || live.size > 0) return;
    for (const resolve of waiters) resolve();
    waiters.clear();
  };
  const bounded = async (work: Promise<unknown>): Promise<void> => {
    let handle: unknown;
    try {
      await Promise.race([work, new Promise<never>((_resolve, reject) => {
        handle = timers.setTimeout(() => reject(new Error("runtime stop timed out")), config.stopTimeoutMs);
      })]);
    } finally { if (handle !== undefined) timers.clearTimeout(handle); }
  };
  const stopSession = (entry: Live): Promise<void> => {
    entry.stopSession ??= entry.startSettled.then(async () => { await entry.session?.stop(); });
    return entry.stopSession;
  };
  const create = (input: { projectId: string; taskId: string; seatId: string }): AttemptRecord => {
    const seat = raw.prepare("SELECT runtime FROM seats WHERE id = ?").get(input.seatId) as { runtime: RuntimeKind } | undefined;
    const runtime = seat && registry.get(seat.runtime) ? seat.runtime : "fake";
    const a = createAttempt(raw, { ...input, id: newId(), runtime, provider: "fake", model: "fake", effort: "medium", now: now() });
    changed(a);
    return a;
  };
  const expire = (original: AttemptRecord): "unknown" | "requeued" => hub.transaction(() => {
    let a = current(original.projectId, original.id);
    if (a.state === "stopping") {
      // The contract graph has no stopping -> lease-expired edge: a stop that did not complete is unknown.
      stateEvent(a, { to: "unknown", reason: "stop did not complete before the lease expired: execution outcome is unknown" });
      a = move(a, "unknown");
      markNodeSlots(raw, LOCAL_NODE_ID);
      return "unknown";
    }
    if (a.state !== "lease-expired") a = move(a, "lease-expired");
    const task = getTask(raw, a.projectId, a.taskId);
    // A cancelled task cannot accept a replacement attempt.
    const safe = task?.state === "active" && canRequeueAfterLeaseExpiry(task);
    stateEvent(a, { to: safe ? "requeued" : "unknown", reason: safe
      ? "lease expired: task is safe to requeue" : "lease expired: execution outcome is unknown; operator reconciliation required" });
    a = move(a, safe ? "requeued" : "unknown");
    if (safe && a.seatId) create({ projectId: a.projectId, taskId: a.taskId, seatId: a.seatId });
    markNodeSlots(raw, LOCAL_NODE_ID);
    return safe ? "requeued" : "unknown";
  });
  const recover = (): RecoverSummary => {
    const result: RecoverSummary = { leaseExpired: 0, unknown: 0, requeued: 0, untouched: 0 };
    for (const a of listLiveAttempts(raw)) {
      if (PLACED_ATTEMPT_STATES.has(a.state) || a.state === "lease-expired") {
        if (a.state !== "lease-expired") result.leaseExpired++;
        result[expire(a)]++;
      } else result.untouched++;
    }
    return result;
  };
  const finishOutcome = (a: AttemptRecord, event: Extract<RuntimeEvent, { type: "completed" | "failed" }>): void => {
    hub.transaction(() => {
      if (event.type === "completed") {
        const submitting = move(a, "submitting");
        stateEvent(submitting, { to: "submitting", summary: event.summary });
        taskOutcome(move(submitting, "succeeded"), "succeeded");
      } else {
        // Runtime text is untrusted and may contain secrets. Persist only a fixed message.
        stateEvent(a, { to: "failed", kind: event.kind, message: event.message === "runtime ended without a result"
          ? event.message : "runtime failed" });
        taskOutcome(move(a, "failed"), "failed");
      }
    });
  };
  const failBookkeeping = (original: AttemptRecord, error: unknown): void => {
    report(error);
    if (stopped) return;
    try {
      hub.transaction(() => {
        const a = current(original.projectId, original.id);
        if (!["preparing", "running", "submitting"].includes(a.state)) return;
        stateEvent(a, { to: "failed", kind: "runtime", message: "runtime failed" });
        taskOutcome(move(a, "failed"), "failed");
      });
    } catch (fallbackError) { report(fallbackError); }
  };
  const run = async (leased: AttemptRecord, entry: Live): Promise<void> => {
    let startInvoked = false;
    try {
      const preparing = hub.transaction(() => {
        const a = move(leased, "preparing");
        stateEvent(a, { to: "preparing" });
        return a;
      });
      if (stopped || entry.controller.signal.aborted) return;
      const task = getTask(raw, preparing.projectId, preparing.taskId);
      const seat = raw.prepare("SELECT id, name, role FROM seats WHERE id = ?").get(preparing.seatId) as AttemptContext["seat"] | undefined;
      const adapter = registry.get(preparing.runtime);
      if (!task || !seat || !adapter || !preparing.leaseId) throw new Error("Missing attempt context");
      const context: AttemptContext = {
        ref: { projectId: preparing.projectId, attemptId: preparing.id, epoch: preparing.epoch, leaseId: preparing.leaseId },
        task, seat, handoff: preparing.epoch > 1 ? buildHandoff(raw, preparing.projectId, preparing.taskId) : null,
        signal: entry.controller.signal,
      };
      startInvoked = true;
      const starting = Promise.resolve().then(() => adapter.start(context)).then((session) => {
        entry.session = session;
        if (stopped || entry.controller.signal.aborted) void stopSession(entry).catch(() => report(new Error("runtime stop failed")));
        return session;
      }).finally(entry.finishStart);
      // Fencing detaches even a non-cooperative start or iterator; late settlement cannot write state.
      const session = await Promise.race([starting, entry.fenced.then(() => undefined)]);
      if (!session || stopped || entry.controller.signal.aborted) return;
      if (isStaleCallback(current(preparing.projectId, preparing.id), context.ref, clock().getTime())) return;
      hub.transaction(() => { move(current(preparing.projectId, preparing.id), "running", { startedAt: now(), now: now() }); });
      const iterator = session.events()[Symbol.asyncIterator]();
      while (!stopped && !entry.controller.signal.aborted) {
        const item = await Promise.race([iterator.next(), entry.fenced.then(() => undefined)]);
        if (stopped || entry.controller.signal.aborted) return;
        const a = current(preparing.projectId, preparing.id);
        if (isStaleCallback(a, context.ref, clock().getTime())) return;
        if (!item || item.done) {
          finishOutcome(a, { type: "failed", kind: "runtime", message: "runtime ended without a result" });
          return;
        }
        const event = item.value;
        if (event.type === "completed" || event.type === "failed") { finishOutcome(a, event); return; }
        hub.transaction(() => {
          appendAttemptEvent(raw, { projectId: a.projectId, attemptId: a.id, kind: event.type, body: event, at: now() });
          const expires = new Date(clock().getTime() + config.leaseMs).toISOString();
          changed(a.leaseExpiresAt !== null && expires > a.leaseExpiresAt ? renewLease(raw, a, context.ref.leaseId, expires, now()) : a);
        });
      }
    } catch {
      // Never forward a runtime exception (including its raw text) to storage or observers.
      if (!stopped && !entry.controller.signal.aborted) {
        try {
          const a = current(leased.projectId, leased.id);
          if (leased.leaseId === null || isStaleCallback(a, {
            projectId: leased.projectId, attemptId: leased.id, epoch: leased.epoch, leaseId: leased.leaseId,
          }, clock().getTime())) return;
          failBookkeeping(leased, new Error("runtime or outcome bookkeeping failed"));
        } catch { report(new Error("attempt bookkeeping failed")); }
      }
    } finally {
      if (!startInvoked) entry.finishStart();
      // An operator stop owns the execution until stop() settles or its deadline expires.
      const stopping = stops.get(`${leased.projectId}:${leased.id}`);
      if (stopping && !stopped) await Promise.race([stopping.catch(() => undefined), shutdown]);
      live.delete(leased.id);
      if (!stopped) {
        try { markNodeSlots(raw, LOCAL_NODE_ID); } catch (error) { report(error); }
        kick();
      }
      settle();
    }
  };
  const pump = (): void => {
    pumping = true;
    try {
      do {
        again = false;
        while (!stopped) {
          const load = nodeLoad(raw, LOCAL_NODE_ID);
          if (load.used >= load.total) break;
          const rows = raw.prepare(`SELECT a.project_id, a.id FROM attempts AS a JOIN tasks AS t
            ON t.project_id = a.project_id AND t.id = a.task_id JOIN engagements AS e
            ON e.project_id = t.project_id AND e.id = t.engagement_id
            WHERE a.state = ? AND t.state = ? ORDER BY e.priority DESC, a.rowid`).all("queued", "active") as { project_id: string; id: string }[];
          const next = rows.map((row) => current(row.project_id, row.id)).find((a) => {
            if (!a.seatId) return false;
            const seat = seatLoad(raw, a.seatId);
            return seat.used < seat.slots;
          });
          if (!next) break;
          const leased = hub.transaction(() => {
            const a = move(next, "leased", { nodeId: LOCAL_NODE_ID, leaseId: newId(),
              leaseExpiresAt: new Date(clock().getTime() + config.leaseMs).toISOString(), now: now() });
            markNodeSlots(raw, LOCAL_NODE_ID);
            return a;
          });
          let finishStart!: () => void;
          let fence!: () => void;
          const entry: Live = { controller: new AbortController(), done: Promise.resolve(),
            startSettled: new Promise<void>((resolve) => { finishStart = resolve; }), finishStart: () => finishStart(),
            fenced: new Promise<void>((resolve) => { fence = resolve; }), fence: () => fence() };
          live.set(leased.id, entry);
          entry.done = Promise.resolve().then(() => {
            if (stopped || entry.controller.signal.aborted) { live.delete(leased.id); entry.finishStart(); settle(); return; }
            return run(leased, entry);
          });
        }
      } while (again && !stopped);
    } catch (error) { report(error); }
    finally { pumping = false; settle(); }
  };
  const kick = (): void => {
    if (stopped || !started) return;
    if (pumping) { again = true; return; }
    if (scheduled !== undefined) return;
    scheduled = setImmediate(() => { scheduled = undefined; pump(); });
  };
  const leaseCheck = (): void => {
    if (stopped) return;
    try {
      for (const a of listLiveAttempts(raw)) {
        if (!PLACED_ATTEMPT_STATES.has(a.state) || a.leaseExpiresAt === null || Date.parse(a.leaseExpiresAt) > clock().getTime()) continue;
        const entry = live.get(a.id);
        entry?.controller.abort();
        entry?.fence();
        if (entry) void stopSession(entry).catch(() => report(new Error("runtime stop failed")));
        expire(a);
      }
      kick();
    } catch (error) { report(error); }
  };
  const renew = (): void => {
    if (stopped) return;
    try {
      for (const [id, entry] of live) {
        if (!entry.session || entry.controller.signal.aborted) continue;
        const row = raw.prepare("SELECT project_id FROM attempts WHERE id = ?").get(id) as { project_id: string } | undefined;
        if (!row) continue;
        const a = current(row.project_id, id);
        if (!a.leaseId || !a.leaseExpiresAt || Date.parse(a.leaseExpiresAt) <= clock().getTime()) continue;
        const expires = new Date(clock().getTime() + config.leaseMs).toISOString();
        if (expires > a.leaseExpiresAt) hub.transaction(() => { changed(renewLease(raw, a, a.leaseId as string, expires, now())); });
      }
    } catch (error) { report(error); }
  };
  const stopAttempt = (projectId: string, id: string): Promise<AttemptRecord> => {
    const key = `${projectId}:${id}`;
    const existing = stops.get(key);
    if (existing) return existing;
    const promise = Promise.resolve().then(async () => {
      if (stopped) throw new AttemptError("dispatcher-stopped");
      let a = current(projectId, id);
      if (a.state === "queued") return hub.transaction(() => {
        a = move(a, "stopped"); taskOutcome(a, "stopped"); kick(); return a;
      });
      if (a.state === "leased") {
        // No runtime has been started for a merely leased attempt: nothing to wait for (leased -> stopped).
        const entry = live.get(id);
        entry?.controller.abort();
        entry?.fence();
        return hub.transaction(() => {
          const latest = current(projectId, id);
          if (latest.state !== "leased") return latest;
          const final = move(latest, "stopped");
          taskOutcome(final, "stopped");
          markNodeSlots(raw, LOCAL_NODE_ID);
          kick();
          return final;
        });
      }
      if (!["preparing", "running", "waiting-input"].includes(a.state)) throw new AttemptError("transition-not-allowed");
      a = hub.transaction(() => move(a, "stopping"));
      const entry = live.get(id);
      entry?.controller.abort();
      entry?.fence();
      let ended = false;
      try {
        if (!entry) throw new Error("runtime session unavailable");
        ended = await Promise.race([
          bounded(stopSession(entry)).then(() => true, () => {
            report(new Error("runtime stop failed or timed out")); return false;
          }),
          shutdown.then(() => false),
        ]);
      } catch { report(new Error("runtime stop failed or timed out")); }
      if (stopped) return current(projectId, id);
      return hub.transaction(() => {
        const latest = current(projectId, id);
        if (latest.state !== "stopping") return latest;
        const final = move(latest, ended ? "stopped" : "unknown");
        if (ended) taskOutcome(final, "stopped");
        markNodeSlots(raw, LOCAL_NODE_ID);
        kick();
        return final;
      });
    });
    stops.set(key, promise);
    void promise.finally(() => { stops.delete(key); }).catch(() => undefined);
    return promise;
  };
  return {
    start() {
      if (stopped) throw new AttemptError("dispatcher-stopped");
      if (started) return { leaseExpired: 0, unknown: 0, requeued: 0, untouched: listLiveAttempts(raw).length };
      ensureLocalNode(raw, { slots: config.nodeSlots, now: now() });
      const result = recover();
      started = true;
      checkTimer = timers.setInterval(leaseCheck, config.leaseCheckMs);
      renewTimer = timers.setInterval(renew, config.leaseRenewMs);
      return result;
    },
    kick, recover, stopAttempt,
    enqueue(input) {
      if (stopped) throw new AttemptError("dispatcher-stopped");
      const a = hub.transaction(() => create(input));
      kick();
      return a;
    },
    reconcileAttempt(projectId, id) {
      const result = hub.transaction(() => {
        let a = current(projectId, id);
        if (a.state !== "unknown") throw new AttemptError("transition-not-allowed");
        a = move(a, "reconciling");
        stateEvent(a, { to: "failed", reason: "reconciled by operator: outcome was unknown" });
        a = move(a, "failed", { outcome: "known", now: now() });
        taskOutcome(a, "failed");
        markNodeSlots(raw, LOCAL_NODE_ID);
        return a;
      });
      kick();
      return result;
    },
    idle: () => pumping || scheduled !== undefined || live.size > 0
      ? new Promise<void>((resolve) => { waiters.add(resolve); }) : Promise.resolve(),
    stop() {
      stopPromise ??= (async () => {
        stopped = true;
        signalShutdown();
        if (scheduled !== undefined) { clearImmediate(scheduled); scheduled = undefined; }
        if (checkTimer !== undefined) timers.clearInterval(checkTimer);
        if (renewTimer !== undefined) timers.clearInterval(renewTimer);
        const entries = [...live.values()];
        for (const entry of entries) { entry.controller.abort(); entry.fence(); }
        try { await bounded(Promise.all(entries.map(stopSession))); }
        catch { report(new Error("runtime shutdown failed or timed out")); }
        await Promise.allSettled(entries.map((entry) => entry.done));
        settle();
      })();
      return stopPromise;
    },
    status() {
      const attempts = listLiveAttempts(raw);
      const load = nodeLoad(raw, LOCAL_NODE_ID);
      return { live: live.size, queued: attempts.filter((a) => a.state === "queued").length, nodeUsed: load.used, nodeTotal: load.total };
    },
  };
}
