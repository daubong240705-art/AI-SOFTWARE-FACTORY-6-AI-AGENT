import { systemClock, type Clock } from "../ids.js";
import type { BackupResult } from "./service.js";

interface Timer { unref?(): unknown }
export interface BackupTimers {
  setTimeout(callback: () => void, delayMs: number): Timer;
  clearTimeout(timer: Timer): void;
}

export function startBackupScheduler(options: {
  service: { run(reason: "hourly"): BackupResult | Promise<BackupResult> };
  intervalMs?: number; firstRunDelayMs?: number; clock?: Clock; timers?: BackupTimers;
}): { stop(): Promise<void> } {
  const interval = options.intervalMs ?? 3_600_000;
  const delay = options.firstRunDelayMs ?? 5000;
  if (!Number.isSafeInteger(interval) || interval < 1 || !Number.isSafeInteger(delay) || delay < 0)
    throw new Error("Backup schedule requires a positive interval and nonnegative first delay");
  const clock = options.clock ?? systemClock;
  const timers = options.timers ?? {
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clearTimeout: (timer: Timer) => clearTimeout(timer as NodeJS.Timeout),
  };
  let stopped = false;
  let timer: Timer | undefined;
  let running: Promise<void> | undefined;
  let due = clock().getTime() + delay;
  const schedule = (): void => {
    timer = timers.setTimeout(() => {
      timer = undefined;
      // Queue the call too, so stop() observes even a reentrant service implementation.
      running = Promise.resolve().then(() => options.service.run("hourly")).then(() => {}, () => {}).finally(() => {
        running = undefined;
        if (stopped) return;
        due += interval;
        const now = clock().getTime();
        if (due <= now) due += (Math.floor((now - due) / interval) + 1) * interval;
        schedule();
      });
    }, Math.max(0, due - clock().getTime()));
    timer.unref?.();
  };
  schedule();
  return { async stop() {
    stopped = true;
    if (timer !== undefined) { timers.clearTimeout(timer); timer = undefined; }
    await running;
  } };
}
