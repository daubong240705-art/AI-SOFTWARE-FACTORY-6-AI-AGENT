import type { Handoff, WorldAgent, WorldModel } from './types';
export type WorldEvent = {
  type: 'handoff';
  id: string;
  at: string;
  handoff: Handoff;
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
  ids: Set<string>;
};
export function createWorldSeen(now: number): WorldSeen {
  return { startedAt: now, baseline: false, reset: false, interactions: new Set(), ids: new Set() };
}
/** Pure diff: callers can keep the old model and seen snapshot unchanged. */
export function diffWorld(prev: WorldModel | null, next: WorldModel, seen: WorldSeen, serverNow: string | number): {
  events: WorldEvent[];
  seen: WorldSeen;
} {
  const now = typeof serverNow === 'string' ? Date.parse(serverNow) : serverNow;
  const fresh = (at: string) => Number.isFinite(now) && now >= Date.parse(at) && now - Date.parse(at) <= 90000;
  const at = next.generatedAt;
  const state: WorldSeen = { ...seen, interactions: new Set(seen.interactions), ids: new Set(seen.ids) };
  const ready = next.loaded.activity && next.loaded.projects;
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
    if (prev.loaded.activity && next.loaded.activity)
      for (const agent of next.agents) {
        const old = prev.agents.find(p => p.seatId === agent.seatId);
        if (old && old.pose !== agent.pose)
          events.push({ type: 'poseChanged', id: `pose:${agent.seatId}:${at}:${agent.pose}`, at, seatId: agent.seatId, from: old.pose, to: agent.pose });
      }
  }
  for (const project of next.loaded.interactions) state.interactions.add(project);
  // Current interaction windows are bounded by the endpoint. Every newly fetched
  // window still gets its own first-read baseline before events can be emitted.
  const current = new Set(next.handoffs.map(h => `handoff:${h.id}`));
  state.ids = new Set([...state.ids].filter(id => !id.startsWith('handoff:') || current.has(id)));
  return { events, seen: state };
}
