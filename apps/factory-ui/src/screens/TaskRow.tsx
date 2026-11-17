import { useId, useState } from 'react';
import type { Task, TaskState } from '@factory/contracts';
import { taskMascotState } from '@/components/mascot/state';
import { useT } from '../i18n';
import type { Store } from '../state/store';
import { MoreHorizontal } from 'lucide-react';
import { KeyValueList } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { TableCell, TableRow } from '@/components/ui/table';
import { shallowSelectionEqual } from '../state/storeSelector';
import { DecisionBadge, SeatChip, TaskTime } from './TaskPresentation';
import { TaskStatus } from './shell/TaskStatus';
import { ErrorNotice } from '../components/ErrorNotice';
import { useTaskTransition } from './useTaskTransition';

export function TaskRow({ store, projectId, task, onOpen, selected = false }: { store: Store; projectId: string; task: Task; onOpen: (id: string) => void; selected?: boolean }) {
  const t = useT();
  const state = store.useStoreSelector(value => ({ tasks: value.tasks, team: value.team, liveAttempts: value.liveAttempts, details: value.details, inbox: value.inbox, globalInbox: value.globalInbox, pending: value.pending, session: value.session }), shallowSelectionEqual);
  const [expanded, setExpanded] = useState(false);
  const { targets, canPropose, run: transition, confirm, setConfirm, pending, busy, disabled, retry, retryDisabled } = useTaskTransition(store, projectId, task);
  const actions: TaskState[] = [...(canPropose ? ['proposed' as const] : []), ...targets];
  const id = useId();
  const owner = state.team?.seats.find((seat) => seat.id === task.ownerSeatId);
  return <>
    <TableRow data-state={selected ? 'selected' : undefined} onClick={() => onOpen(task.id)} className="cursor-pointer">
      <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{task.code}</TableCell>
      <TableCell className="min-w-60 max-w-sm whitespace-normal"><span className="line-clamp-2 font-medium">{task.title}</span>{state.inbox.approvals.some(item => item.taskId === task.id) && <DecisionBadge />}</TableCell>
      <TableCell><TaskStatus task={task} state={state} /></TableCell>
      <TableCell><SeatChip name={owner?.name} size={20} state={taskMascotState(task, state)} /></TableCell>
      <TableCell><TaskTime task={task} state={state} /></TableCell>
      <TableCell className="pr-4" onClick={event => event.stopPropagation()}><div className="flex justify-end gap-1">
        <Button type="button" variant="ghost" size="sm" data-task-id={task.id} aria-pressed={selected} onClick={() => onOpen(task.id)}>{t('workUi.open')}</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label={t('workUi.moreActions').replace('{code}', task.code)}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem aria-expanded={expanded} aria-controls={id} onSelect={() => setExpanded(!expanded)}>{t('workUi.quickLook')}</DropdownMenuItem>
            {actions.map(to => <DropdownMenuItem key={to} disabled={disabled} onSelect={() => { if (to === 'declined' || to === 'cancelled') setConfirm(to); else transition(to); }}>{t(`taskUi.actions.${to}`)}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      </div></TableCell>
    </TableRow>
    {(expanded || confirm || pending?.error) && <TableRow className="hover:bg-transparent"><TableCell colSpan={6} className="p-4 whitespace-normal">
      <div className="space-y-4">
        {expanded && <div id={id} className="space-y-3 text-sm">
          <h4 className="font-medium">{t('taskUi.goal')}</h4><p className="whitespace-pre-wrap">{task.goal}</p>
          <h4 className="font-medium">{t('taskUi.acceptance')}</h4><ul className="list-disc space-y-1 pl-5">{task.acceptance.map((criterion, index) => <li key={index} className="whitespace-pre-wrap">{criterion}</li>)}</ul>
          <p className="text-muted-foreground">{task.requiredCapabilities.join(', ')}</p>
          <KeyValueList items={[
            { label: t('taskUi.dependencies'), value: task.dependsOn.length ? task.dependsOn.map(dependency => state.tasks.find(item => item.id === dependency)?.code ?? dependency).join(', ') : t('taskUi.dash') },
            { label: t('taskUi.placement'), value: t(`taskUi.placements.${task.placement}`) },
            { label: t('taskUi.sideEffect'), value: t(`taskUi.sideEffects.${task.sideEffect}`) },
            { label: t('taskUi.reviewPolicy'), value: t(`taskUi.reviewPolicies.${task.reviewPolicy}`) },
          ]} />
        </div>}
        {confirm && <Card role="group" aria-label={t('taskUi.confirmation')} className="gap-3 border-border bg-muted/40 p-4 shadow-none"><p>{t(`taskUi.confirm.${confirm}`)}</p>
          <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="text-need" disabled={disabled} onClick={() => transition(confirm)}>{t(`taskUi.confirmActions.${confirm}`)}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>{t('taskUi.keep')}</Button></div>
        </Card>}
        {pending?.error && <ErrorNotice error={pending.error} />}
        {pending?.status === 'failed' && <Button type="button" variant="outline" size="sm" disabled={retryDisabled} onClick={retry}>{t('errors.retry')}</Button>}
      </div>
    </TableCell></TableRow>}
  </>;
}
