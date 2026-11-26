import type { ApiClient } from '../api/client';

export async function resolveLeadId(api: Pick<ApiClient, 'listProjectAgents' | 'getAgent'>, projectId: string, seatId?: string) {
  if (seatId) return seatId;
  const { agents, teams } = await api.listProjectAgents(projectId);
  const active = agents.filter(agent => agent.status === 'active');
  const lead = active.find(agent => agent.isLead) ?? active.find(agent => teams.some(team => team.leadAgentId === agent.id));
  if (lead) return lead.id;
  const details = await Promise.all(active.map(agent => api.getAgent(projectId, agent.id)));
  const delegates = details.filter(agent => agent.config.delegation.canAssign === 'project');
  return delegates.length === 1 ? delegates[0]?.id : undefined;
}
