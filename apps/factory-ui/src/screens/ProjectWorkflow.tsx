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

export function ProjectWorkflow({ store, projectId, onOpenTask }: { store: Store; projectId: string; onOpenTask?: (taskId: string) => void }) {
  const t = useT(); const state = store.useStoreSelector(value => value); const [view, setView] = useState('diagram'); const [selected, setSelected] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  useEffect(() => store.watchM5('workflows', store.loadWorkflows), [store, projectId]);
  const instances = state.m5.workflows; const instance = instances.find(item => item.id === selected) ?? instances[0]; const detail = instance ? state.m5.workflowDetails[instance.id] : undefined;
  const create = <Button type="button" disabled={state.session !== 'authenticated'} onClick={() => setCreateOpen(true)}><Plus />{t('workflowGraph.create')}</Button>;
  return <Page className="min-w-0 space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="space-y-1"><h2 className="font-display text-3xl font-semibold">{t('workflowUi.title')}</h2><p className="text-sm text-muted-foreground">{t('ux5.workflowDescription')}</p></div>
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup type="single" value={view} onValueChange={value => { if (value) setView(value); }} variant="outline" size="sm" aria-label={t('workflowGraph.views')} className="rounded-full">
          <ToggleGroupItem value="diagram" className="!rounded-l-full">{t('workflowGraph.diagram')}</ToggleGroupItem>
          <ToggleGroupItem value="list" className="!rounded-r-full">{t('workUi.list')}</ToggleGroupItem>
        </ToggleGroup>
        <Button type="button" variant="ghost" disabled={state.loading.workflows} onClick={() => void store.loadWorkflows()}><RefreshCw />{t('m5Ui.refresh')}</Button>
        {create}
      </div>
    </header>
    {view === 'list' ? <WorkflowList store={store} onOpenTask={onOpenTask} /> : <>
      <M5ReadState store={store} area="workflows" retry={store.loadWorkflows} />
      {!instances.length && !state.loading.workflows && !state.errors.workflows && <Empty className="min-h-[480px] rounded-xl border border-border bg-card"><EmptyDescription>{t('workflowUi.empty')}</EmptyDescription>{create}</Empty>}
      {instance && <div className="space-y-4">
        <InstanceChooser instances={instances} selected={instance.id} onSelect={setSelected} />
        <M5ReadState store={store} area={`workflow:${instance.id}`} retry={() => store.loadWorkflow(instance.id)} />
        {detail && <><InstanceControls key={detail.id} store={store} projectId={projectId} instance={detail} /><WorkflowDiagram key={detail.id} store={store} projectId={projectId} detail={detail} onOpenTask={onOpenTask} /></>}
      </div>}
    </>}
    {createOpen && <CreateWorkflow key={projectId} store={store} projectId={projectId} onClose={() => setCreateOpen(false)}
      onCreated={instanceId => { setSelected(instanceId); setView('diagram'); setCreateOpen(false); }} />}
  </Page>;
}
