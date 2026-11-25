import { createContext, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import type { AgentSummary } from '@factory/contracts';
import type { ApiClient } from '@/api/client';
import { Mascot } from './Mascot';
import { mascotSeat, speciesFromTags } from './agentSpecies';
import type { Species } from './species';

type AgentIdentity = Pick<AgentSummary, 'role'> & Partial<Pick<AgentSummary, 'id' | 'isLead' | 'configRevision'>>;
const Overrides = createContext<ReadonlyMap<string, Species | undefined> | null>(null);
const revisionKey = ({ id, configRevision }: AgentIdentity) => `${id}:${configRevision}`;

export function AgentMascotProvider({ api, agents, children }: { api: ApiClient; agents?: readonly AgentSummary[] | undefined; children: ReactNode }) {
  const cache = useRef(new Map<string, Species | undefined>());
  const [overrides, setOverrides] = useState<ReadonlyMap<string, Species | undefined>>(cache.current);
  const scope = agents?.map(agent => `${agent.projectId}:${revisionKey(agent)}`).join('|');
  const latest = useRef(agents); latest.current = agents;
  useEffect(() => {
    const pending = latest.current?.filter(agent => !cache.current.has(revisionKey(agent))) ?? [];
    if (!pending.length) return;
    const abort = new AbortController();
    let next = 0;
    const load = async () => {
      while (!abort.signal.aborted && next < pending.length) {
        const agent = pending[next++]!;
        try {
          const detail = await api.getAgent(agent.projectId, agent.id, abort.signal);
          if (abort.signal.aborted || detail.configRevision !== agent.configRevision) continue;
          cache.current.set(revisionKey(agent), speciesFromTags(detail.config.tags));
          setOverrides(new Map(cache.current));
        } catch { if (abort.signal.aborted) return; }
      }
    };
    for (let worker = 0; worker < Math.min(4, pending.length); worker++) void load();
    return () => abort.abort();
  }, [api, scope]);
  return <Overrides.Provider value={overrides}>{children}</Overrides.Provider>;
}

export function AgentMascot({ agent, tags, size = 28, animated = false, ...props }: {
  agent: AgentIdentity; tags?: readonly string[]; size?: number; animated?: boolean;
} & Pick<ComponentProps<typeof Mascot>, 'state' | 'skin' | 'speciesOverride'>) {
  const overrides = useContext(Overrides);
  const speciesOverride = props.speciesOverride ?? (tags ? speciesFromTags(tags) : overrides?.get(revisionKey(agent)));
  return <Mascot {...props} seat={mascotSeat(agent.role, agent.isLead)} isLead={!!agent.isLead} speciesOverride={speciesOverride} size={size} animated={animated} />;
}

export function AgentChoiceLabel({ agent }: { agent: AgentIdentity & { name: string } }) {
  return <span className="inline-flex min-w-0 items-center gap-2"><AgentMascot agent={agent} size={22} /><span className="truncate">{agent.name}</span></span>;
}
