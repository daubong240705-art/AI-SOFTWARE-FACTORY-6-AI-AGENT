import type { WorldInputs } from '../../data/types';
/** Loaded interactions only; project-qualified IDs avoid cross-game collisions. */
export function employeeOfDay(interactions: WorldInputs['interactions'], now = new Date()) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const counts: Record<string, number> = {}, seen = new Set<string>();
  for (const [project, office] of Object.entries(interactions)) for (const item of office?.items ?? []) {
    const at = Date.parse(item.at), id = `${project}:${item.id}`;
    if (item.kind !== 'finished' || item.from.kind !== 'seat' || at < +start || at > +now || !Number.isFinite(at) || seen.has(id)) continue;
    seen.add(id); counts[item.from.seatId] = (counts[item.from.seatId] ?? 0) + 1;
  }
  const worker = Object.keys(counts).sort((a, b) => counts[b]! - counts[a]! || a.localeCompare(b))[0] ?? null;
  return { worker, counts };
}
