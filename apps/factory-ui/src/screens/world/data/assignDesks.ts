import type { PodKey, Assignments } from './types';
const caps: Record<PodKey, number> = { lead: 3, design: 2, rules: 2, art: 2, client: 2, qa: 3, portal: 1, annex: 8 };
export function assignDesks(items: {
  seatId: string;
  podKey: PodKey;
}[], previous: Assignments = {}): Assignments {
  const out: Assignments = {};
  const used: Record<PodKey, Set<number>> = Object.fromEntries(Object.keys(caps).map(k => [k, new Set<number>()])) as Record<PodKey, Set<number>>;
  for (const item of items) {
    const p = previous[item.seatId];
    if (p && !p.overflow && (p.podKey === item.podKey || p.podKey === 'annex') && p.slotIndex >= 0 && p.slotIndex < caps[p.podKey] && !used[p.podKey].has(p.slotIndex)) {
      out[item.seatId] = p;
      used[p.podKey].add(p.slotIndex);
    }
  }
  for (const item of items)
    if (!out[item.seatId]) {
      let pod = item.podKey;
      let slot = [...Array(caps[pod]).keys()].find(i => !used[pod].has(i));
      let overflow = false;
      if (slot === undefined && pod !== 'annex') {
        pod = 'annex';
        slot = [...Array(caps.annex).keys()].find(i => !used.annex.has(i));
      }
      if (slot === undefined) {
        pod = 'annex';
        slot = 0;
        overflow = true;
      }
      else
        used[pod].add(slot);
      out[item.seatId] = { podKey: pod, slotIndex: slot, overflow };
    }
  return out;
}
