import { useEffect, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Page } from '@/components/Page';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { M5ReadState } from './M5Shared';
import { InstanceChooser } from './workflow/InstanceChooser';
import { WorkflowDiagram } from './workflow/WorkflowDiagram';
import { WorkflowList } from './workflow/WorkflowList';
import { InstanceControls } from './workflow/InstanceControls';
import { CreateWorkflow } from './workflow/CreateWorkflow';
import { useLiveRuns } from './workflow/useLiveRuns';
import { WorkflowLiveChip } from './workflow/WorkflowLiveChip';

export function ProjectWorkflow({ store, projectId, onOpenTask }: { store: Store; projectId: string; onOpenTask?: (taskId: string) => void }) {
  const t = useT(); const state = store.useStoreSelector(value => value); const [view, setView] = useState('diagram'); const [selected, setSelected] = useState<string | null>(null);
  const [stageSelection, setStageSelection] = useState<{ instanceId: string; key: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  useEffect(() => store.watchM5('workflows', store.loadWorkflows), [store, projectId]);
  const instances = state.m5.workflows; const instance = instances.find(item => item.id === selected) ?? instances[0]; const detail = instance ? state.m5.workflowDetails[instance.id] : undefined;
  const liveRuns = useLiveRuns(store, projectId, view === 'diagram' && !!detail?.graph?.stages.length);
  const selectedStage = stageSelection?.instanceId === detail?.id ? stageSelection?.key ?? null : null;
  const selectStage = (key: string | null) => setStageSelection(key && detail ? { instanceId: detail.id, key } : null);
  const create = <Button type="button" disabled={state.session !== 'authenticated'} onClick={() => setCreateOpen(true)}><Plus />{t('workflowGraph.create')}</Button>;
  return <Page className="min-w-0 space-y-3 py-4">
    <header className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2">
      {view === 'diagram' && instance ? <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3"><InstanceChooser instances={instances} selected={instance.id} onSelect={id => { setSelected(id); setStageSelection(null); }} />{detail && <InstanceControls key={detail.id} store={store} projectId={projectId} instance={detail} liveChip={<WorkflowLiveChip detail={detail} liveRuns={liveRuns} onSelectStage={selectStage} />} />}</div>
        : <h2 className="min-w-0 flex-1 font-display text-xl font-semibold">{t('workflowUi.title')}</h2>}
      <div className="ml-auto flex items-center gap-2">
        <ToggleGroup type="single" value={view} onValueChange={value => { if (value) { setView(value); setStageSelection(null); } }} variant="outline" size="sm" aria-label={t('workflowGraph.views')} className="rounded-full">
          <ToggleGroupItem value="diagram" className="!rounded-l-full">{t('workflowGraph.diagram')}</ToggleGroupItem>
          <ToggleGroupItem value="list" className="!rounded-r-full">{t('workUi.list')}</ToggleGroupItem>
        </ToggleGroup>
        <Button type="button" variant="outline" size="icon" aria-label={t('m5Ui.refresh')} title={t('m5Ui.refresh')} disabled={state.loading.workflows} onClick={() => void store.loadWorkflows()}><RefreshCw /></Button>
        {create}
      </div>
    </header>
    {view === 'list' ? <WorkflowList store={store} onOpenTask={onOpenTask} /> : <>
      <M5ReadState store={store} area="workflows" retry={store.loadWorkflows} />
      {!instances.length && !state.loading.workflows && !state.errors.workflows && <Empty className="min-h-[480px] rounded-xl border border-border bg-card"><EmptyDescription>{t('workflowUi.empty')}</EmptyDescription>{create}</Empty>}
      {instance && <div className="space-y-3">
        <M5ReadState store={store} area={`workflow:${instance.id}`} retry={() => store.loadWorkflow(instance.id)} />
        {detail && <WorkflowDiagram key={detail.id} store={store} projectId={projectId} detail={detail} liveRuns={liveRuns} selectedStage={selectedStage} onSelectStage={selectStage} onOpenTask={onOpenTask} />}
      </div>}
    </>}
    {createOpen && <CreateWorkflow key={projectId} store={store} projectId={projectId} onClose={() => setCreateOpen(false)}
      onCreated={instanceId => { setSelected(instanceId); setView('diagram'); setCreateOpen(false); }} />}
  </Page>;
}
