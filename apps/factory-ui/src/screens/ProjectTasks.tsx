import { useId, useRef, useState, type FormEvent } from 'react';
import { TASK_TRANSITIONS, deriveDisplayStatus, type Command, type Task, type TaskState } from '@factory/contracts';
import { nextTaskCode, tasksCreate, tasksTransition } from '../api/commands';
import { i18n, plural, useT } from '../i18n';
import type { Store } from '../state/store';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ErrorNotice } from '../components/ErrorNotice';
import { Field } from '../components/Field';
import { Board } from './Board';
import { TaskDetail } from './TaskDetail';

const viewChoices = new WeakMap<Store, 'board' | 'list'>();

const supported: readonly TaskState[] = ['proposed', 'accepted', 'declined', 'cancelled'];
const filters = ['all', 'proposed', 'accepted', 'done', 'closed'] as const;
type Filter = typeof filters[number];

export function ProjectTasks({ store, projectId }: { store: Store; projectId: string }) {
  const t = useT();
  const state = store.useStoreSelector((value) => value);
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<'board' | 'list'>(() => viewChoices.get(store) ?? 'board');
  const [selected, setSelected] = useState<string | null>(null);
  const id = useId();
  const tasks = [...state.tasks].sort((a, b) => a.code.localeCompare(b.code)).filter((task) => filter === 'all' || (filter === 'closed'
    ? deriveDisplayStatus({ ...task, liveAttempt: null }).status === 'closed' : task.state === filter));
  const count = state.tasks.filter((task) => task.state === 'proposed').length;
  return <div className="project-tasks stack">
    <div className="tasks-heading"><h2>{t('tabs.tasks')}</h2><p>{new Intl.NumberFormat(i18n.locale).format(count)} {plural(t, i18n.locale, count, 'taskUi.awaiting')}</p></div>
    {state.errors.tasks && <ErrorNotice error={state.errors.tasks} />}
    <NewTask store={store} projectId={projectId} />
    <div className="task-actions" role="group" aria-label={t('workUi.views')}>{(['board', 'list'] as const).map(value => <Button key={value} aria-pressed={view === value} onClick={() => { setView(value); viewChoices.set(store, value); }}>{t(`workUi.${value}`)}</Button>)}</div>
    {view === 'board' ? <Board store={store} onOpen={setSelected} /> : <><div className="field task-filter"><label htmlFor={id}>{t('taskUi.filter')}</label><select id={id} value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
      {filters.map((value) => <option key={value} value={value}>{t(`taskUi.filters.${value}`)}</option>)}
    </select></div>
    {state.loading.tasks && !state.tasks.length ? <p role="status">{t('viewStates.loading')}</p> : tasks.length ? <ul className="task-list stack">{tasks.map((task) => <li key={task.id}><TaskRow store={store} projectId={projectId} task={task} /></li>)}</ul>
      : <Card><p>{t(state.tasks.length ? 'taskUi.noMatches' : 'tasks.empty')}</p></Card>}</>}
    {selected && <TaskDetail key={selected} store={store} taskId={selected} onClose={() => setSelected(null)} />}
  </div>;
}

function TaskRow({ store, projectId, task }: { store: Store; projectId: string; task: Task }) {
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
    <div className="task-summary"><span className="task-code">{task.code}</span><h3>{task.title}</h3><Badge className={`status-${display.status}`}>{t(`taskUi.display.${display.status}`)}</Badge><span className="muted">{t(`taskUi.lifecycle.${task.state}`)}</span>
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

type FormErrors = { title?: boolean; goal?: boolean; acceptance?: boolean };
function NewTask({ store, projectId }: { store: Store; projectId: string }) {
  const t = useT();
  const state = store.useStoreSelector((value) => value);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [acceptance, setAcceptance] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [command, setCommand] = useState<Command | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const pending = command ? state.pending[command.commandId] : undefined;
  const conflict = pending?.error?.code === 'conflict';
  const code = nextTaskCode(state.tasks);
  async function execute(created: Command, retry = false) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const result = await (retry ? store.retry(created.commandId) : store.send(created));
      if (result && store.getState().session === 'authenticated') {
        await store.loadTasks(); setTitle(''); setGoal(''); setAcceptance(''); setCommand(null); setErrors({});
      } else if (store.getState().pending[created.commandId]?.error?.code === 'conflict') await store.loadTasks();
    } finally { inFlight.current = false; setBusy(false); }
  }
  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (inFlight.current || state.session !== 'authenticated' || (command && !conflict)) return;
    const criteria = acceptance.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const invalid: FormErrors = {};
    if (!title.trim() || title.trim().length > 160) invalid.title = true;
    if (!goal.trim() || goal.trim().length > 500) invalid.goal = true;
    if (!criteria.length || criteria.length > 30 || criteria.some((line) => line.length > 500)) invalid.acceptance = true;
    setErrors(invalid);
    if (Object.keys(invalid).length) return;
    const created = tasksCreate({ projectId, code: nextTaskCode(store.getState().tasks), title: title.trim(), goal: goal.trim(), acceptance: criteria });
    setCommand(created); void execute(created);
  }
  return <Card>
    <Button aria-expanded={open} aria-controls={`${id}-form`} onClick={() => setOpen(!open)}>{t('taskUi.new')}</Button>
    {open && <form id={`${id}-form`} className="stack" onSubmit={submit} noValidate>
      <p>{t('taskUi.code')}: {code}</p>
      <Field label={t('taskUi.title')} value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} error={errors.title ? t('taskUi.validation.title') : undefined} />
      <div className="field"><label htmlFor={`${id}-goal`}>{t('taskUi.goal')}</label><textarea id={`${id}-goal`} rows={3} value={goal} disabled={busy} onChange={(event) => setGoal(event.target.value)} aria-invalid={errors.goal || undefined} aria-describedby={errors.goal ? `${id}-goal-error` : undefined} />
        {errors.goal && <p className="field-error" id={`${id}-goal-error`}>{t('taskUi.validation.goal')}</p>}
      </div>
      <div className="field"><label htmlFor={`${id}-acceptance`}>{t('taskUi.acceptance')}</label><textarea id={`${id}-acceptance`} rows={4} value={acceptance} disabled={busy} onChange={(event) => setAcceptance(event.target.value)} aria-invalid={errors.acceptance || undefined} aria-describedby={`${id}-help${errors.acceptance ? ` ${id}-acceptance-error` : ''}`} />
        <p className="muted" id={`${id}-help`}>{t('taskUi.acceptanceHelp')}</p>
        {errors.acceptance && <p className="field-error" id={`${id}-acceptance-error`}>{t('taskUi.validation.acceptance')}</p>}
      </div>
      {pending?.error && <ErrorNotice error={pending.error} />}
      {pending?.status === 'failed' && command ? <Button disabled={busy || state.session !== 'authenticated'} onClick={() => { if (conflict) submit(); else void execute(command, true); }}>{t(conflict ? 'taskUi.retryNew' : 'errors.retry')}</Button>
        : <Button variant="primary" type="submit" disabled={busy || !!command || state.session !== 'authenticated'}>{t('taskUi.create')}</Button>}
    </form>}
  </Card>;
}
