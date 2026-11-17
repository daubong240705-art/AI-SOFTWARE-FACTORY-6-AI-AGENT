import { PageHeader } from '@/components/app';
import { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Page } from '@/components/Page';
import { useT } from '../../i18n';
import type { Store } from '../../state/store';
import type { TeamTab } from '../shell/navigation';
import { TeamConfiguration } from './TeamConfiguration';
import { TeamPanel } from '../TeamPanel';
import { ActivityControls } from './activity/ActivityControls';
import { TeamActivity } from './activity/TeamActivity';
import { useActivity } from './activity/useActivity';

export function TeamsPage({ store, tab, onTabChange, onTask }: {
  store: Store; tab: TeamTab; onTabChange: (tab: TeamTab) => void; onTask: (projectId: string, taskId: string) => void;
}) {
  const t = useT();
  const { m3, selectedProjectId } = store.useStoreSelector(state => state);
  const [onlyMine, setOnlyMine] = useState(false);
  const now = useActivity(store, tab === 'activity' && !m3.disabled);
  useEffect(() => store.watchM3('teams', store.loadTeams), [store, selectedProjectId]);
  return <Page className="min-w-0 space-y-6 px-6 2xl:px-6">
    <Tabs value={tab} onValueChange={value => onTabChange(value as TeamTab)} className="gap-6">
      <PageHeader title={t('activityUi.title')}>
        {!m3.disabled && <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList variant="pills" aria-label={t('nav.team')}>
            <TabsTrigger value="activity">{t('activityUi.doing')}</TabsTrigger>
            <TabsTrigger value="config">{t('activityUi.config')}</TabsTrigger>
          </TabsList>
          {tab === 'activity' && <ActivityControls store={store} now={now} onlyMine={onlyMine} onFilter={setOnlyMine} />}
        </div>}
      </PageHeader>
      {m3.disabled ? <><p role="status" className="text-sm text-muted-foreground">{t('m3.disabled')}</p><TeamPanel store={store} /></> : <>
        <TabsContent value="activity"><TeamActivity store={store} onlyMine={onlyMine} now={now} onTask={onTask} /></TabsContent>
        <TabsContent value="config"><TeamConfiguration store={store} /></TabsContent>
      </>}
    </Tabs>
  </Page>;
}
