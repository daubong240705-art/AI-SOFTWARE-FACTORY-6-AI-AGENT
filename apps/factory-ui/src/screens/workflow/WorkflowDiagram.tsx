import { useEffect, useState } from 'react';
import type { WorkflowDetail } from '@/api/m5Models';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useT } from '@/i18n';
import { LazyWorkflowGraph } from './LazyWorkflowGraph';
import { StagePanel } from './StagePanel';
import { stageState } from './graphTypes';
import type { Store } from '@/state/store';
import { StageAssignment } from './StageAssignment';

export function WorkflowDiagram({ store, projectId, detail, onOpenTask }: { store: Store; projectId: string; detail: WorkflowDetail; onOpenTask?: ((taskId: string) => void) | undefined }) {
  const t = useT(); const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) setSelected(null); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, []);
  if (!detail.graph?.stages.length) return <Empty className="min-h-[480px] rounded-xl border border-border bg-card"><EmptyDescription>{t('workflowGraph.unavailable')}</EmptyDescription></Empty>;
  const definition = detail.graph.stages.find(stage => stage.key === selected);
  const stage = definition ? stageState(definition.key, detail.stages) : null;
  return <div className="min-w-0">
    <div className="h-[calc(100vh-12.5rem)] min-h-[440px] min-w-0 overflow-hidden rounded-xl border border-border bg-card" role="region" aria-label={t('workflowGraph.diagram')}><LazyWorkflowGraph graph={detail.graph} stages={detail.stages} phases={detail.phases} selectedStage={selected} onSelectStage={setSelected} /></div>
    <Sheet open={!!(definition && stage)} onOpenChange={open => { if (!open) setSelected(null); }} modal={false}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto border-border sm:max-w-[400px]" onOpenAutoFocus={event => event.preventDefault()}
        onInteractOutside={event => { if ((event.target as HTMLElement | null)?.closest('.react-flow')) event.preventDefault(); }}>
        <SheetHeader className="border-b border-border p-4"><SheetTitle className="font-display text-lg break-words">{definition?.title || definition?.key}</SheetTitle><SheetDescription className="sr-only">{t('workflowGraph.stageDetails')}</SheetDescription></SheetHeader>
        {definition && stage && <StagePanel definition={definition} stage={stage} detail={detail} onOpenTask={onOpenTask} assignment={['pending', 'blocked'].includes(stage.state) ? <StageAssignment key={`${stage.key}:${stage.engagementId ?? ''}`} store={store} projectId={projectId} detail={detail} stage={stage} /> : null} />}
      </SheetContent>
    </Sheet>
  </div>;
}
