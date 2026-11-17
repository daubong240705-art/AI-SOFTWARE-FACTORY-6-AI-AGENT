import { useEffect, useId, useState } from 'react';
import { isLiveAttempt } from '@factory/contracts';
import { ChevronDown, MoreHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ErrorNotice } from '../components/ErrorNotice';
import { useTaskTransition } from './useTaskTransition';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog } from '../components/Dialog';
import { ViewState } from '../components/app';
import { useT } from '../i18n';
import type { Store } from '../state/store';
import { shallowSelectionEqual } from '../state/storeSelector';
import { TaskContext } from './TaskContext';
import { DockedPane } from './DockedPane';
import { DecisionDialog, pendingApproval } from './DecisionDialog';
import { PushSection } from './PushSection';
import { TaskStatus } from './shell/TaskStatus';
import { TaskActions, taskActions } from './TaskActions';
import { Results } from './TaskResults';
import { TaskOverview, TaskProgress, PendingReviews, TaskHistory } from './TaskDetailSections';

export { Results } from './TaskResults';
export { TaskActions } from './TaskActions';
const tabAliases = { 'request': 'overview', 'progress': 'process', 'context': 'process', 'results': 'results', 'actions': 'results' } as const;
const tabs = ['overview', 'process', 'results'] as const;
type Tab = typeof tabs[number];
type InitialTab = keyof typeof tabAliases | Tab;
function initialDetailTab(tab: InitialTab): Tab {
  return tab in tabAliases ? tabAliases[tab as keyof typeof tabAliases] : tab as Tab;
}

