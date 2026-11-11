import { useId, useRef, useState } from 'react';
import { TASK_TRANSITIONS, deriveDisplayStatus, type Command, type Task, type TaskState } from '@factory/contracts';
import { tasksTransition } from '../api/commands';
import { useT } from '../i18n';
import type { Store } from '../state/store';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ErrorNotice } from '../components/ErrorNotice';
const supported: readonly TaskState[] = ['proposed', 'accepted', 'declined', 'cancelled'];

export function TaskRow({ store, projectId, task }: { store: Store; projectId: string; task: Task }) {
  const t = useT();
  const state = store.useStoreSelector((value) => value);
  const [expanded, setExpanded] = useState(false);
  const [confirm, setConfirm] = useState<TaskState | null>(null);
  const [command, setCommand] = useState<Command | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const id = useId();
  const pending = command ? state.pending[command.commandId] : undefined;
  const display = deriveDisplayStatus({ state: task.state, holds: task.holds, disposition: task.disposition, reviewPolicy: task.reviewPolicy, liveAttempt: null });
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
  return <Card className={`task-row${task.state === 'proposed' ? ' task-proposed' : ''}`}>
    <div className="task-summary"><span className="task-code">{task.code}</span><h3>{task.title}</h3>{state.inbox.approvals.some(item => item.taskId === task.id) && <Badge>{t('inboxUi.needsDecision')}</Badge>}<Badge className={`status-${display.status}`}>{t(`taskUi.display.${display.status}`)}</Badge><span className="muted">{t(`taskUi.lifecycle.${task.state}`)}</span>
    </div>
    <div className="task-meta"><div className="capability-chips">{task.requiredCapabilities.map((capability) => <Badge key={capability}>{capability}</Badge>)}</div><span>{t('taskUi.owner')}: {owner?.name ?? t('taskUi.dash')}</span></div>
    <Button aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>{t('taskUi.details')} {task.code}</Button>
    {expanded && <div id={id} className="task-details stack">
      <h4>{t('taskUi.goal')}</h4><p className="plain-text">{task.goal}</p>
      <h4>{t('taskUi.acceptance')}</h4><ul>{task.acceptance.map((criterion, index) => <li key={index} className="plain-text">{criterion}</li>)}</ul>
      <dl className="engagement">
        <div><dt>{t('taskUi.dependencies')}</dt><dd>{task.dependsOn.length ? task.dependsOn.map((dependency) => state.tasks.find((item) => item.id === dependency)?.code ?? dependency).join(', ') : t('taskUi.dash')}</dd></div>
        <div><dt>{t('taskUi.placement')}</dt><dd>{t(`taskUi.placements.${task.placement}`)}</dd></div>
        <div><dt>{t('taskUi.sideEffect')}</dt><dd>{t(`taskUi.sideEffects.${task.sideEffect}`)}</dd></div>
        <div><dt>{t('taskUi.reviewPolicy')}</dt><dd>{t(`taskUi.reviewPolicies.${task.reviewPolicy}`)}</dd></div>
      </dl>
    </div>}
    <div className="task-actions">{actions.map((to) => <Button key={to} disabled={disabled} onClick={() => {
      if (to === 'declined' || to === 'cancelled') setConfirm(to); else transition(to);
    }}>{t(`taskUi.actions.${to}`)}</Button>)}</div>
    {confirm && <div className="confirmation-row" role="group" aria-label={t('taskUi.confirmation')}><p>{t(`taskUi.confirm.${confirm}`)}</p>
      <Button disabled={disabled} onClick={() => transition(confirm)}>{t(`taskUi.confirmActions.${confirm}`)}</Button>
      <Button disabled={busy} onClick={() => setConfirm(null)}>{t('taskUi.keep')}</Button>
    </div>}
    {pending?.error && <ErrorNotice error={pending.error} />}
    {pending?.status === 'failed' && command && <Button disabled={busy || state.session !== 'authenticated'} onClick={() => { void execute(command, true); }}>{t('errors.retry')}</Button>}
  </Card>;
}

