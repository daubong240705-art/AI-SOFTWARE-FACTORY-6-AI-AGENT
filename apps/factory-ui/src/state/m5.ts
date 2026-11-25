import type { ApiClient, AutomationRule, Monitor, RouteBreaker, TeamBreaker } from '../api/client';

export type M5State = {
  rules: AutomationRule[]; monitors: Monitor[];
  breakers: { routes: RouteBreaker[]; teams: TeamBreaker[] };
  fires: Record<string, Awaited<ReturnType<ApiClient['listRuleFires']>>['items']>;
  monitorEvents: Record<string, Awaited<ReturnType<ApiClient['listMonitorEvents']>>['items']>;
};
export const emptyM5 = (): M5State => ({ rules: [], monitors: [], breakers: { routes: [], teams: [] }, fires: {}, monitorEvents: {} });