export function TaskDetail({ store, taskId, onClose, initialTab = 'overview', inline = false, fallbackFocus, onOpenTask }: {
  store: Store; taskId: string; onClose: () => void; initialTab?: InitialTab; inline?: boolean; fallbackFocus?: () => HTMLElement | null; onOpenTask?: (id: string) => void;
}) {
  const t = useT();
  const id = useId();
  const selected = store.useStoreSelector(value => ({ session: value.session, projectId: value.selectedProjectId, task: value.tasks.find(item => item.id === taskId), detail: value.details[taskId], liveAttempts: value.liveAttempts, team: value.team }), shallowSelectionEqual);
  const [active, setActive] = useState<Tab>(() => initialDetailTab(initialTab));
  const [decision, setDecision] = useState<string | null>(null);
  useEffect(() => { void store.openTask(taskId); return () => store.closeTask(taskId); }, [store, taskId]);
  const task = selected.task; const detail = selected.detail;
  const attempt = detail?.attempts[0];
  const live = detail?.attempts.find(item => isLiveAttempt(item.state)) ?? selected.liveAttempts[taskId];
  const lifecycle = useTaskTransition(store, selected.projectId, task);
  const pending = detail?.approvals.filter(item => pendingApproval(item) && (item.kind === 'review' || item.kind === 'question')) ?? [];
  if (selected.session !== 'authenticated' || !task) return null;
  const canAct = taskActions(task, live).length > 0;
  const owner = selected.team?.seats.find(seat => seat.id === task.ownerSeatId)?.name;
  const content = <div className="flex min-h-full min-w-0 flex-col"><div className="flex-1 space-y-5 p-6">
    <header className="space-y-3">
      <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 flex-wrap items-center gap-3"><span className="font-mono text-xs text-muted-foreground">{task.code}</span><TaskStatus task={task} state={selected} /></div><Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={t('workUi.close')} className="shrink-0 text-muted-foreground" onClick={onClose}><X className="size-4" aria-hidden="true" /></Button></TooltipTrigger><TooltipContent>{t('workUi.close')} <Kbd>Esc</Kbd></TooltipContent></Tooltip></div>
      <h2 id={`${id}-title`} className="text-xl font-semibold leading-snug [overflow-wrap:anywhere]">{task.title}</h2>
      <p className="text-sm text-muted-foreground">{t(`taskUi.lifecycle.${task.state}`)} · {owner ?? t('taskUi.dash')}</p>
    </header>
    <Tabs value={active} onValueChange={value => setActive(value as Tab)} className="min-w-0 gap-5">
      <TabsList variant="pills" aria-label={t('workUi.sections')}>{tabs.map(tab => <TabsTrigger value={tab} key={tab}>{t(`workUi.${tab}`)}</TabsTrigger>)}</TabsList>
      <ViewState loading={!!detail?.loading} error={detail?.error} onRetry={() => { void store.loadTaskDetail(taskId); }} />
      <TabsContent value={active} tabIndex={0} className="min-w-0 space-y-6 outline-none">
        {active === 'overview' && <><TaskOverview store={store} task={task} {...(onOpenTask ? { onOpenTask } : {})} />{detail && <PendingReviews detail={detail} onDecision={setDecision} />}</>}
        {active === 'process' && <><TaskProgress store={store} taskId={taskId} detail={detail} attempt={attempt} /><Collapsible><CollapsibleTrigger asChild><Button type="button" variant="ghost" className="group w-full justify-between px-0 text-left">{t('workUi.agentReceived')}<ChevronDown aria-hidden="true" className="size-4 transition-transform group-data-[state=open]:rotate-180" /></Button></CollapsibleTrigger><CollapsibleContent className="pt-3"><TaskContext store={store} taskId={taskId} /></CollapsibleContent></Collapsible></>}
        {active === 'results' && <>{detail && <Results store={store} task={task} detail={detail} attempt={attempt} />}<PushSection store={store} task={task} attempt={attempt} />{detail && <TaskHistory detail={detail} />}</>}
      </TabsContent>
    </Tabs>
    </div>
    {(canAct || pending.length > 0 || lifecycle.targets.length > 0 || lifecycle.confirm || lifecycle.error) && <div className="sticky bottom-0 border-t border-border bg-background/95 px-6 py-3 backdrop-blur">
      {lifecycle.confirm && <div role="group" aria-label={t('taskUi.confirmation')} className="mb-3 space-y-3 rounded-lg bg-need/10 p-3"><p>{t(`taskUi.confirm.${lifecycle.confirm}`)}</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="text-need" disabled={lifecycle.disabled} onClick={() => { if (lifecycle.confirm) lifecycle.run(lifecycle.confirm); }}>{t(`taskUi.confirmActions.${lifecycle.confirm}`)}</Button><Button type="button" variant="ghost" disabled={lifecycle.busy} onClick={() => lifecycle.setConfirm(null)}>{t('taskUi.keep')}</Button></div></div>}
      {lifecycle.error && <div className="mb-3"><ErrorNotice error={lifecycle.error} /></div>}
      <div className="flex flex-wrap items-start gap-3">
        {lifecycle.targets.includes('accepted') && <Button type="button" disabled={lifecycle.disabled} onClick={() => lifecycle.run('accepted')}>{t('taskUi.actions.accepted')}</Button>}
        {lifecycle.targets.some(to => to === 'declined' || to === 'cancelled') && <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={t('workUi.moreActions').replace('{code}', task.code)}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{lifecycle.targets.flatMap(to => to === 'declined' || to === 'cancelled' ? [<DropdownMenuItem key={to} disabled={lifecycle.disabled} onSelect={() => lifecycle.setConfirm(to)}>{t(`taskUi.actions.${to}`)}</DropdownMenuItem>] : [])}</DropdownMenuContent></DropdownMenu>}
        {lifecycle.pending?.status === 'failed' && <Button type="button" variant="outline" disabled={lifecycle.retryDisabled} onClick={lifecycle.retry}>{t('errors.retry')}</Button>}<div className="min-w-0 flex-1 space-y-3"><TaskActions store={store} task={task} attempt={live} /></div>{pending.length > 0 && <Button type="button" onClick={() => setDecision(pending[0]!.id)}>{t('workUi.decide')}</Button>}</div></div>}
  </div>;
  const pane = inline ? <DockedPane label={t('projectUi.taskDetails')} className="project-task-pane h-full bg-background" onClose={onClose} {...(fallbackFocus ? { fallbackFocus } : {})}>{content}</DockedPane> : <Dialog labelledBy={`${id}-title`} onClose={onClose} className="block p-0">{content}</Dialog>;
  return <>{pane}{decision && <DecisionDialog store={store} approvalId={decision} onClose={() => setDecision(null)} onShowResults={() => { setDecision(null); setActive('results'); }} />}</>;
}
