import { useEffect, useState } from 'react';
import type { WorkflowDetail } from '@/api/m5Models';
import { Empty, EmptyDescription } from '@/components/ui/empty';
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
  return <div className="flex min-w-0 flex-col gap-4 lg:flex-row">
    <div className="h-[calc(100vh-17rem)] min-h-[480px] min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-card" role="region" aria-label={t('workflowGraph.diagram')}><LazyWorkflowGraph graph={detail.graph} stages={detail.stages} phases={detail.phases} selectedStage={selected} onSelectStage={setSelected} /></div>
    {definition && stage && <StagePanel definition={definition} stage={stage} detail={detail} onClose={() => setSelected(null)} onOpenTask={onOpenTask} assignment={['pending', 'blocked'].includes(stage.state) ? <StageAssignment key={`${stage.key}:${stage.engagementId ?? ''}`} store={store} projectId={projectId} detail={detail} stage={stage} /> : null} />}
  </div>;
}
