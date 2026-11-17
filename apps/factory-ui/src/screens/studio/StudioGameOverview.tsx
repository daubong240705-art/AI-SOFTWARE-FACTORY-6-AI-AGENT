import { useId } from 'react';
import type { WorkflowInstance } from '@/api/client';
import { Page } from '@/components/Page';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { GamePanel } from '../GamePanel';
import { BuildSummary } from './BuildSummary';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
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
    <GamePanel store={store} projectId={projectId} gameName={gameName} workflow={workflow} />
    <Collapsible className="min-w-0 space-y-4">
      <CollapsibleTrigger asChild><Button variant="outline" className="group"><ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />{t('m5Ui.technicalDetails')}</Button></CollapsibleTrigger>
      <CollapsibleContent className="space-y-4">
        <BuildSummary workflow={workflow} detail={detail} />
        <GameReportCard store={store} projectId={projectId} active={active} />
      </CollapsibleContent>
    </Collapsible>
    <section aria-labelledby={`${id}-play`} className="min-w-0 space-y-4">
      <h2 id={`${id}-play`} className="font-display text-xl font-semibold">{t('studioUi.playtest')}</h2>
      <EmbeddedPlaytest store={store} projectId={projectId} gameName={gameName} />
      <FeedbackBox store={store} projectId={projectId} />
    </section>
  </Page>;
}
