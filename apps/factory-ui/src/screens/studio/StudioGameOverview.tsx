import { useId } from 'react';
import type { WorkflowInstance } from '@/api/client';
import { Page } from '@/components/Page';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { GamePanel } from '../GamePanel';
import { BuildSummary } from './BuildSummary';
import { EmbeddedPlaytest } from './EmbeddedPlaytest';
import { FeedbackBox } from './FeedbackBox';
import { GameReportCard } from './GameReportCard';
import { isFinished } from './presentation';

export function StudioGameOverview({ store, projectId, gameName, workflow }: { store: Store; projectId: string; gameName: string; workflow: WorkflowInstance }) {
  const t = useT(); const id = useId();
  const state = store.useStoreSelector(value => value);
  const detail = state.m5.workflowDetails[workflow.id];
  const active = state.m5.workflows.some(item => item.key === 'game-build' && !isFinished(item.state));
  return <Page className="grid min-w-0 gap-8">
    <section aria-labelledby={`${id}-make`} className="min-w-0 space-y-4">
      <h2 id={`${id}-make`} className="font-display text-xl font-semibold">{t('studioUi.make')}</h2>
      <BuildSummary workflow={workflow} detail={detail} />
      <GameReportCard store={store} projectId={projectId} active={active} />
    </section>
    <section aria-labelledby={`${id}-play`} className="min-w-0 space-y-4">
      <h2 id={`${id}-play`} className="font-display text-xl font-semibold">{t('studioUi.playtest')}</h2>
      <EmbeddedPlaytest store={store} projectId={projectId} gameName={gameName} />
      <FeedbackBox store={store} projectId={projectId} />
    </section>
    <section aria-labelledby={`${id}-publish`} className="min-w-0 space-y-4">
      <h2 id={`${id}-publish`} className="font-display text-xl font-semibold">{t('studioUi.publish')}</h2>
      <GamePanel store={store} projectId={projectId} gameName={gameName} workflow={workflow} releaseOnly />
    </section>
  </Page>;
}
