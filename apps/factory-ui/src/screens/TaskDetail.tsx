import { useEffect, useId, useState } from 'react';
import { isLiveAttempt } from '@factory/contracts';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog } from '../components/Dialog';
import { ErrorNotice } from '../components/ErrorNotice';
import { useT } from '../i18n';
import type { Store } from '../state/store';
import { TaskContext } from './TaskContext';
import { DockedPane } from './DockedPane';
import { DecisionDialog } from './DecisionDialog';
import { PushSection } from './PushSection';
import { TaskStatus } from './shell/TaskStatus';
import { SeatChip } from './TaskPresentation';
import { TaskActions } from './TaskActions';
import { Results } from './TaskResults';
import { TaskOverview, TaskProgress, TaskReviews } from './TaskDetailSections';

export { Results } from './TaskResults';
export { TaskActions } from './TaskActions';
const tabs = ['request', 'progress', 'results', 'actions', 'context'] as const;
type Tab = typeof tabs[number];

export function TaskDetail({ store, taskId, onClose, initialTab = 'request', inline = false, fallbackFocus }: {
  store: Store; taskId: string; onClose: () => void; initialTab?: Tab; inline?: boolean; fallbackFocus?: () => HTMLElement | null;
}) {
  const t = useT(); const state = store.useStoreSelector(value => value); const id = useId();
  const [active, setActive] = useState<Tab>(initialTab);
  const [decision, setDecision] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { void store.openTask(taskId); return () => store.closeTask(taskId); }, [store, taskId]);
  const task = state.tasks.find(item => item.id === taskId); const detail = state.details[taskId];
  const attempt = detail?.attempts.find(item => item.id === selected) ?? detail?.attempts[0];
  const live = detail?.attempts.find(item => isLiveAttempt(item.state)) ?? state.liveAttempts[taskId];
  if (!task || state.session !== 'authenticated') return null;
  if (decision) return <DecisionDialog store={store} approvalId={decision} onClose={() => setDecision(null)} />;
  const content = <div className="min-w-0 space-y-5">
    <header className="space-y-3">
      <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 flex-wrap items-center gap-3"><span className="font-mono text-xs text-muted-foreground">{task.code}</span><TaskStatus task={task} state={state} /></div>
        <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={t('workUi.close')} className="shrink-0 border-0 bg-transparent text-muted-foreground" onClick={onClose}><X className="size-4" aria-hidden="true" /></Button></TooltipTrigger><TooltipContent>{t('workUi.close')} <Kbd>Esc</Kbd></TooltipContent></Tooltip>
      </div>
      <h2 id={`${id}-title`} className="font-display text-xl leading-snug font-semibold [overflow-wrap:anywhere]">{task.title}</h2>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground"><span>{t('workUi.lifecycle')}: {t(`taskUi.lifecycle.${task.state}`)}</span><span className="inline-flex items-center gap-2">{t('taskUi.owner')}: <SeatChip name={state.team?.seats.find(seat => seat.id === task.ownerSeatId)?.name} /></span></div>
    </header>
    <Tabs value={active} onValueChange={value => setActive(value as Tab)} className="min-w-0 gap-5">
      <TabsList variant="pills" aria-label={t('workUi.sections')} className="max-w-full">
        {tabs.map(tab => <TabsTrigger value={tab} key={tab} id={`${id}-${tab}`} aria-controls={`${id}-panel`}>{t(tab === 'request' ? 'ux4.overview' : tab === 'context' ? 'projectUi.context' : `workUi.${tab}`)}</TabsTrigger>)}
      </TabsList>
      {detail?.loading && <p role="status" className="text-sm text-muted-foreground">{t('viewStates.loading')}</p>}
      {detail?.error && <><ErrorNotice error={detail.error} /><Button type="button" variant="outline" size="sm" className="self-start" onClick={() => { void store.loadTaskDetail(taskId); }}>{t('errors.retry')}</Button></>}
      <TabsContent value={active} id={`${id}-panel`} aria-labelledby={`${id}-${active}`} tabIndex={0} className="min-w-0 space-y-5 outline-none">
        {active === 'request' && <TaskOverview store={store} task={task} />}
        {active === 'context' && <TaskContext store={store} taskId={taskId} />}
        {active === 'progress' && <TaskProgress store={store} taskId={taskId} detail={detail} attempt={attempt} onSelect={item => { setSelected(item); void store.loadAttemptEvents(taskId, item); }} />}
        {(active === 'results' || active === 'actions') && detail && <TaskReviews detail={detail} onDecision={setDecision} />}
        {active === 'results' && detail && <Results store={store} task={task} detail={detail} attempt={attempt} />}
        {(active === 'results' || active === 'actions') && <PushSection store={store} task={task} attempt={attempt} />}
        <div hidden={active !== 'actions'}><Card className="gap-4 border-border p-5 shadow-none"><h3 className="text-sm font-semibold">{t('workUi.actions')}</h3><TaskActions store={store} task={task} attempt={live} /></Card></div>
      </TabsContent>
    </Tabs>
  </div>;
  return inline ? <DockedPane label={t('projectUi.taskDetails')} className="project-task-pane bg-background p-6" onClose={onClose} {...(fallbackFocus ? { fallbackFocus } : {})}>{content}</DockedPane>
    : <Dialog labelledBy={`${id}-title`} onClose={onClose} className="task-detail-backdrop">{content}</Dialog>;
}
