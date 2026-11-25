import type { ApiClient } from '@/api/client';
import { deriveWorld } from './deriveWorld';
import { shareEqual } from './shareEqual';
import { createWorldPoller, type PollClock, type PollJob } from './poller';
import { createWorldSeen, diffWorld, type WorldEvent } from './events';
import type { Assignments, WorldInputs, WorldModel } from './types';

export type WorldDataApi = Pick<ApiClient, 'getOrgActivity' | 'listProjects' | 'getProjectInteractions' | 'listTasks'>;
export type WorldSource = {state: 'ok' | 'error' | 'pending'; at: number};
export type WorldSnapshot = {baseline: boolean; model: WorldModel; events: WorldEvent[]; sources: Record<string, WorldSource>; interactions: WorldInputs['interactions']};
const emptyInputs = (): WorldInputs => ({interactions: {}, tasks: {}});
export const emptyWorldSnapshot = (): WorldSnapshot => ({baseline: false, model: deriveWorld(emptyInputs()).model, events: [], sources: {}, interactions: {}});

/** Browser-independent polling coordinator. All time and visibility can be injected. */
export function createWorldDataController(api: WorldDataApi, options: {
  hidden: () => boolean;
  onSnapshot: (snapshot: WorldSnapshot) => void;
  now?: () => number;
  clock?: PollClock;
  focusProjectId?: string | null;
}) {
  const localNow = options.now ?? Date.now;
  const clock: PollClock = options.clock ?? {set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id as ReturnType<typeof setTimeout>), random: Math.random};
  let stopped = false;
  let snapshot = emptyWorldSnapshot();
  const inputs = emptyInputs();
  inputs.focusProjectId = options.focusProjectId ?? null;
  let assignment: Assignments = {};
  let previous: WorldModel | null = null;
  let started = localNow();
  let serverClock: {at: number; received: number} | null = null;
  const serverNow = () => serverClock ? serverClock.at + localNow() - serverClock.received : localNow();
  let seen = createWorldSeen(serverNow());
  const successful = new Set<string>();
  let hiddenSince: number | null = options.hidden() ? localNow() : null;
  let baselineTimer: unknown;
  const emit = (patch: Partial<WorldSnapshot>) => {
    if (stopped) return;
    const next = shareEqual(snapshot, {...snapshot, ...patch});
    if (next === snapshot) return;
    snapshot = next;
    options.onSnapshot(snapshot);
  };
  const poller = createWorldPoller({hidden: options.hidden, clock, onError: key => {
    emit({sources: {...snapshot.sources, [key]: {state: 'error', at: localNow()}}});
  }});
  function publish() {
    if (stopped) return;
    const now = serverNow();
    inputs.serverNow = new Date(now).toISOString();
    const result = deriveWorld(inputs, assignment);
    assignment = result.assign;
    const model = result.model;
    // Keep last good data visible on resume while refreshing animation baselines.
    model.loaded = {
      activity: successful.has('activity'), projects: successful.has('projects'),
      interactions: model.loaded.interactions.filter(id => successful.has(`interactions:${id}`)),
    };
    const diff = diffWorld(previous, model, seen, now);
    seen = diff.seen;
    previous = model;
    // generatedAt is transport metadata, not scene content. Preserve the last
    // timestamp when all rendered slices are unchanged.
    const stable = shareEqual(snapshot.model, { ...model, generatedAt: snapshot.model.generatedAt });
    emit({baseline: seen.baseline, model: stable === snapshot.model ? stable : { ...stable, generatedAt: model.generatedAt }, interactions: {...inputs.interactions}, events: [...snapshot.events, ...diff.events]});
    sync(model);
  }
  function read<T>(key: string, interval: number, fetch: (signal: AbortSignal) => Promise<T>, accept: (value: T) => void): PollJob {
    return {key, interval, run: async signal => {
      if (!snapshot.sources[key]) emit({sources: {...snapshot.sources, [key]: {state: 'pending', at: localNow()}}});
      const value = await fetch(signal);
      if (stopped || signal.aborted) return;
      accept(value);
      successful.add(key);
      if (snapshot.sources[key]?.state !== 'ok') emit({sources: {...snapshot.sources, [key]: {state: 'ok', at: localNow()}}});
      publish();
    }};
  }
  function sync(model: WorldModel) {
    const jobs: PollJob[] = [
      read('activity', 5000, api.getOrgActivity, value => {
        inputs.activity = value;
        serverClock = {at: Date.parse(value.generatedAt), received: localNow()};
        if (!successful.has('activity')) seen.startedAt = serverNow() - (localNow() - started);
      }),
      read('projects', 10000, api.listProjects, value => {
        inputs.projects = value.projects.filter(project => project.disposition !== 'archived');
        const active = new Set(inputs.projects.map(project => project.id));
        if (inputs.focusProjectId && !active.has(inputs.focusProjectId)) inputs.focusProjectId = null;
        for (const collection of [inputs.tasks, inputs.interactions]) {
          for (const id of Object.keys(collection)) if (!active.has(id)) delete collection[id];
        }
        emit({events: snapshot.events.filter(event => event.type !== 'handoff' || active.has(event.handoff.projectId))});
      }),
    ];
    const focus = model.focusProjectId;
    const hot = model.hotProjects.map(project => project.id);
    for (const id of new Set(focus ? [...hot, focus] : hot)) {
      jobs.push(read(`interactions:${id}`, hot.includes(id) ? 6000 : 15000, signal => api.getProjectInteractions(id, 60, signal), value => { inputs.interactions[id] = value; }));
    }
    if (focus) jobs.push(read(`tasks:${focus}`, 15000, signal => api.listTasks(focus, signal), value => { inputs.tasks[focus] = value.items; }));
    poller.sync(jobs);
  }
  function startBaselineTimer() {
    if (baselineTimer !== undefined) clock.clear(baselineTimer);
    baselineTimer = clock.set(publish, 4000);
  }
  return {
    start() {publish(); startBaselineTimer();},
    getSnapshot: () => snapshot,
    setFocusProjectId(id: string | null) {inputs.focusProjectId = id; publish();},
    consumeEvents(ids?: readonly string[]) {
      const consumed = ids ? new Set(ids) : null;
      emit({events: consumed ? snapshot.events.filter(e => !consumed.has(e.id)) : []});
    },
    visibility() {
      if (options.hidden()) hiddenSince = localNow();
      else {
        if (hiddenSince !== null && localNow() - hiddenSince >= 30000) {
          successful.clear(); started = localNow(); seen = createWorldSeen(serverNow()); previous = null;
          emit({baseline: false, events: []}); startBaselineTimer();
        }
        hiddenSince = null;
      }
      poller.visibility();
    },
    stop() {
      stopped = true;
      if (baselineTimer !== undefined) clock.clear(baselineTimer);
      poller.stop();
    },
  };
}
