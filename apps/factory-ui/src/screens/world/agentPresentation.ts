import type { WorldAgent } from './data/types';
import { loungeSpots, type DeskAnchor, type Point } from './layout/zones';
import { roomDesk, roomDestination } from './layout/campus';

export function deskForAgent(agent: WorldAgent): DeskAnchor | null {
  if (agent.overflow) return null;
  return roomDesk(agent.room, agent);
}
export function restForAgent(index: number): { id: string; point: Point } | null {
  const slot = index;
  return loungeSpots[slot] ? { id: `rest-${slot}`, point: loungeSpots[slot] } : null;
}
export const agentStatusKey = (agent: WorldAgent) => `worldUi.status.${agent.status}`;

/** Only paused teams use the lounge. Stable seat ordering gives every visitor a unique spot. */
export function anchorsForAgents(agents: readonly WorldAgent[]) {
  const result = new Map<string, { id: string; point: Point; height: number }>();
  let loungeIndex = 0;
  for (const agent of [...agents].sort((a, b) => a.seatId.localeCompare(b.seatId))) {
    const desk = deskForAgent(agent); if (!desk) continue;
    const rest = agent.status === 'idle' ? roomDestination(agent.room, agent, 'rest') : null;
    result.set(agent.seatId, { id: rest ? `rest-${loungeIndex++}` : desk.id, point: rest ? [rest[0], rest[2]] : desk.seat, height: rest ? 0.04 : 0.48 });
  }
  return result;
}
