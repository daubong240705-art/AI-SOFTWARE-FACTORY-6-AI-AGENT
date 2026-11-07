import type { AttemptContext, RuntimeAdapter, RuntimeEvent, RuntimeSession } from "./runtime.js";
import type { AttemptRef } from "./types.js";

export interface FakeTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
export interface FakeRuntime extends RuntimeAdapter {
  readonly kind: "fake";
  readonly started: AttemptContext[];
  readonly stopped: AttemptRef[];
  readonly ended: AttemptRef[];
}

export function createFakeRuntime(options: { stepMs?: number; timers?: FakeTimers } = {}): FakeRuntime {
  const stepMs = options.stepMs ?? 5;
  if (!Number.isFinite(stepMs) || stepMs < 0) throw new Error("stepMs must be finite and non-negative");
  const timers: FakeTimers = options.timers ?? {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const started: AttemptContext[] = [];
  const stopped: AttemptRef[] = [];
  const executionsEnded: AttemptRef[] = [];
  return {
    kind: "fake", started, stopped, ended: executionsEnded,
    async start(context): Promise<RuntimeSession> {
      started.push(context);
      const goal = context.task.goal;
      if (goal.includes("[fake:crash]")) { executionsEnded.push({ ...context.ref }); throw new Error("Fake crash"); }
      const queue: RuntimeEvent[] = [];
      const readers: Array<(result: IteratorResult<RuntimeEvent>) => void> = [];
      let cancelled = false;
      let ended = false;
      let cancelWait: (() => void) | undefined;
      let stopPromise: Promise<void> | undefined;
      const emit = (event: RuntimeEvent): void => {
        if (cancelled) return;
        const reader = readers.shift();
        if (reader) reader({ done: false, value: event });
        else queue.push(event);
      };
      const wait = (ms?: number): Promise<void> => new Promise((resolve) => {
        if (cancelled) { resolve(); return; }
        let handle: unknown;
        const finish = (): void => {
          if (handle !== undefined) timers.clearTimeout(handle);
          cancelWait = undefined;
          resolve();
        };
        cancelWait = finish;
        if (ms !== undefined) handle = timers.setTimeout(finish, ms);
      });
      const onAbort = (): void => { void stop(); };
      const execution = Promise.resolve().then(async () => {
        try {
          if (cancelled) return;
          if (goal.includes("[fake:silent]")) { await wait(); return; }
          emit({ type: "progress", message: "Starting" });
          if (goal.includes("[fake:hang]")) { await wait(); return; }
          const script: RuntimeEvent[] = goal.includes("[fake:fail]")
            ? [{ type: "failed", kind: "runtime", message: "Fake failure" }]
            : [{ type: "progress", message: "Working", percent: 50 },
              { type: "evidence", name: "fake-check", detail: "passed" },
              { type: "completed", summary: `Fake work done for ${context.task.code}` }];
          for (const event of script) {
            await wait(stepMs * (goal.includes("[fake:slow]") ? 10 : 1));
            if (cancelled) return;
            emit(event);
          }
        } finally {
          executionsEnded.push({ ...context.ref });
          ended = true;
          context.signal.removeEventListener("abort", onAbort);
          for (const reader of readers.splice(0)) reader({ done: true, value: undefined });
        }
      });
      function stop(): Promise<void> {
        if (stopPromise === undefined) {
          stopped.push({ ...context.ref });
          cancelled = true;
          queue.length = 0;
          cancelWait?.();
          stopPromise = execution.then(() => undefined);
        }
        return stopPromise;
      }
      const iterator: AsyncIterableIterator<RuntimeEvent> = {
        [Symbol.asyncIterator]() { return this; },
        next(): Promise<IteratorResult<RuntimeEvent>> {
          const event = queue.shift();
          if (event !== undefined) return Promise.resolve({ done: false, value: event });
          if (ended) return Promise.resolve({ done: true, value: undefined });
          return new Promise((resolve) => { readers.push(resolve); });
        },
        async return(): Promise<IteratorResult<RuntimeEvent>> {
          await stop();
          return { done: true, value: undefined };
        },
      };
      context.signal.addEventListener("abort", onAbort, { once: true });
      if (context.signal.aborted) onAbort();
      return { events: () => iterator, stop };
    },
  };
}
