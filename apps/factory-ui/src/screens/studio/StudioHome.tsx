import { useCallback, useId } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Page } from '@/components/Page';
import { ErrorNotice } from '@/components/ErrorNotice';
import { i18n, useT } from '@/i18n';
import type { Store } from '@/state/store';
import { attentionItems, type AttentionItem } from '../shell/attention';
import { ProjectTile } from '../shell/ProjectTile';
import { stageName } from './presentation';
import { useStudioRead } from './useStudioRead';

export function StudioHome({ store, onProject, onAttention, onCreate }: {
  store: Store; onProject: (id: string) => void; onAttention: (item?: AttentionItem) => void; onCreate: () => void;
}) {
  const t = useT(); const id = useId();
  const state = store.useStoreSelector(value => value);
  const read = useCallback((signal: AbortSignal) => store.listGames(signal), [store]);
  const { data, error, reload } = useStudioRead(read, 15_000);
  const items = attentionItems(state.globalInbox);
  return <Page className="min-w-0 space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-5 rounded-xl border border-border bg-card p-6">
      <div className="space-y-2"><h1 className="font-display text-3xl font-semibold">{t('studioUi.title')}</h1><p className="text-muted-foreground">{t('studioUi.hero')}</p></div>
      <Button type="button" onClick={onCreate}>{t('gameUi.newGame')}</Button>
    </header>
    <section aria-labelledby={`${id}-games`} className="space-y-4">
      <h2 id={`${id}-games`} className="text-xl font-semibold">{t('studioUi.games')}</h2>
      {error && <div role="alert" className="flex flex-wrap items-center gap-3"><p>{t('studioUi.loadError')}</p><Button variant="outline" onClick={reload}>{t('errors.retry')}</Button></div>}
      {!data && !error && <p role="status">{t('viewStates.loading')}</p>}
      {data?.games.length === 0 && <Card className="items-center p-8 text-center"><p>{t('studioUi.empty')}</p><Button onClick={onCreate}>{t('gameUi.newGame')}</Button></Card>}
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {data?.games.map(game => <Card key={game.projectId} className="min-w-0 gap-4 p-5">
          <div className="flex min-w-0 items-center gap-3"><ProjectTile id={game.projectId} name={game.name} className="size-14 rounded-xl" /><h3 className="text-lg font-semibold [overflow-wrap:anywhere]">{game.name}</h3></div>
          <dl className="space-y-2 text-sm">
            <div><dt className="text-muted-foreground">{t('studioUi.build')}</dt><dd>{game.workflow ? t(`studioUi.states.${game.workflow.state}`) : t('studioUi.noBuild')}</dd></div>
            {game.workflow?.currentStage && <div><dt className="text-muted-foreground">{t('studioUi.stage')}</dt><dd>{stageName(game.workflow.currentStage, t)}</dd></div>}
            {!!game.workflow?.loops && <div><dt className="inline text-muted-foreground">{t('studioUi.rework')} </dt><dd className="inline">{new Intl.NumberFormat(i18n.locale).format(game.workflow.loops)}</dd></div>}
            {game.release?.state === 'done' && <div><dt className="text-muted-foreground">{t('studioUi.liveVersion')}</dt><dd>{game.release.version === null ? t('gameUi.unassignedVersion') : t('gameUi.version').replace('{version}', String(game.release.version))}</dd></div>}
          </dl>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" onClick={() => onProject(game.projectId)} aria-label={`${t('studioUi.open')}: ${game.name}`}>{t('studioUi.open')}</Button>
            {game.release?.state === 'done' && game.release.playUrl && /^https?:\/\//i.test(game.release.playUrl) && <a href={game.release.playUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">{t('gameUi.openGame')}</a>}
          </div>
        </Card>)}
      </div>
    </section>
    <Card role="complementary" aria-labelledby={`${id}-attention`} className="gap-3 p-5">
      <div className="flex items-center gap-3"><h2 id={`${id}-attention`} className="text-lg font-semibold">{t('studioUi.needsYou')}</h2><Badge>{items.length}</Badge></div>
      {state.loading.globalInbox && <p role="status">{t('viewStates.loading')}</p>}
      {state.errors.globalInbox && <><ErrorNotice error={state.errors.globalInbox} /><Button variant="outline" onClick={() => { void store.loadGlobalInbox(); }}>{t('errors.retry')}</Button></>}
      {!items.length && !state.loading.globalInbox && !state.errors.globalInbox && <p className="text-sm text-muted-foreground">{t('overview.caughtUp')}</p>}
      <ul className="space-y-2">{items.slice(0, 5).map(item => <li key={item.key}><Button variant="ghost" className="h-auto w-full justify-start whitespace-normal text-left [overflow-wrap:anywhere]" onClick={() => onAttention(item)}>{item.projectName && <span className="text-muted-foreground">{item.projectName}:</span>}{item.title}</Button></li>)}</ul>
      <Button variant="ghost" onClick={() => onAttention()}>{t('overview.viewAll')}</Button>
    </Card>
  </Page>;
}
