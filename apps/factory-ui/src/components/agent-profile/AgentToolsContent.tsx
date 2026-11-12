import { useEffect } from 'react';
import { Info } from 'lucide-react';
import { MCP_TOOL_NAMES } from '@factory/contracts';
import type { PackSeat } from '@/api/agentProfileModels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { cn } from '@/lib/utils';

const serverStates = ['ready', 'unreachable', 'disabled', 'circuit-open'] as const;

export function AgentToolsContent({ store, seat }: { store: Store; seat: PackSeat }) {
  const t = useT();
  const { mcpServers, errors, loading } = store.useStoreSelector(value => value);
  useEffect(() => { void store.loadMcpServers(); }, [store]);
  return <div className="space-y-6">
    <section className="space-y-3" aria-label={t('agentProfile.capabilities')}>
      <h3 className="font-display text-base font-semibold">{t('agentProfile.capabilities')}</h3>
      <div className="flex flex-wrap gap-2">
        {seat.capabilities.map(value => <Badge key={value} variant="secondary" className="max-w-full whitespace-normal [overflow-wrap:anywhere]">{value}</Badge>)}
        {!seat.capabilities.length && <p className="text-sm text-muted-foreground">{t('agentProfile.emptyCapabilities')}</p>}
      </div>
    </section>
    <section className="space-y-3" aria-label={t('agentProfile.tools')}>
      <h3 className="font-display text-base font-semibold">{t('agentProfile.tools')}</h3>
      {!seat.tools.length && <p className="text-sm text-muted-foreground">{t('agentProfile.emptyTools')}</p>}
      {!!seat.tools.length && <ul className="m-0 list-none divide-y divide-border rounded-lg border border-border bg-card px-4">
        {seat.tools.map(name => {
          const builtin = MCP_TOOL_NAMES.some(tool => tool === name);
          return <li key={name} className="space-y-1 py-3">
            <p className="font-mono text-sm [overflow-wrap:anywhere]">{name}</p>
            <p className="flex items-center gap-1.5 text-xs leading-relaxed text-muted-foreground">{!builtin && <Info className="size-3.5 shrink-0" aria-hidden="true" />}{t(builtin ? `agentProfile.builtIn.${name}` : 'agentProfile.externalTool')}</p>
          </li>;
        })}
      </ul>}
    </section>
    <Separator />
    <section className="space-y-3" aria-label={t('agentProfile.servers')}>
      <h3 className="font-display text-base font-semibold">{t('agentProfile.servers')}</h3>
      {loading.mcpServers && <div role="status" aria-label={t('agentProfile.loadingServers')}><span className="sr-only">{t('agentProfile.loadingServers')}</span><Skeleton className="h-9 w-full" /></div>}
      {errors.mcpServers && <div className="space-y-2"><p role="status" className="text-sm text-muted-foreground">{t('agentProfile.serversUnavailable')}</p><Button variant="outline" size="sm" onClick={() => void store.loadMcpServers(true)}>{t('agentProfile.retry')}</Button></div>}
      {!loading.mcpServers && !errors.mcpServers && !mcpServers?.length && <p className="text-sm text-muted-foreground">{t('agentProfile.noServers')}</p>}
      {!!mcpServers?.length && <ul className="m-0 list-none divide-y divide-border p-0">{mcpServers.map((server, index) => {
        const status = serverStates.find(value => value === server.state) ?? 'unknown';
        return <li key={`${server.name}:${index}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <span className="min-w-0 font-mono text-sm [overflow-wrap:anywhere]">{server.name}</span>
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground"><span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', status === 'ready' ? 'bg-ok' : status === 'unreachable' || status === 'circuit-open' ? 'bg-run' : 'bg-muted-foreground')} />{t(`agentProfile.serverStates.${status}`)}</span>
        </li>;
      })}</ul>}
    </section>
  </div>;
}
