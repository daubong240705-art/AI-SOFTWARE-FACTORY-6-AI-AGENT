import { Badge } from '@/components/ui/badge';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { SystemCard, SystemRead, SystemStatus } from './SystemCard';
import { MascotEmpty } from '@/components/mascot';

export function McpCard({ store }: { store: Store }) {
  const t = useT(); const servers = store.useStoreSelector(state => state.system.servers);
  return <SystemCard title={t('systemUi.servers')}><SystemRead store={store} area="servers">
    {servers?.length ? <ul className="m-0 list-none divide-y divide-border p-0">
      {servers.map(server => {
        const status = ['ready', 'unreachable', 'disabled', 'circuit-open'].includes(server.state) ? server.state : 'unknown';
        return <li key={server.name} className="space-y-2 py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium break-all">{server.name}</span>
            <SystemStatus tone={status === 'ready' ? 'ok' : status === 'circuit-open' ? 'run' : status === 'unreachable' ? 'info' : 'muted'} label={t(`agentProfile.serverStates.${status}`)} />
          </div>
          <p className="text-xs text-muted-foreground">{t('systemUi.tools').replace('{count}', String(server.tools))}</p>
        </li>;
      })}
    </ul> : <MascotEmpty seat="DevOps" compact><p className="text-sm text-muted-foreground">{t('systemUi.noServers')}</p></MascotEmpty>}
  </SystemRead></SystemCard>;
}

export function PacksCard({ store }: { store: Store }) {
  const t = useT(); const packs = store.useStoreSelector(state => state.system.packs);
  return <SystemCard title={t('systemUi.packs')}><SystemRead store={store} area="packs">
    {packs?.length ? <ul className="m-0 list-none divide-y divide-border p-0">
      {packs.map(pack => <li key={pack.key} className="space-y-2 py-4 first:pt-0 last:pb-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-sm font-medium">{pack.name}</span><span className="font-mono text-xs text-muted-foreground">{pack.version}</span></div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{t('systemUi.seats').replace('{count}', String(pack.seatCount))}</span>
          <span>{t('systemUi.workflows').replace('{count}', String(pack.workflows.length))}</span>
        </div>
        {!!pack.produces.length && <div className="flex flex-wrap gap-1.5">{pack.produces.map(value => <Badge key={value} variant="outline" className="max-w-full whitespace-normal">{value}</Badge>)}</div>}
      </li>)}
    </ul> : <MascotEmpty seat="DevOps" compact><p className="text-sm text-muted-foreground">{t('systemUi.noPacks')}</p></MascotEmpty>}
  </SystemRead></SystemCard>;
}
