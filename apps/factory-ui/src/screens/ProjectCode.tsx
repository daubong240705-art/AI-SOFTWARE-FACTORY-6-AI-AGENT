import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { Page } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { EffectsSection } from './code/EffectsSection';
import { IntegrationSection } from './code/IntegrationSection';

export function ProjectCode({ store, projectId }: { store: Store; projectId: string }) {
  const t = useT();
  const state = store.useStoreSelector(s => s);
  useEffect(() => {
    if (state.selectedProjectId !== projectId || state.session !== 'authenticated') return;
    let interval: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      clearInterval(interval);
      interval = undefined;
      if (document.hidden) return;
      void store.refreshCode();
      interval = setInterval(() => { void store.refreshCode(); }, 20_000);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', sync); };
  }, [store, projectId, state.selectedProjectId, state.session]);
  return <Page className="min-h-full space-y-6 px-6 pb-12 2xl:px-6">
    <header className="flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-1 space-y-2">
        <h2 className="font-display text-4xl font-bold tracking-tight">{t('projectUi.code')}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{t('codeUi.description')}</p>
      </div>
      <Button variant="ghost" disabled={Boolean(state.loading.integration || state.loading.effects || state.loading.remotes)} onClick={() => { void store.refreshCode(); }}>
        <RefreshCw aria-hidden="true" className="size-4" />{t('codeUi.refresh')}
      </Button>
    </header>
    <IntegrationSection store={store} projectId={projectId} />
    <EffectsSection store={store} />
  </Page>;
}
