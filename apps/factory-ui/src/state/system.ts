import type { ApiClient } from '../api/client';

export type SystemState = {
  agentClis: Awaited<ReturnType<ApiClient['getAgentClis']>> | null;
  models: Awaited<ReturnType<ApiClient['getModelSettings']>> | null;
  health: Awaited<ReturnType<ApiClient['systemHealth']>> | null;
  capabilities: Awaited<ReturnType<ApiClient['systemCapabilities']>> | null;
  backups: Awaited<ReturnType<ApiClient['systemBackups']>> | null;
  servers: Awaited<ReturnType<ApiClient['listMcpServers']>>['servers'] | null;
  packs: Awaited<ReturnType<ApiClient['listPacks']>>['packs'] | null;
};
export type SystemArea = keyof SystemState;
export const systemAreas: SystemArea[] = ['models', 'agentClis', 'health', 'capabilities', 'backups', 'servers', 'packs'];
export const emptySystem = (): SystemState => ({ models: null, agentClis: null, health: null, capabilities: null, backups: null, servers: null, packs: null });
