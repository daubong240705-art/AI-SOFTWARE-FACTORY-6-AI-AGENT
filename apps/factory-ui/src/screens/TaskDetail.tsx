import { TaskContext } from './TaskContext';
import { DockedPane } from './DockedPane';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { deriveDisplayStatus, isLiveAttempt, type Command, type Task } from '@factory/contracts';
import { runsCancel, tasksRelease, tasksRetry } from '../api/commands';
import type { Attempt, AttemptPatch } from '../api/client';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { ErrorNotice } from '../components/ErrorNotice';
import { i18n, plural, useT } from '../i18n';
import { evidenceView } from '../state/attemptView';
import type { Store, TaskDetailState } from '../state/store';
import { DiffView } from './DiffView';
import { ProgressTimeline } from './ProgressTimeline';
import { DecisionDialog, pendingApproval } from './DecisionDialog';
import { PushSection } from './PushSection';

const tabs = ['request', 'progress', 'results', 'actions'] as const;
type Action = 'start' | 'stop' | 'retry';
const stoppable = new Set(['queued', 'leased', 'preparing', 'running', 'waiting-input']);
export function TaskDetail({ store, taskId, onClose, initialTab = 'request', inline = false, fallbackFocus }: { store: Store; taskId: string; onClose: () => void; initialTab?: typeof tabs[number]; inline?: boolean; fallbackFocus?: () => HTMLElement | null }) {
  const t = useT();
  const state = store.useStoreSelector(value => value);
  const [active, setActive] = useState<number>(tabs.indexOf(initialTab));
  const [decision, setDecision] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const id = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => { void store.openTask(taskId); return () => store.closeTask(taskId); }, [store, taskId]);
  const task = state.tasks.find(item => item.id === taskId);
  const detail = state.details[taskId];
  const attempt = detail?.attempts.find(item => item.id === selected) ?? detail?.attempts[0];
  const live = detail?.attempts.find(item => isLiveAttempt(item.state)) ?? state.liveAttempts[taskId];
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); setActive(next); buttons.current[next]?.focus();
  }
  if (!task || state.session !== 'authenticated') return null;
  const display = deriveDisplayStatus({ ...task, liveAttempt: live && isLiveAttempt(live.state) ? live.state : null });
  const date = (value: string | null) => value ? new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : t('taskUi.dash');
  if (decision) return <DecisionDialog store={store} approvalId={decision} onClose={() => setDecision(null)} />;
  const content = <>
    <div className="task-detail stack">
      <header className="stack"><Button onClick={onClose}><span className={inline ? 'project-pane-close' : undefined}>{t('workUi.close')}</span>{inline && <><span className="project-pane-back">{t('projectUi.backToBoard')}</span> <kbd>Esc</kbd></>}</Button><span className="task-code">{task.code}</span><h2 id={`${id}-title`}>{task.title}</h2>
        <div className="task-meta"><Badge className={`status-${display.status}`}>{t(`taskUi.display.${display.status}`)}</Badge><span>{t('workUi.lifecycle')}: {t(`taskUi.lifecycle.${task.state}`)}</span><span>{t('taskUi.owner')}: {state.team?.seats.find(seat => seat.id === task.ownerSeatId)?.name ?? t('taskUi.dash')}</span></div>
      </header>
      <div className="project-tabs" role="tablist" aria-label={t('workUi.sections')}>{tabs.map((tab, index) => <button type="button" key={tab} ref={node => { buttons.current[index] = node; }} role="tab" id={`${id}-${tab}`} aria-controls={`${id}-panel`} aria-selected={active === index} tabIndex={active === index ? 0 : -1} onClick={() => setActive(index)} onKeyDown={event => navigate(event, index)}>{t(inline && tab === 'request' ? 'projectUi.context' : `workUi.${tab}`)}</button>)}</div>
      {detail?.loading && <p role="status">{t('viewStates.loading')}</p>}
      {detail?.error && <><ErrorNotice error={detail.error} /><Button onClick={() => { void store.loadTaskDetail(taskId); }}>{t('errors.retry')}</Button></>}
      <div className="stack" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tabs[active]}`} tabIndex={0}>
        {active === 0 && <>
          <TaskContext store={store} taskId={taskId} />
          <h3>{t('taskUi.goal')}</h3><p className="plain-text">{task.goal}</p><p className="plain-text">{task.brief}</p>
          <h3>{t('taskUi.acceptance')}</h3><ul>{task.acceptance.map((item, index) => <li key={index}>{item}</li>)}</ul>
          <h3>{t('taskUi.dependencies')}</h3><ul>{task.dependsOn.map(dependency => <li key={dependency}>{state.tasks.find(item => item.id === dependency)?.code ?? dependency}</li>)}</ul>
          <h3>{t('workUi.holds')}</h3><ul>{task.holds.map((hold, index) => <li key={index}><Badge>{t(`workUi.holdKinds.${hold.kind}`)}</Badge> {hold.reason}</li>)}</ul>
          <dl className="engagement">{(['placement', 'sideEffect', 'reviewPolicy'] as const).map(policy => <div key={policy}><dt>{t(`taskUi.${policy}`)}</dt><dd>{t(`taskUi.${policy === 'placement' ? 'placements' : policy === 'sideEffect' ? 'sideEffects' : 'reviewPolicies'}.${task[policy]}`)}</dd></div>)}</dl>
        </>}
        {active === 1 && <>
          <h3>{t('workUi.attempts')}</h3>
          {!detail?.attempts.length && <p>{t('workUi.noAttempts')}</p>}
          <ul className="task-list stack">{detail?.attempts.map(item => <li key={item.id}><Button aria-pressed={attempt?.id === item.id} onClick={() => { setSelected(item.id); void store.loadAttemptEvents(taskId, item.id); }}>
            {t('workUi.epoch')} {new Intl.NumberFormat(i18n.locale).format(item.epoch)} · {t(`workUi.states.${item.state}`)} · {item.runtime} · {item.seatName ?? t('taskUi.dash')}
          </Button><p>{t('workUi.started')}: {date(item.startedAt)} · {t('workUi.ended')}: {date(item.endedAt)}</p></li>)}</ul>
          {attempt && isLiveAttempt(attempt.state) && <Badge className="live-attempt">{t('workUi.live')}</Badge>}
          {attempt && state.errors[`attempt-events:${taskId}:${attempt.id}`] && <><ErrorNotice error={state.errors[`attempt-events:${taskId}:${attempt.id}`]!} /><Button onClick={() => { void store.loadAttemptEvents(taskId, attempt.id); }}>{t('errors.retry')}</Button></>}
          <ProgressTimeline events={attempt ? detail?.events[attempt.id] ?? [] : []} />
        </>}
        {(active === 2 || active === 3) && detail && <>
          {detail.approvals.filter(item => pendingApproval(item) && (item.kind === 'review' || item.kind === 'question')).map(item => <section className="card stack" key={item.id}><h3>{t(item.kind === 'review' ? 'inboxUi.review' : 'inboxUi.question')}</h3><p>{item.subject}</p><Button onClick={() => setDecision(item.id)}>{t(item.kind === 'review' ? 'inboxUi.reviewResult' : 'inboxUi.answerQuestion')}</Button></section>)}
          <section className="stack"><h3>{t('inboxUi.history')}</h3>{!detail.approvals.length && <p>{t('inboxUi.noHistory')}</p>}<ul className="task-list stack">{[...detail.approvals].sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt)).map(item => <li key={item.id} className="plain-text"><strong>{item.subject}</strong> · {t(`inboxUi.states.${item.state}`)}{item.outcome && <><p>{item.options.find(option => option.id === item.outcome?.optionId)?.label}</p><p>{item.outcome.comment}</p></>}</li>)}</ul></section>
        </>}
        {active === 2 && detail && <Results store={store} task={task} detail={detail} attempt={attempt} />}
        {(active === 2 || active === 3) && <PushSection store={store} task={task} attempt={attempt} />}
        <div hidden={active !== 3}><TaskActions store={store} task={task} attempt={live} /></div>
      </div>
    </div>
  </>;
  return inline ? <DockedPane label={t('projectUi.taskDetails')} className="project-task-pane" onClose={onClose} {...(fallbackFocus ? { fallbackFocus } : {})}>{content}</DockedPane>
    : <Dialog labelledBy={`${id}-title`} onClose={onClose} className="task-detail-backdrop">{content}</Dialog>;
}

export function Results({ store, task, detail, attempt }: { store: Store; task: Task; detail: TaskDetailState; attempt: Attempt | undefined }) {
  const t = useT();
  const state = store.useStoreSelector(value => value);
  const [patchId, setPatchId] = useState<string | null>(null);
  const [textKey, setTextKey] = useState<string | null>(null);
  const selectedAttempt = detail.attempts.find(item => item.id === patchId) ?? attempt;
  const patchLoaded = selectedAttempt ? Object.hasOwn(detail.patches, selectedAttempt.id) : false;
  useEffect(() => { if (selectedAttempt && !patchLoaded) void store.loadPatch(task.id, selectedAttempt.id); }, [store, task.id, selectedAttempt?.id, patchLoaded]);
  const events = selectedAttempt ? detail.events[selectedAttempt.id] ?? [] : [];
  const evidence = evidenceView([...events].reverse().find(event => event.kind === 'evidence' && evidenceView(event.body).totals !== null)?.body);
  const patch = selectedAttempt ? detail.patches[selectedAttempt.id] : undefined;
  const patchError = selectedAttempt ? state.errors[`patch:${selectedAttempt.id}`] : undefined;
  const textError = textKey ? state.errors[`content:${textKey}`] : undefined;
  const number = (value: number) => new Intl.NumberFormat(i18n.locale).format(value);
  return <>
    {!detail.artifacts.length && <p>{t('workUi.noResults')}</p>}
    <ul className="task-list stack">{detail.artifacts.map(artifact => <li key={artifact.artifactId}><h3>{artifact.title}</h3><ul>{artifact.versions.map(version => <li key={version.version} className="stack">
      <span>{t('workUi.version')} {number(version.version)} <Badge>{t(`workUi.statuses.${version.status}`)}</Badge></span><p>{version.abstractL0}</p>
      <time dateTime={version.createdAt}>{new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(version.createdAt))}</time>
      {artifact.kind === 'code-ref' ? <Button disabled={!version.producedByAttemptId} onClick={() => { setPatchId(version.producedByAttemptId); }}>{t('workUi.viewPatch')}</Button>
        : /^text\/(plain|markdown)(?:;|$)/i.test(version.mediaType) && <Button disabled={!!state.loading[`content:${artifact.artifactId}:${version.version}`]} onClick={() => { setTextKey(`${artifact.artifactId}:${version.version}`); void store.loadArtifactContent(task.id, artifact.artifactId, version.version); }}>{t('workUi.viewText')}</Button>}
    </li>)}</ul></li>)}</ul>
    {textError && <ErrorNotice error={textError} />}
    {textKey && state.artifactContents[textKey] && <pre className="plain-text artifact-text">{state.artifactContents[textKey].text}</pre>}
    {evidence.totals && <section className="stack"><h3>{t('workUi.evidence')}</h3><p>{(['files', 'additions', 'deletions'] as const).map(key => `${number(evidence.totals![key])} ${plural(t, i18n.locale, evidence.totals![key], `workUi.${key}`)}`).join(' · ')}</p><ul>{evidence.files.map((file, index) => <li key={index}>{file.status} {file.path}</li>)}</ul></section>}
    {patchError && <><ErrorNotice error={patchError} /><Button onClick={() => { if (selectedAttempt) void store.loadPatch(task.id, selectedAttempt.id); }}>{t('errors.retry')}</Button></>}
    {patch === null && <p>{t('workUi.noPatch')}</p>}
    {patch && selectedAttempt && <PatchResult key={`${selectedAttempt.id}:${patch.sha256}`} task={task} attempt={selectedAttempt} patch={patch} />}
  </>;
}
function PatchResult({ task, attempt, patch }: { task: Task; attempt: Attempt; patch: AttemptPatch }) {
  const t = useT();
  const [message, setMessage] = useState<'copied' | 'copyFailed' | 'downloadFailed' | null>(null);
  async function copy() {
    try { if (!navigator.clipboard?.writeText) throw new Error(); await navigator.clipboard.writeText(patch.patch); setMessage('copied'); }
    catch { setMessage('copyFailed'); }
  }
  function download() {
    let url: string | undefined;
    const link = document.createElement('a');
    try {
      url = URL.createObjectURL(new Blob([patch.patch], { type: 'text/x-patch;charset=utf-8' }));
      link.href = url; link.download = `${task.code}-e${attempt.epoch}.patch`; document.body.append(link); link.click();
    } catch { setMessage('downloadFailed'); }
    finally { link.remove(); if (url) URL.revokeObjectURL(url); }
  }
  return <><div className="task-actions"><Button onClick={() => { void copy(); }}>{t('workUi.copy')}</Button><Button onClick={download}>{t('workUi.download')}</Button></div>
    {message && <p role="status">{t(`workUi.${message}`)}</p>}
    {message && message !== 'copied' && <pre className="plain-text artifact-text">{patch.patch}</pre>}
    <DiffView patch={patch.patch} />
  </>;
}
export function TaskActions({ store, task, attempt, attention = false, onSuccess }: { store: Store; task: Task; attempt: Attempt | undefined; attention?: boolean; onSuccess?: () => void }) {
  const t = useT();
  const state = store.useStoreSelector(value => value);
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [command, setCommand] = useState<Command | null>(null);
  const [lastAction, setLastAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const pending = command ? state.pending[command.commandId] : undefined;
  const conflict = pending?.error?.code === 'conflict';
  const disabled = busy || !!command || state.session !== 'authenticated';
  const available: Action[] = [...(task.state === 'awaiting-go' ? ['start' as const] : []), ...(attempt && isLiveAttempt(attempt.state) && stoppable.has(attempt.state) ? ['stop' as const] : []), ...(task.state === 'failed' ? ['retry' as const] : [])];
  async function execute(created: Command, retry = false) {
    if (inFlight.current || state.session !== 'authenticated') return;
    inFlight.current = true; setBusy(true); setConfirm(null);
    try {
      const result = await (retry ? store.retry(created.commandId) : store.send(created));
      if (store.getState().session !== 'authenticated') return;
      if (result || store.getState().pending[created.commandId]?.error?.code === 'conflict') await Promise.all([store.loadTasks(), store.loadTaskDetail(task.id)]);
      if (result) { setCommand(null); await Promise.all([store.loadInbox(), store.loadGlobalInbox()]); onSuccess?.(); }
    } finally { inFlight.current = false; setBusy(false); }
  }
  function run(action: Action) {
    if (inFlight.current || state.session !== 'authenticated' || !available.includes(action) || (command && !conflict)) return;
    const projectId = state.selectedProjectId;
    if (!projectId) return;
    const args = { projectId, taskId: task.id, expectedRevision: task.revision };
    const created = action === 'start' ? tasksRelease(args) : action === 'retry' ? tasksRetry(args) : attempt ? runsCancel({ projectId, attemptId: attempt.id, expectedRevision: attempt.revision }) : null;
    if (!created) return;
    setCommand(created); setLastAction(action); void execute(created);
  }
  return <>
    <div className="task-actions">{available.map(action => <Button key={action} className={attention && action === 'start' ? 'attention-approve' : ''} data-attention-primary={attention && action === 'start' ? 'true' : undefined} disabled={disabled} onClick={() => setConfirm(action)}>{t(attention && action === 'start' ? 'attention.release' : `workUi.${action}`)}</Button>)}</div>
    {confirm && <div role="group" aria-label={t('taskUi.confirmation')} className="confirmation-row"><p>{t(`workUi.explanation.${confirm}`)}</p><Button disabled={busy || state.session !== 'authenticated'} onClick={() => run(confirm)}>{t('workUi.confirm')}</Button><Button disabled={busy} onClick={() => setConfirm(null)}>{t('workUi.back')}</Button></div>}
    {pending?.error && <ErrorNotice error={pending.error} />}
    {pending?.status === 'failed' && command && <Button disabled={busy || state.session !== 'authenticated' || (conflict && (!lastAction || !available.includes(lastAction)))} onClick={() => { if (conflict && lastAction) setConfirm(lastAction); else void execute(command, true); }}>{t(conflict ? 'workUi.fresh' : 'errors.retry')}</Button>}
  </>;
}
