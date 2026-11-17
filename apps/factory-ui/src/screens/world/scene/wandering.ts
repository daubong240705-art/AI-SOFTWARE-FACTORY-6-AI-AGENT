import type { Point } from '../layout/zones';

export type LeisureSpot = { id: string; point: Point };
export type WanderAgent = { seatId: string; idle: boolean; desk: Point; home: string };
type Visit = { random: () => number; due: number; spot: LeisureSpot | null; phase: 'home' | 'outbound' | 'visiting' | 'returning'; until: number; interrupted: boolean };
export type WanderAction = { seatId: string; kind: 'depart' | 'return' | 'reset'; spot: LeisureSpot | null; urgent: boolean };
function seededRandom(id: string) {
  let seed = 2166136261;
  for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
/** Wall-clock scheduling is independent of render frames and polling object identities. */
export class WanderingDirector {
  private visits = new Map<string, Visit>();
  private reservations = new Map<string, string>();
  wandering(id: string) { return this.visits.get(id)?.spot != null; }
  reservedSpots() { return new Map(this.reservations); }
  arrive(id: string, now: number) {
    const visit = this.visits.get(id); if (!visit) return;
    if (visit.phase === 'outbound') { visit.phase = 'visiting'; visit.until = now + 10000 + visit.random() * 15000; }
    else if (visit.phase === 'returning') this.home(id, visit, now);
  }
  private home(id: string, visit: Visit, now: number) {
    if (visit.spot && this.reservations.get(visit.spot.id) === id) this.reservations.delete(visit.spot.id);
    visit.spot = null; visit.phase = 'home'; visit.interrupted = false; visit.due = now + 20000 + visit.random() * 40000;
  }
  update(agents: readonly WanderAgent[], spots: readonly LeisureSpot[], now: number, enabled: boolean, limit: number, busy: ReadonlySet<string> = new Set()): WanderAction[] {
    const actions: WanderAction[] = [];
    const live = new Set(agents.map(agent => agent.seatId));
    for (const [id, visit] of this.visits) if (!live.has(id)) { this.home(id, visit, now); this.visits.delete(id); }
    // A quality reduction takes effect immediately, including visitors already away.
    const excess = enabled ? [...this.reservations.values()].slice(Math.max(0, limit)) : [];
    for (const id of excess) {
      const visit = this.visits.get(id)!;
      actions.push({ seatId: id, kind: 'reset', spot: visit.spot, urgent: true }); this.home(id, visit, now);
    }
    for (const agent of [...agents].sort((a, b) => a.seatId.localeCompare(b.seatId))) {
      let visit = this.visits.get(agent.seatId);
      if (!visit) {
        const random = seededRandom(agent.seatId);
        visit = { random, due: now + 20000 + random() * 40000, spot: null, phase: 'home', until: 0, interrupted: false };
        this.visits.set(agent.seatId, visit);
      }
      if (!enabled) {
        if (visit.spot) actions.push({ seatId: agent.seatId, kind: 'reset', spot: visit.spot, urgent: true });
        this.home(agent.seatId, visit, now); continue;
      }
      if (!agent.idle) {
        if (visit.spot && !visit.interrupted) {
          visit.phase = 'returning'; visit.interrupted = true; actions.push({ seatId: agent.seatId, kind: 'return', spot: visit.spot, urgent: true });
        }
        if (!visit.spot) visit.due = now + 20000 + visit.random() * 40000;
        continue;
      }
      if (visit.phase === 'visiting' && now >= visit.until) {
        visit.phase = 'returning'; actions.push({ seatId: agent.seatId, kind: 'return', spot: visit.spot, urgent: false });
      }
      if (visit.phase !== 'home' || now < visit.due || this.reservations.size >= limit || busy.has(agent.seatId)) continue;
      const nearby = spots.filter(spot => spot.id !== agent.home && !this.reservations.has(spot.id) && Math.hypot(spot.point[0] - agent.desk[0], spot.point[1] - agent.desk[1]) > 0.5)
        .sort((a, b) => Math.hypot(a.point[0] - agent.desk[0], a.point[1] - agent.desk[1]) - Math.hypot(b.point[0] - agent.desk[0], b.point[1] - agent.desk[1])).slice(0, 5);
      if (!nearby.length) continue;
      visit.spot = nearby[Math.floor(visit.random() * nearby.length)]!; visit.phase = 'outbound';
      this.reservations.set(visit.spot.id, agent.seatId);
      actions.push({ seatId: agent.seatId, kind: 'depart', spot: visit.spot, urgent: false });
    }
    return actions;
  }
}
