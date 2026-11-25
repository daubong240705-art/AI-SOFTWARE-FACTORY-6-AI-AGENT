import type { PodKey, Assignments } from './types';
export function assignDesks(items: {
  seatId: string;
  podKey: PodKey;
}[], previous: Assignments = {}): Assignments {
  const out: Assignments = {};
  const used = new Set<number>();
  for (const item of items) {
    const p = previous[item.seatId];
    if (p && !p.overflow && p.slotIndex >= 0 && p.slotIndex < items.length && !used.has(p.slotIndex)) {
      out[item.seatId] = { ...p, podKey: item.podKey };
      used.add(p.slotIndex);
    }
  }
  let next = 0;
  const ordered = [...items.filter(item => item.podKey === 'lead'), ...items.filter(item => item.podKey !== 'lead')];
  for (const item of ordered) if (!out[item.seatId]) {
    while (used.has(next)) next++;
    out[item.seatId] = { podKey: item.podKey, slotIndex: next++, overflow: false };
  }
  return out;
}
