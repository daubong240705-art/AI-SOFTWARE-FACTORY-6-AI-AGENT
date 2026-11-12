import type { ApiClient, AutomationRule, Monitor, RouteBreaker, Schedule, TeamBreaker, WorkflowDetail, WorkflowInstance, WorkflowDefinition } from '../api/client';

export type M5State = {
  workflows: WorkflowInstance[]; workflowDetails: Record<string, WorkflowDetail>;
  workflowDefinitions: WorkflowDefinition[];
  schedules: Schedule[]; rules: AutomationRule[]; monitors: Monitor[];
  breakers: { routes: RouteBreaker[]; teams: TeamBreaker[] };
  occurrences: Record<string, Awaited<ReturnType<ApiClient['listScheduleOccurrences']>>['items']>;
  fires: Record<string, Awaited<ReturnType<ApiClient['listRuleFires']>>['items']>;
  monitorEvents: Record<string, Awaited<ReturnType<ApiClient['listMonitorEvents']>>['items']>;
};
export const emptyM5 = (): M5State => ({ workflows: [], workflowDetails: {}, workflowDefinitions: [], schedules: [], rules: [], monitors: [], breakers: { routes: [], teams: [] }, occurrences: {}, fires: {}, monitorEvents: {} });
