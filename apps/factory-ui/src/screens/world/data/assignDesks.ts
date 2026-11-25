import type { PodKey, Assignments } from './types';
export function assignDesks(items: {
  seatId: string;
  podKey: PodKey;
}[], previous: Assignments = {}): Assignments {
  const out: Assignments = {};
  const used = new Set<number>();
  const lead = items.find(item => item.podKey === 'lead');
  if (lead) { out[lead.seatId] = { podKey: 'lead', slotIndex: 0, overflow: false }; used.add(0); }
  for (const item of items) {
    const p = previous[item.seatId];
    if (!out[item.seatId] && p && !p.overflow && p.slotIndex > 0 && p.slotIndex <= items.length && !used.has(p.slotIndex)) {
      out[item.seatId] = { ...p, podKey: item.podKey };
      used.add(p.slotIndex);
    }
  }
  let next = 1;
  for (const item of items) if (!out[item.seatId]) {
    while (used.has(next)) next++;
    out[item.seatId] = { podKey: item.podKey, slotIndex: next++, overflow: false };
  }
  return out;
}
