import type { WorldAgent } from './data/types';
import { anchors, annexDesks, leadDesks, loungeSpots, productionDesks, qaDesks, type DeskAnchor, type Point } from './layout/zones';

const portalDesk: DeskAnchor = { id: 'counter', position: anchors.counter, seat: [16.5, 11.56], stand: [16.5, 10.6], monitor: [16.66, 12.74], sideMonitor: [15.88, 12.52], yaw: 0 };
export function deskForAgent(agent: WorldAgent): DeskAnchor | null {
  if (agent.overflow) return null;
  const candidates = agent.podKey === 'lead' ? leadDesks : agent.podKey === 'qa' ? qaDesks
    : agent.podKey === 'annex' ? annexDesks : agent.podKey === 'portal' ? [portalDesk]
      : productionDesks.filter(desk => desk.id.startsWith(`${agent.podKey}-`));
  return candidates[agent.slotIndex] ?? null;
}
export function restForAgent(index: number): { id: string; point: Point } | null {
  const slot = index;
  return loungeSpots[slot] ? { id: `rest-${slot}`, point: loungeSpots[slot] } : null;
}
export const agentStatusKey = (agent: WorldAgent) => `worldUi.status.${agent.pose === 'resting' ? 'resting' : agent.status}`;

/** Only paused teams use the lounge. Stable seat ordering gives every visitor a unique spot. */
export function anchorsForAgents(agents: readonly WorldAgent[]) {
  const result = new Map<string, { id: string; point: Point; height: number }>();
  let loungeIndex = 0;
  for (const agent of [...agents].sort((a, b) => a.seatId.localeCompare(b.seatId))) {
    const desk = deskForAgent(agent); if (!desk) continue;
    const rest = agent.paused ? restForAgent(loungeIndex++) : null;
    result.set(agent.seatId, { id: rest?.id ?? desk.id, point: rest?.point ?? desk.seat, height: rest ? 0.04 : 0.57 });
  }
  return result;
}
