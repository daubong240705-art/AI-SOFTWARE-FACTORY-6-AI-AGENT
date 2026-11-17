import type { ApiClient } from '@/api/client';
import { deriveWorld } from './deriveWorld';
import { createWorldPoller, type PollClock, type PollJob } from './poller';
import { createWorldSeen, diffWorld, type WorldEvent } from './events';
import type { Assignments, WorldInputs, WorldModel } from './types';

export type WorldDataApi = Pick<ApiClient, 'getOrgActivity' | 'listTeams' | 'listGames' | 'getProjectInteractions' | 'listTasks' | 'getWorkflow' | 'getGameReport' | 'listReleases' | 'getPortal' | 'portalGames' | 'portalStats'>;
export type WorldSource = {state: 'ok' | 'error' | 'pending'; at: number};
export type WorldSnapshot = {baseline: boolean; model: WorldModel; events: WorldEvent[]; sources: Record<string, WorldSource>; reports: Record<string, import('@factory/contracts').GameReport | undefined>};
const emptyInputs = (): WorldInputs => ({interactions: {}, tasks: {}, workflows: {}, reports: {}, releases: {}});
export const emptyWorldSnapshot = (): WorldSnapshot => ({baseline: false, model: deriveWorld(emptyInputs()).model, events: [], sources: {}, reports: {}});

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
  const releaseSignatures = new Map<string, string>();
  let seats: string | null = null;
  let hiddenSince: number | null = options.hidden() ? localNow() : null;
  let baselineTimer: unknown;
  const emit = (patch: Partial<WorldSnapshot>) => {
    if (stopped) return;
    snapshot = {...snapshot, ...patch};
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
      activity: successful.has('activity'), teams: successful.has('teams'), games: successful.has('games'),
      interactions: model.loaded.interactions.filter(id => successful.has(`interactions:${id}`)),
      reports: model.loaded.reports.filter(id => successful.has(`report:${id}`)),
      releases: model.loaded.releases.filter(id => successful.has(`releases:${id}`)),
    };
    const diff = diffWorld(previous, model, seen, now);
    seen = diff.seen;
    previous = model;
    emit({baseline: seen.baseline, model, reports: {...inputs.reports}, events: [...snapshot.events, ...diff.events]});
    sync(model);
  }
  function read<T>(key: string, interval: number, fetch: (signal: AbortSignal) => Promise<T>, accept: (value: T) => void): PollJob {
    return {key, interval, run: async signal => {
      if (!snapshot.sources[key]) emit({sources: {...snapshot.sources, [key]: {state: 'pending', at: localNow()}}});
      const value = await fetch(signal);
      if (stopped || signal.aborted) return;
      accept(value);
      successful.add(key);
      emit({sources: {...snapshot.sources, [key]: {state: 'ok', at: localNow()}}});
      publish();
    }};
  }
  function sync(model: WorldModel) {
    const jobs: PollJob[] = [
      read('activity', 5000, s => api.getOrgActivity(s), v => {
        inputs.activity = v;
        serverClock = {at: Date.parse(v.generatedAt), received: localNow()};
        if (!successful.has('activity')) seen.startedAt = serverNow() - (localNow() - started);
        const ids = v.teams.flatMap(t => t.seats.map(s => s.id)).sort().join('|');
        if (seats !== null && ids !== seats) poller.refresh('teams');
        seats = ids;
      }),
      read('games', 10000, s => api.listGames(s), v => {
        inputs.games = v;
        for (const g of v.games) {
          const sig = g.release ? `${g.release.version}:${g.release.state}` : '';
          const old = releaseSignatures.get(g.projectId);
          releaseSignatures.set(g.projectId, sig);
          if (old !== undefined && old !== sig) poller.refresh(`releases:${g.projectId}`);
        }
      }),
      read('teams', 60000, s => api.listTeams(s), v => {inputs.teams = v;}),
      read('portal', Infinity, s => api.getPortal(s), v => {inputs.portal = v;}),
    ];
    const games = inputs.games?.games ?? [];
    for (const g of model.hotProjects) {
      const id = g.projectId;
      jobs.push(read(`interactions:${id}`, 6000, s => api.getProjectInteractions(id, 60, s), v => {inputs.interactions[id] = v;}));
      jobs.push(read(`report:${id}`, 15000, s => api.getGameReport(id, s), v => {inputs.reports[id] = v;}));
    }
    const focus = model.focusProjectId;
    if (focus) {
      jobs.push(read(`tasks:${focus}`, 15000, s => api.listTasks(focus, s), v => {inputs.tasks[focus] = v.items;}));
      const workflow = games.find(g => g.projectId === focus)?.workflow;
      if (workflow) jobs.push(read(`workflow:${focus}:${workflow.instanceId}`, 15000, s => api.getWorkflow(focus, workflow.instanceId, s), v => {inputs.workflows[focus] = v.instance;}));
    }
    for (const g of games) jobs.push(read(`releases:${g.projectId}`, 60000, s => api.listReleases(g.projectId, s), v => {inputs.releases[g.projectId] = v;}));
    if (inputs.portal?.configured) {
      jobs.push(read('portal-games', 60000, s => api.portalGames(s), v => {inputs.portalGames = v;}));
      jobs.push(read('portal-stats', 15000, s => api.portalStats({}, s), v => {inputs.portalStats = v;}));
    }
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
