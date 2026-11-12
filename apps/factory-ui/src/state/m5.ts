import type { ApiClient, AutomationRule, Monitor, RouteBreaker, Schedule, TeamBreaker, WorkflowDetail, WorkflowInstance, WorkflowDefinition } from '../api/client';
import type { WorkflowPatch } from '../api/m5Models';
import type { PatchDraft } from './workflowPatches';

export type M5State = {
  patchDrafts: Record<string, PatchDraft>; patchOutcomes: Record<string, WorkflowPatch | undefined>;
  workflows: WorkflowInstance[]; workflowDetails: Record<string, WorkflowDetail>;
  workflowDefinitions: WorkflowDefinition[];
  schedules: Schedule[]; rules: AutomationRule[]; monitors: Monitor[];
  breakers: { routes: RouteBreaker[]; teams: TeamBreaker[] };
  occurrences: Record<string, Awaited<ReturnType<ApiClient['listScheduleOccurrences']>>['items']>;
  fires: Record<string, Awaited<ReturnType<ApiClient['listRuleFires']>>['items']>;
  monitorEvents: Record<string, Awaited<ReturnType<ApiClient['listMonitorEvents']>>['items']>;
};
export const emptyM5 = (): M5State => ({ patchDrafts: {}, patchOutcomes: {}, workflows: [], workflowDetails: {}, workflowDefinitions: [], schedules: [], rules: [], monitors: [], breakers: { routes: [], teams: [] }, occurrences: {}, fires: {}, monitorEvents: {} });
