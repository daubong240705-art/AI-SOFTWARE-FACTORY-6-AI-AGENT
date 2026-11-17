import type { Bug, Handoff, ReleaseVersion, WorldAgent, WorldModel } from './types';
export type WorldEvent = {
  type: 'handoff';
  id: string;
  at: string;
  handoff: Handoff;
} | {
  type: 'bugSpawned' | 'bugDefeated';
  id: string;
  at: string;
  bug: Bug;
} | {
  type: 'release';
  id: string;
  at: string;
  release: ReleaseVersion;
} | {
  type: 'poseChanged';
  id: string;
  at: string;
  seatId: string;
  from: WorldAgent['pose'];
  to: WorldAgent['pose'];
};
export type WorldSeen = {
  startedAt: number;
  baseline: boolean;
  reset: boolean;
  interactions: Set<string>;
  reports: Set<string>;
  releases: Set<string>;
  ids: Set<string>;
  versions: Record<string, number>;
};
export function createWorldSeen(now: number): WorldSeen {
  return { startedAt: now, baseline: false, reset: false, interactions: new Set(), reports: new Set(), releases: new Set(), ids: new Set(), versions: {} };
}
/** Pure diff: callers can keep the old model and seen snapshot unchanged. */
export function diffWorld(prev: WorldModel | null, next: WorldModel, seen: WorldSeen, serverNow: string | number): {
  events: WorldEvent[];
  seen: WorldSeen;
} {
  const now = typeof serverNow === 'string' ? Date.parse(serverNow) : serverNow;
  const fresh = (at: string) => Number.isFinite(now) && now >= Date.parse(at) && now - Date.parse(at) <= 90000;
  const at = next.generatedAt;
  const state: WorldSeen = { ...seen, interactions: new Set(seen.interactions), reports: new Set(seen.reports), releases: new Set(seen.releases), ids: new Set(seen.ids), versions: { ...seen.versions } };
  const ready = next.loaded.activity && next.loaded.teams && next.loaded.games;
  const baseline = state.reset || !state.baseline;
  if (ready || now - state.startedAt >= 4000 || state.reset)
    state.baseline = true;
  state.reset = false;
  const events: WorldEvent[] = [];
  for (const handoff of next.handoffs) {
    const id = `handoff:${handoff.id}`;
    if (!baseline && state.interactions.has(handoff.projectId) && next.loaded.interactions.includes(handoff.projectId) && !state.ids.has(id) && fresh(handoff.at)) {
      events.push({ type: 'handoff', id, at: handoff.at, handoff });
    }
    state.ids.add(id);
  }
  if (!baseline && fresh(at) && prev) {
    for (const bug of next.bugs) {
      if (state.reports.has(bug.projectId) && next.loaded.reports.includes(bug.projectId) && !prev.bugIds.includes(bug.id))
        events.push({ type: 'bugSpawned', id: `bugSpawned:${bug.id}:${at}`, at, bug });
    }
    for (const bug of prev.bugs) {
      if (next.loaded.reports.includes(bug.projectId) && !next.bugIds.includes(bug.id))
        events.push({ type: 'bugDefeated', id: `bugDefeated:${bug.id}:${at}`, at, bug });
    }
    if (prev.loaded.activity && next.loaded.activity)
      for (const agent of next.agents) {
        const old = prev.agents.find(p => p.seatId === agent.seatId);
        if (old && old.pose !== agent.pose)
          events.push({ type: 'poseChanged', id: `pose:${agent.seatId}:${at}:${agent.pose}`, at, seatId: agent.seatId, from: old.pose, to: agent.pose });
      }
  }
  for (const release of Object.values(next.releaseVersions)) {
    const known = state.versions[release.projectId] ?? 0;
    const id = `release:${release.releaseId}`;
    if (!baseline && state.releases.has(release.projectId) && next.loaded.releases.includes(release.projectId) && release.version > known && !state.ids.has(id) && fresh(release.at))
      events.push({ type: 'release', id, at: release.at, release });
    state.versions[release.projectId] = Math.max(known, release.version);
    state.ids.add(id);
  }
  for (const project of next.loaded.interactions)
    state.interactions.add(project);
  for (const project of next.loaded.reports)
    state.reports.add(project);
  for (const project of next.loaded.releases)
    state.releases.add(project);
  // Current interaction windows are bounded by the endpoint. Every newly fetched
  // window still gets its own first-read baseline before events can be emitted.
  const current = new Set(next.handoffs.map(h => `handoff:${h.id}`));
  state.ids = new Set([...state.ids].filter(id => !id.startsWith('handoff:') || current.has(id)));
  return { events, seen: state };
}
