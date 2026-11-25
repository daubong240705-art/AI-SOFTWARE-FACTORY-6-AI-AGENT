import type { ApiClient } from '@/api/client';
import type { GroupsResponse } from '@factory/contracts';
import { isActiveRun } from '../../office/liveModel';
import { deriveWorld } from './deriveWorld';
import { shareEqual } from './shareEqual';
import { createWorldPoller, type PollClock, type PollJob } from './poller';
import { createWorldSeen, diffWorld, type WorldEvent } from './events';
import type { Assignments, WorldInputs, WorldModel } from './types';

export type WorldDataApi = Pick<ApiClient, 'getOrgActivity' | 'listProjects' | 'getProjectInteractions' | 'listTasks'
  | 'listProjectAgents' | 'listProjectAttempts' | 'listProjectFlows' | 'getFlowRun' | 'getInbox'> & {
  listGroups: (signal: AbortSignal) => Promise<GroupsResponse>;
};
export type WorldSource = {state: 'ok' | 'error' | 'pending'; at: number};
export type WorldSnapshot = {baseline: boolean; model: WorldModel; events: WorldEvent[]; sources: Record<string, WorldSource>; interactions: WorldInputs['interactions']};
const emptyInputs = () => ({ interactions: {}, tasks: {}, rosters: {}, attempts: {}, inboxes: {}, flows: {}, runDetails: {} }) satisfies WorldInputs;
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
  const inputs: WorldInputs & Required<Pick<WorldInputs, 'rosters' | 'attempts' | 'inboxes' | 'flows' | 'runDetails'>> = emptyInputs();
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
  const poller = createWorldPoller({hidden: options.hidden, clock, maxConcurrent: 8, onError: key => {
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
      activity: model.loaded.activity && model.projects.every(project => successful.has(`agents:${project.id}`)), projects: successful.has('projects'),
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
        for (const collection of [inputs.tasks, inputs.interactions, inputs.rosters, inputs.attempts, inputs.flows, inputs.inboxes]) {
          for (const id of Object.keys(collection)) if (!active.has(id)) delete collection[id];
        }
        emit({events: snapshot.events.filter(event => event.type !== 'handoff' || active.has(event.handoff.projectId))});
      }),
      read('groups', 60000, api.listGroups, value => { inputs.groups = value; }),
    ];
    const focus = model.focusProjectId;
    const projects = [...model.projects].sort((left, right) => Number(right.id === focus) - Number(left.id === focus));
    for (const { id } of projects) jobs.push(read(`agents:${id}`, id === focus ? 10000 : 30000, signal => api.listProjectAgents(id, signal), value => { inputs.rosters[id] = value; }));
    for (const { id } of projects) {
      const interval = id === focus ? 6000 : 30000;
      jobs.push(
        read(`interactions:${id}`, interval, signal => api.getProjectInteractions(id, 60, signal), value => { inputs.interactions[id] = value; }),
        read(`tasks:${id}`, interval + 2000, signal => api.listTasks(id, signal), value => { inputs.tasks[id] = value.items; }),
        read(`attempts:${id}`, interval, () => api.listProjectAttempts(id, { limit: id === focus ? 300 : 100 }), value => { inputs.attempts[id] = value.attempts; }),
        read(`inbox:${id}`, interval, () => api.getInbox(id), value => { inputs.inboxes[id] = value; }),
        read(`flows:${id}`, interval, signal => api.listProjectFlows(id, signal), value => { inputs.flows[id] = value; }),
      );
    }
    const detailed = projects.flatMap(({ id }) => (inputs.flows[id]?.runs ?? []).filter(isActiveRun).slice(0, 6));
    const currentRuns = new Set(detailed.map(run => run.id));
    for (const id of Object.keys(inputs.runDetails)) if (!currentRuns.has(id)) delete inputs.runDetails[id];
    for (const run of detailed) jobs.push(read(`run:${run.id}`, run.projectId === focus ? 6500 : 30000, signal => api.getFlowRun(run.projectId, run.id, signal), value => { inputs.runDetails[run.id] = value; }));
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
    refresh(keys: readonly string[]) {for (const key of keys) poller.refresh(key);},
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
