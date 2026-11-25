import type { WorldAgent } from './data/types';
import type { DeskAnchor } from './layout/zones';
import { roomDesk } from './layout/campus';

export function deskForAgent(agent: WorldAgent): DeskAnchor | null {
  if (agent.overflow) return null;
  return roomDesk(agent);
}
export const agentStatusKey = (agent: WorldAgent) => `worldUi.status.${agent.status}`;
