import { PageHeader } from '@/components/app';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Page } from '@/components/Page';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { systemAreas } from '@/state/system';
import { HostCard } from './HostCard';
import { BackupCard } from './BackupCard';
import { McpCard, PacksCard } from './CatalogCards';
import { CommandsCard } from './CommandsCard';
import { ModelsCard } from './ModelsCard';
import { AgentClisCard } from './AgentClisCard';
import { SetupPanel } from './SetupPanel';

export function System({ store }: { store: Store }) {
  const t = useT(); const state = store.useStoreSelector(value => value);
  const [now, setNow] = useState(Date.now);
  const busy = systemAreas.some(area => state.loading[`system:${area}`]);
  useEffect(() => {
    if (state.session !== 'authenticated') return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const refresh = () => { setNow(Date.now()); void store.loadSystem(); };
    const sync = () => {
      clearInterval(timer); timer = undefined;
      if (document.hidden) return;
      refresh(); timer = setInterval(refresh, 15_000);
    };
    sync(); document.addEventListener('visibilitychange', sync);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', sync); };
  }, [store, state.session]);
  useEffect(() => {
    if (state.session !== 'authenticated') return;
    void store.loadAgentClis();
    const timer = setInterval(() => { if (!document.hidden) void store.loadAgentClis(true); }, 30_000);
    return () => clearInterval(timer);
  }, [store, state.session]);
  return <Page className="min-w-0 space-y-6 px-6 2xl:px-6">
    <PageHeader title={t('systemUi.title')} actions={<Button type="button" variant="ghost" disabled={busy} onClick={() => { setNow(Date.now()); void store.loadSystem(); void store.loadAgentClis(true); }}><RefreshCw />{t('systemUi.refresh')}</Button>} />
    {state.session === 'authenticated' && <SetupPanel />}
    <div className="grid min-w-0 items-start gap-5 lg:grid-cols-2"><ModelsCard store={store} /><AgentClisCard store={store} /></div>
    <div className="grid min-w-0 items-start gap-5 lg:grid-cols-2">
      <HostCard store={store} now={now} /><BackupCard store={store} now={now} />
      <McpCard store={store} /><PacksCard store={store} />
    </div>
    <CommandsCard store={store} />
  </Page>;
}
