import { Badge } from '@/components/ui/badge';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { Fact, SystemCard, SystemRead, SystemStatus, SystemTime } from './SystemCard';

export function HostCard({ store, now }: { store: Store; now: number }) {
  const t = useT(); const state = store.useStoreSelector(value => value);
  const { health, capabilities } = state.system; const host = capabilities?.host;
  const running = Boolean(health?.ok && !state.errors['system:health']);
  const started = host?.startedAt ? Date.parse(host.startedAt) : NaN;
  const seconds = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : null;
  const uptime = seconds === null ? t('systemUi.unknown') : [
    ['days', Math.floor(seconds / 86400)], ['hours', Math.floor(seconds % 86400 / 3600)],
    ['minutes', Math.floor(seconds % 3600 / 60)], ['seconds', seconds % 60],
  ].filter(([, count]) => Number(count) > 0).map(([unit, count]) => t(`systemUi.${unit}`).replace('{count}', String(count))).join(' ') || t('systemUi.seconds').replace('{count}', '0');
  return <SystemCard title={t('systemUi.host')}>
    <SystemRead store={store} area="health" showOnError>
      <SystemStatus tone={running ? 'ok' : 'info'} label={t(running ? 'systemUi.running' : 'systemUi.disconnected')} />
      <dl><Fact label={t('systemUi.apiVersion')} mono>{health?.apiVersion || capabilities?.apiVersion || t('systemUi.unknown')}</Fact></dl>
    </SystemRead>
    <SystemRead store={store} area="capabilities">
      <dl className="space-y-3">
        <Fact label={t('systemUi.startedAt')}><SystemTime value={host?.startedAt} now={now} /></Fact>
        <Fact label={t('systemUi.uptime')}>{uptime}</Fact>
        <Fact label={t('systemUi.nodeVersion')} mono>{host?.nodeVersion || t('systemUi.unknown')}</Fact>
        <Fact label={t('systemUi.platform')} mono>{host?.platform || t('systemUi.unknown')}</Fact>
      </dl>
      <div className="divide-y divide-border border-t border-border">
        {(['multiTeam', 'dispatch', 'documentExtraction'] as const).map(key => {
          const value = capabilities?.features?.[key];
          return <div key={key} className="space-y-2 py-3 last:pb-0">
            <div className="flex items-center justify-between gap-3 text-sm"><span>{t(`systemUi.${key}`)}</span>
              <Badge variant="outline" className={value ? 'text-ok' : 'text-muted-foreground'}>{t(value === undefined ? 'systemUi.unknown' : value ? 'systemUi.enabled' : 'systemUi.disabled')}</Badge>
            </div>
            {key === 'documentExtraction' && value === false && <p className="text-xs leading-relaxed break-words text-muted-foreground">{t('systemUi.extractionSetup')}</p>}
          </div>;
        })}
      </div>
    </SystemRead>
  </SystemCard>;
}
