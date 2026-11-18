import type { Point } from '../layout/zones';
export type Activity = 'coffee' | 'ping-pong' | 'pet-cat' | 'water-plant' | 'sofa' | 'dance';
export type LeisureSpot = { id: string; point: Point };
export type WanderAgent = { seatId: string; idle: boolean; desk: Point; home: string };
type Visit = { random: () => number; due: number; spot: LeisureSpot | null; phase: 'home' | 'outbound' | 'visiting' | 'returning'; until: number; interrupted: boolean; idleSince: number; danced: boolean; dance: boolean };
export type WanderAction = { seatId: string; kind: 'depart' | 'return' | 'reset'; spot: LeisureSpot | null; urgent: boolean };
function seededRandom(id: string) {
  let seed = 2166136261;
  for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
/** The director owns reservations and elapsed-time activities, independently of polling/render cadence. */
export class WanderingDirector {
  private visits = new Map<string, Visit>();
  private reservations = new Map<string, string>();
  wandering(id: string) { return this.visits.get(id)?.spot != null; }
  activity(id: string): Activity | null {
    const visit = this.visits.get(id);
    if (!visit || visit.phase === 'returning') return null;
    if (visit.dance) return 'dance';
    const spot = visit.spot?.id;
    if (spot === 'coffee') return 'coffee';
    if (spot?.startsWith('ping-')) return 'ping-pong';
    if (spot === 'rest-1') return 'sofa';
    if (spot === 'plant-water') return 'water-plant';
    return spot === 'cat' ? 'pet-cat' : null;
  }
  reservedSpots() { return new Map(this.reservations); }
  arrive(id: string, now: number) {
    const visit = this.visits.get(id); if (!visit) return;
    if (visit.phase === 'outbound') {
      visit.phase = 'visiting'; visit.until = now + 12000 + visit.random() * 10000;
      if (visit.spot?.id.startsWith('ping-')) {
        const partner = this.visits.get(this.reservations.get(visit.spot.id === 'ping-left' ? 'ping-right' : 'ping-left') ?? '');
        // The rally begins only after both arrive, and ends for both at the same instant.
        if (partner?.phase === 'visiting') partner.until = visit.until;
        else visit.until = Infinity;
      }
    } else if (visit.phase === 'returning') this.home(id, visit, now);
  }
  private home(id: string, visit: Visit, now: number) {
    if (visit.spot && this.reservations.get(visit.spot.id) === id) this.reservations.delete(visit.spot.id);
    visit.spot = null; visit.phase = 'home'; visit.interrupted = false; visit.dance = false; visit.due = now + 20000 + visit.random() * 40000;
  }
  update(agents: readonly WanderAgent[], spots: readonly LeisureSpot[], now: number, enabled: boolean, limit: number, busy: ReadonlySet<string> = new Set()): WanderAction[] {
    const actions: WanderAction[] = [];
    const live = new Set(agents.map(agent => agent.seatId));
    for (const [id, visit] of this.visits) if (!live.has(id)) { this.home(id, visit, now); this.visits.delete(id); }
    for (const agent of [...agents].sort((a, b) => a.seatId.localeCompare(b.seatId))) {
      let visit = this.visits.get(agent.seatId);
      if (!visit) {
        const random = seededRandom(agent.seatId);
        visit = { random, due: now + 20000 + random() * 40000, spot: null, phase: 'home', until: 0, interrupted: false, idleSince: now, danced: false, dance: false };
        this.visits.set(agent.seatId, visit);
      }
      if (!agent.idle) { visit.idleSince = now; visit.danced = false; }
      if (!enabled) {
        if (visit.spot) actions.push({ seatId: agent.seatId, kind: 'reset', spot: visit.spot, urgent: true });
        this.home(agent.seatId, visit, now); continue;
      }
      const paired = visit.spot?.id.startsWith('ping-');
      const partnerId = paired ? this.reservations.get(visit.spot?.id === 'ping-left' ? 'ping-right' : 'ping-left') : undefined;
      const partner = agents.find(a => a.seatId === partnerId);
      const invalidPair = paired && (!partner?.idle || this.visits.get(partner.seatId)?.phase === 'returning');
      const excess = visit.spot && [...this.reservations.values()].indexOf(agent.seatId) >= Math.max(0, limit);
      if (!agent.idle || invalidPair || excess) {
        if (visit.spot && !visit.interrupted) { visit.phase = 'returning'; visit.interrupted = true; actions.push({ seatId: agent.seatId, kind: 'return', spot: visit.spot, urgent: true }); }
        if (visit.dance) this.home(agent.seatId, visit, now);
        if (!visit.spot) visit.due = now + 20000 + visit.random() * 40000;
        continue;
      }
      if (visit.phase === 'visiting' && now >= visit.until) {
        if (visit.dance) this.home(agent.seatId, visit, now);
        else { visit.phase = 'returning'; actions.push({ seatId: agent.seatId, kind: 'return', spot: visit.spot, urgent: false }); }
      }
      if (visit.phase !== 'home' || busy.has(agent.seatId)) continue;
      if (!visit.danced && now - visit.idleSince >= 90000) { visit.phase = 'visiting'; visit.dance = true; visit.danced = true; visit.until = now + 4000; continue; }
      if (now < visit.due || this.reservations.size >= limit) continue;
      // Reserve both sides together, only when two actual idle workers are free.
      const left = spots.find(s => s.id === 'ping-left'), right = spots.find(s => s.id === 'ping-right');
      const other = agents.find(a => a.seatId !== agent.seatId && a.idle && !busy.has(a.seatId) && this.visits.get(a.seatId)?.phase === 'home');
      const otherVisit = other ? this.visits.get(other.seatId) : null;
      if (left && right && other && otherVisit && this.reservations.size + 2 <= limit && !this.reservations.has(left.id) && !this.reservations.has(right.id) && visit.random() < 0.45) {
        for (const [id, entry, spot] of [[agent.seatId, visit, left], [other.seatId, otherVisit, right]] as const) { entry.spot = spot; entry.phase = 'outbound'; this.reservations.set(spot.id, id); actions.push({ seatId: id, kind: 'depart', spot, urgent: false }); }
        continue;
      }
      const available = spots.filter(spot => !spot.id.startsWith('ping-') && !this.reservations.has(spot.id));
      if (!available.length) continue;
      visit.spot = available[Math.floor(visit.random() * available.length)]!; visit.phase = 'outbound'; this.reservations.set(visit.spot.id, agent.seatId);
      actions.push({ seatId: agent.seatId, kind: 'depart', spot: visit.spot, urgent: false });
    }
    return actions;
  }
}
