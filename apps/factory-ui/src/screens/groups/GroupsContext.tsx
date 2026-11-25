import { createContext, useContext, useReducer, useState, type ReactNode } from 'react';
import { createApiClient } from '@/api/client';
import { useT } from '@/i18n';
import { useRead, type Submit } from '../agents/shared';

function useGroupsState() {
  const [api] = useState(() => createApiClient({ baseUrl: import.meta.env.DEV ? '/api' : '' }));
  const [refreshKey, refresh] = useReducer((value: number) => value + 1, 0);
  const list = useRead(api.listGroups, refreshKey);
  const submit: Submit = async build => {
    const command = build();
    try { await api.sendAgentCommand(command); }
    finally { refresh(); }
  };
  return { api, list, refresh, refreshKey, submit };
}

const GroupsContext = createContext<ReturnType<typeof useGroupsState> | null>(null);

export function GroupsProvider({ children }: { children: ReactNode }) {
  return <GroupsContext.Provider value={useGroupsState()}>{children}</GroupsContext.Provider>;
}

export function useGroups() {
  const state = useContext(GroupsContext);
  if (!state) throw new Error('GroupsProvider is required');
  return state;
}

export function useGroupLabels() {
  const t = useT();
  return (key: string, values: Record<string, string | number> = {}) =>
    t(`groupsUi.${key}`).replace(/\{(\w+)\}/g, (token, name: string) => String(values[name] ?? token));
}
