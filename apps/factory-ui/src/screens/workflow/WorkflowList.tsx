import { Stagger, StaggerItem } from '@/components/motion/Stagger';
import { useId, useState } from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { relativeTime } from '../Inbox';
import { M5ReadState, M5Status, m5Dot, TechnicalDetails } from '../M5Shared';
import type { Store } from '@/state/store';
import { LoopChip } from './LoopChip';

export function WorkflowList({ store, onOpenTask }: { store: Store; onOpenTask?: ((taskId: string) => void) | undefined }) {
  const t = useT(); const state = store.useStoreSelector(s => s); const id = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const selectedItem = state.m5.workflows.find(item => item.id === selected);
  const detail = selectedItem ? state.m5.workflowDetails[selectedItem.id] : undefined;
  return <div className={cn('grid min-w-0 items-start gap-6', selectedItem && 'lg:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]')}>
      <Card role="region" aria-label={t('workflowUi.list')} className="gap-0 overflow-hidden border-border py-0 shadow-none">
        <M5ReadState store={store} area="workflows" retry={store.loadWorkflows} empty={!state.m5.workflows.length} emptyKey="workflowUi.empty" />
        <Stagger className="divide-y divide-border">{state.m5.workflows.map((item, index) => {
          const info = state.m5.workflowDetails[item.id]; const current = info?.stages.filter(stage => stage.state === 'active');
          const loop = info?.stages.find(stage => stage.loopCount !== undefined); const at = info?.lastProgressAt ?? item.createdAt;
          return <StaggerItem key={item.id} index={index}><Button type="button" variant="ghost" className={cn('h-auto w-full flex-col items-start gap-3 rounded-none p-5 text-left whitespace-normal', selected === item.id && 'bg-secondary')} aria-current={selected === item.id} aria-controls={`${id}-detail`} onClick={() => { setSelected(item.id); if (!info) void store.loadWorkflow(item.id); }}>
            <span className="flex w-full flex-wrap items-center justify-between gap-2"><span className="font-medium break-words">{item.title}</span><M5Status value={item.state} /></span>
            {!!current?.length && <span className="text-xs font-normal text-muted-foreground">{t('workflowUi.currentStage')}: {current.map(stage => stage.key).join(', ')}</span>}
            <span className="flex flex-wrap items-center gap-3">{loop && <LoopChip stage={loop} />}<time className="text-xs font-normal text-muted-foreground" dateTime={at}>{relativeTime(at)}</time></span>
          </Button></StaggerItem>;
        })}</Stagger>
      </Card>
      {selectedItem && <Card role="region" id={`${id}-detail`} aria-label={t('workflowUi.detail')} className="min-w-0 gap-0 border-border py-0 shadow-none">
        <CardHeader className="flex flex-row items-center justify-between border-b border-border px-5 py-4"><h2 className="font-display text-xl font-semibold break-words">{selectedItem.title}</h2><Button type="button" variant="ghost" size="icon-sm" aria-label={t('m5Ui.close')} onClick={() => setSelected(null)}><X /></Button></CardHeader>
        <CardContent className="space-y-5 p-5"><M5ReadState store={store} area={`workflow:${selectedItem.id}`} retry={() => store.loadWorkflow(selectedItem.id)} />
          {detail && <><ol aria-label={t('workflowUi.stages')} className="ml-1">{detail.stages.map((stage, index) => <li key={stage.key} className={cn('relative pb-6 pl-7 last:pb-0', index < detail.stages.length - 1 && 'before:absolute before:top-3 before:bottom-0 before:left-1 before:w-px before:bg-border')}>
            <span aria-hidden className={cn('absolute top-1.5 left-0 size-2.5 rounded-full ring-4 ring-card', m5Dot(stage.state))} />
            <div className="flex flex-wrap items-center gap-3"><h3 className="text-sm font-medium">{stage.key}</h3><M5Status value={stage.state} /><LoopChip stage={stage} /></div>
            {!!stage.tasks.length && <div className="mt-3 flex flex-wrap gap-2">{stage.tasks.map(task => <Badge key={task.taskId} variant="outline" asChild={!!onOpenTask} className="rounded-md font-mono font-normal">{onOpenTask ? <Button type="button" variant="ghost" size="sm" className="h-6 px-2" onClick={() => onOpenTask(task.taskId)}>{task.code}</Button> : task.code}</Badge>)}</div>}
            {stage.blockedReason && <div className="mt-2"><TechnicalDetails><p>{stage.blockedReason}</p></TechnicalDetails></div>}
          </li>)}</ol>{!detail.stages.length && <Empty><EmptyDescription>{t('workflowUi.noStages')}</EmptyDescription></Empty>}<TechnicalDetails identifier={detail.id}><dl className="grid gap-1"><dt>{t('workflowUi.definition')}</dt><dd className="font-mono">{detail.key}</dd></dl></TechnicalDetails></>}
        </CardContent>
      </Card>}
  </div>;
}
