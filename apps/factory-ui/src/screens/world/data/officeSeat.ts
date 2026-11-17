import type { OfficeSeat } from '@/api/officeModels';
import type { WorldAgent } from './types';
export function officeSeat(agent: WorldAgent, team: {
  name: string;
}): OfficeSeat {
  return { id: agent.seatId, name: agent.name, role: agent.role, isLead: agent.isLead, slots: agent.slots, status: agent.status, runs: agent.runs, queued: agent.queued, needsYou: agent.needsYou, lastFinished: agent.lastFinished, teamId: agent.teamId, teamName: team.name, chat: null };
}
