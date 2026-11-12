import { useEffect } from 'react';
import type { WorkflowDetail } from '@/api/m5Models';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useT } from '@/i18n';
import { LazyWorkflowGraph } from './LazyWorkflowGraph';
import { StagePanel } from './StagePanel';
import { stageState } from './graphTypes';
import type { Store } from '@/state/store';
import { StageAssignment } from './StageAssignment';
import type { LiveRuns } from './useLiveRuns';
import { StagePatchActions } from './StagePatchActions';
import { PatchComposer } from './PatchComposer';
import { PatchHistory } from './PatchHistory';

export function WorkflowDiagram({ store, projectId, detail, liveRuns, selectedStage: selected, onSelectStage: setSelected, onOpenTask, editMode = false }: { store: Store; projectId: string; detail: WorkflowDetail; liveRuns: LiveRuns; selectedStage: string | null; onSelectStage: (stage: string | null) => void; onOpenTask?: ((taskId: string) => void) | undefined; editMode?: boolean }) {
  const t = useT();
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) setSelected(null); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, []);
  const definition = detail.graph?.stages.find(stage => stage.key === selected);
  const stage = definition ? stageState(definition.key, detail.stages) : null;
  return <div className="min-w-0 space-y-3">
    {detail.graph?.stages.length ? <div className="h-[calc(100vh-12.5rem)] min-h-[440px] min-w-0 overflow-hidden rounded-xl border border-border bg-card" role="region" aria-label={t('workflowGraph.diagram')}><LazyWorkflowGraph graph={detail.graph} stages={detail.stages} phases={detail.phases} liveRuns={liveRuns} selectedStage={selected} onSelectStage={setSelected} editMode={editMode} /></div> : <Empty className="min-h-[480px] rounded-xl border border-border bg-card"><EmptyDescription>{t('workflowGraph.unavailable')}</EmptyDescription></Empty>}
    <Sheet open={!!(definition && stage)} onOpenChange={open => { if (!open) setSelected(null); }} modal={false}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto border-border sm:max-w-[400px]" onOpenAutoFocus={event => event.preventDefault()}
        onInteractOutside={event => { if ((event.target as HTMLElement | null)?.closest('.react-flow')) event.preventDefault(); }}>
        <SheetHeader className="border-b border-border p-4"><SheetTitle className="font-display text-lg break-words">{definition?.title || definition?.key}</SheetTitle><SheetDescription className="sr-only">{t('workflowGraph.stageDetails')}</SheetDescription></SheetHeader>
        {definition && stage && <StagePanel definition={definition} stage={stage} detail={detail} liveRuns={liveRuns} onOpenTask={onOpenTask} assignment={['pending', 'blocked'].includes(stage.state) ? <StageAssignment key={`${stage.key}:${stage.engagementId ?? ''}`} store={store} projectId={projectId} detail={detail} stage={stage} /> : null} editActions={editMode ? <StagePatchActions key={stage.key} store={store} detail={detail} definition={definition} stage={stage} /> : null} />}
      </SheetContent>
    </Sheet>
    <PatchHistory store={store} detail={detail} editMode={editMode} />
    {/* The stage drawer is a fixed 400 px panel on the right: keep the composer's buttons clear of it. */}
    <div className={definition && stage ? 'sm:pr-[416px]' : undefined}><PatchComposer store={store} detail={detail} /></div>
  </div>;
}
