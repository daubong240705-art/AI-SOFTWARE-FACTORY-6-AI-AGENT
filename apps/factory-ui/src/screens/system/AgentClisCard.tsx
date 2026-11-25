import { useT } from '@/i18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Store } from '@/state/store';
import { SystemCard, SystemRead } from './SystemCard';
import type { AgentCli } from '@/api/agentRuntime';
import { cn } from '@/lib/utils';

function CliStatus({ status }: { status: AgentCli | undefined }) {
  const t = useT();
  const key = !status ? 'unknown' : !status.installed ? 'notInstalled' : status.login === 'ok' ? 'loggedIn' : status.login === 'missing' ? 'notLoggedIn' : 'unknown';
  return <span className="inline-flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
    <span aria-hidden="true" className={cn('size-1.5 rounded-full', key === 'loggedIn' ? 'bg-ok' : key === 'notLoggedIn' ? 'bg-info' : 'bg-muted-foreground')} />
    {t(`agentClis.${key}`)}{status?.version && <span className="font-mono">{status.version}</span>}
  </span>;
}

export function AgentClisCard({ store }: { store: Store }) {
  const t = useT(); const state = store.useStoreSelector(value => value); const data = state.system.agentClis;
  return <SystemCard title={t('agentClis.title')}>
    <SystemRead store={store} area="agentClis">
      {data && <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-muted-foreground">Local CLI</span><Badge variant="outline" className={data.enabled ? 'text-ok' : 'text-muted-foreground'}>{data.enabled ? t('agentClis.enabled') : t('agentClis.disabled')}</Badge>
          <Button type="button" variant="ghost" size="sm" disabled={Boolean(state.loading['system:agentClis'])} onClick={() => void store.loadAgentClis(true)}>{t('agentClis.refresh')}</Button></div>
        <dl className="divide-y divide-border border-y border-border">
          {(['codex', 'claude'] as const).map(cli => <div key={cli} className="flex flex-wrap items-center justify-between gap-3 py-3"><dt className="font-medium">{cli === 'codex' ? 'Codex CLI' : 'Claude Code CLI'}</dt><dd><CliStatus status={data.clis.find(item => item.cli === cli)} /></dd></div>)}
        </dl>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('agentClis.note')}</p>
      </div>}
    </SystemRead>
  </SystemCard>;
}
