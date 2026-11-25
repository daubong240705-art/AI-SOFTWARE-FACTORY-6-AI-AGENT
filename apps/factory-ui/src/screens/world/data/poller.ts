export type PollJob = {key: string; interval: number; run: (signal: AbortSignal) => Promise<void>};
export type PollClock = {set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void; random: () => number};
const clock: PollClock = {set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id as ReturnType<typeof setTimeout>), random: Math.random};
type JobState = {job: PollJob; timer?: unknown; controller: AbortController | null; failures: number; again: boolean; done: boolean; enabled: boolean};

/** One in-flight request per key, including invalidations and scope changes. */
export function createWorldPoller(options: {hidden: () => boolean; onError: (key: string) => void; clock?: PollClock; maxConcurrent?: number}) {
  const timer = options.clock ?? clock;
  const jobs = new Map<string, JobState>();
  const waiting = new Set<JobState>();
  let active = 0;
  let stopped = false;
  function clear(state: JobState) {
    if (state.timer !== undefined) timer.clear(state.timer);
    delete state.timer;
  }
  function schedule(state: JobState, delay: number) {
    clear(state);
    if (!stopped && state.enabled && !options.hidden() && Number.isFinite(delay)) {
      state.timer = timer.set(() => {delete state.timer; void run(state);}, delay);
    }
  }
  async function run(state: JobState) {
    if (stopped || !state.enabled || options.hidden()) return;
    if (state.controller) {state.again = true; return;}
    if (active >= (options.maxConcurrent ?? Infinity)) {waiting.add(state); return;}
    waiting.delete(state); active++;
    const controller = new AbortController();
    state.controller = controller;
    try {
      await state.job.run(controller.signal);
      if (!controller.signal.aborted) {state.failures = 0; state.done = true;}
    } catch {
      if (!controller.signal.aborted) {state.failures++; options.onError(state.job.key);}
    } finally {
      active--;
      state.controller = null;
      if (!state.enabled) jobs.delete(state.job.key);
      else if (!stopped) {
        const normal = state.job.interval;
        const base = state.failures ? Math.min(60000, (Number.isFinite(normal) ? normal : 5000) * 2 ** Math.min(state.failures, 16)) : normal;
        const jittered = base * (0.9 + timer.random() * 0.2);
        const delay = state.again ? 0 : state.failures ? Math.min(60000, jittered) : jittered;
        state.again = false;
        schedule(state, delay);
      }
      for (const next of waiting) {
        if (active >= (options.maxConcurrent ?? Infinity)) break;
        waiting.delete(next); void run(next);
      }
    }
  }
  return {
    sync(wanted: PollJob[]) {
      const keys = new Set(wanted.map(job => job.key));
      for (const [key, state] of jobs) if (!keys.has(key)) {
        clear(state); waiting.delete(state); state.enabled = false; state.again = false; state.controller?.abort();
        // Retain an aborted request until its promise settles. Re-adding the
        // same key must not start another request alongside it.
        if (!state.controller) jobs.delete(key);
      }
      for (const job of wanted) {
        const existing = jobs.get(job.key);
        if (existing) {
          const resume = !existing.enabled;
          existing.job = job; existing.enabled = true;
          if (resume) void run(existing);
        } else {
          const state: JobState = {job, controller: null, failures: 0, again: false, done: false, enabled: true};
          jobs.set(job.key, state); void run(state);
        }
      }
    },
    refresh(key: string) {
      const state = jobs.get(key);
      if (state?.enabled) {clear(state); void run(state);}
    },
    visibility() {
      for (const state of jobs.values()) {
        clear(state);
        if (options.hidden()) state.controller?.abort();
        else if (!state.done || Number.isFinite(state.job.interval)) void run(state);
      }
    },
    stop() {
      stopped = true;
      for (const state of jobs.values()) {clear(state); state.controller?.abort();}
      jobs.clear();
      waiting.clear();
    },
  };
}
