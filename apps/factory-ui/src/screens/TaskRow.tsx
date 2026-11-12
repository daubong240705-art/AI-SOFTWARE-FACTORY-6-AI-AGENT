import { useId, useRef, useState } from 'react';
import { TASK_TRANSITIONS, type Command, type Task, type TaskState } from '@factory/contracts';
import { tasksTransition } from '../api/commands';
import { taskMascotState } from '@/components/mascot/state';
import { useT } from '../i18n';
import type { Store } from '../state/store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TableCell, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { DecisionBadge, SeatChip, TaskTime } from './TaskPresentation';
import { TaskStatus } from './shell/TaskStatus';
import { ErrorNotice } from '../components/ErrorNotice';
const supported: readonly TaskState[] = ['proposed', 'accepted', 'declined', 'cancelled'];

export function TaskRow({ store, projectId, task, onOpen, selected = false }: { store: Store; projectId: string; task: Task; onOpen: (id: string) => void; selected?: boolean }) {
  const t = useT();
  const state = store.useStoreSelector((value) => value);
  const [expanded, setExpanded] = useState(false);
  const [confirm, setConfirm] = useState<TaskState | null>(null);
  const [command, setCommand] = useState<Command | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const id = useId();
  const pending = command ? state.pending[command.commandId] : undefined;
  const owner = state.team?.seats.find((seat) => seat.id === task.ownerSeatId);
  const actions = TASK_TRANSITIONS[task.state].filter((target) => supported.includes(target));
  const disabled = busy || !!command || state.session !== 'authenticated';
  async function execute(created: Command, retry = false) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setConfirm(null);
    try {
      const result = await (retry ? store.retry(created.commandId) : store.send(created));
      if (result && store.getState().session === 'authenticated') { await store.loadTasks(); setCommand(null); }
      else if (store.getState().pending[created.commandId]?.error?.code === 'conflict') await store.loadTasks();
    } finally { inFlight.current = false; setBusy(false); }
  }
  function transition(to: TaskState) {
    if (disabled || inFlight.current || !actions.includes(to)) return;
    const created = tasksTransition({ projectId, taskId: task.id, expectedRevision: task.revision, to });
    setCommand(created); void execute(created);
  }
  return <>
    <TableRow data-state={selected ? 'selected' : undefined} onClick={() => onOpen(task.id)} className="cursor-pointer">
      <TableCell className="pl-4"><Button type="button" variant="ghost" size="sm" data-task-id={task.id} aria-pressed={selected} className="px-0 font-mono text-xs" onClick={event => { event.stopPropagation(); onOpen(task.id); }}>{task.code}</Button></TableCell>
      <TableCell className="min-w-60 max-w-sm whitespace-normal"><span className="line-clamp-2 font-medium">{task.title}</span>{state.inbox.approvals.some(item => item.taskId === task.id) && <DecisionBadge />}</TableCell>
      <TableCell><TaskStatus task={task} state={state} /></TableCell>
      <TableCell><SeatChip name={owner?.name} state={taskMascotState(task, state)} /></TableCell>
      <TableCell><TaskTime task={task} state={state} /></TableCell>
      <TableCell className="pr-4" onClick={event => event.stopPropagation()}><div className="flex justify-end gap-1">
        <Button type="button" variant="ghost" size="sm" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>{t('taskUi.details')} {task.code}</Button>
        {actions.map(to => <Button type="button" variant="outline" size="sm" key={to} disabled={disabled} onClick={() => { if (to === 'declined' || to === 'cancelled') setConfirm(to); else transition(to); }}>{t(`taskUi.actions.${to}`)}</Button>)}
      </div></TableCell>
    </TableRow>
    {(expanded || confirm || pending?.error) && <TableRow className="hover:bg-transparent"><TableCell colSpan={6} className="p-4 whitespace-normal">
      <div className="space-y-4">
        {expanded && <Card id={id} className="gap-4 border-border p-5 text-sm shadow-none">
          <h4 className="font-medium">{t('taskUi.goal')}</h4><p className="whitespace-pre-wrap">{task.goal}</p>
          <Separator /><h4 className="font-medium">{t('taskUi.acceptance')}</h4><ul className="list-disc space-y-1 pl-5">{task.acceptance.map((criterion, index) => <li key={index} className="whitespace-pre-wrap">{criterion}</li>)}</ul>
          <div className="flex flex-wrap gap-2">{task.requiredCapabilities.map(capability => <Badge variant="secondary" key={capability}>{capability}</Badge>)}</div>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div><dt className="text-muted-foreground">{t('taskUi.dependencies')}</dt><dd>{task.dependsOn.length ? task.dependsOn.map(dependency => state.tasks.find(item => item.id === dependency)?.code ?? dependency).join(', ') : t('taskUi.dash')}</dd></div>
            <div><dt className="text-muted-foreground">{t('taskUi.placement')}</dt><dd>{t(`taskUi.placements.${task.placement}`)}</dd></div>
            <div><dt className="text-muted-foreground">{t('taskUi.sideEffect')}</dt><dd>{t(`taskUi.sideEffects.${task.sideEffect}`)}</dd></div>
            <div><dt className="text-muted-foreground">{t('taskUi.reviewPolicy')}</dt><dd>{t(`taskUi.reviewPolicies.${task.reviewPolicy}`)}</dd></div>
          </dl>
        </Card>}
        {confirm && <Card role="group" aria-label={t('taskUi.confirmation')} className="gap-3 border-border bg-muted/40 p-4 shadow-none"><p>{t(`taskUi.confirm.${confirm}`)}</p>
          <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="text-need" disabled={disabled} onClick={() => transition(confirm)}>{t(`taskUi.confirmActions.${confirm}`)}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>{t('taskUi.keep')}</Button></div>
        </Card>}
        {pending?.error && <ErrorNotice error={pending.error} />}
        {pending?.status === 'failed' && command && <Button type="button" variant="outline" size="sm" disabled={busy || state.session !== 'authenticated'} onClick={() => { void execute(command, true); }}>{t('errors.retry')}</Button>}
      </div>
    </TableCell></TableRow>}
  </>;
}
