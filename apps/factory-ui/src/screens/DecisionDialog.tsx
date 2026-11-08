import { useEffect, useId, useRef, useState } from 'react';
import type { Approval, Command } from '@factory/contracts';
import { approvalsDecide } from '../api/commands';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { ErrorNotice } from '../components/ErrorNotice';
import { i18n, useT } from '../i18n';
import type { Store } from '../state/store';
import { TaskDetail } from './TaskDetail';

export const pendingApproval = (approval: Approval) => approval.state === 'pending' || approval.state === 'requested';
export function DecisionDialog({ store, approvalId, onClose }: { store: Store; approvalId: string; onClose: () => void }) {
  const t = useT();
  const state = store.useStoreSelector(value => value);
  const id = useId();
  const [ready, setReady] = useState(false);
  const [optionId, setOptionId] = useState('');
  const [comment, setComment] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [changed, setChanged] = useState(false);
  const [command, setCommand] = useState<Command | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(false);
  const [, tick] = useState(0);
  const inFlight = useRef(false);
  const projectId = state.selectedProjectId;
  useEffect(() => { let current = true; setReady(false); void store.loadApproval(approvalId).then(() => { if (current) setReady(true); }); return () => { current = false; }; }, [store, approvalId, projectId]);
  const approval = ready && !state.errors[`approval:${approvalId}`] ? state.approvals[approvalId] : undefined;
  useEffect(() => {
    if (!approval || !pendingApproval(approval)) return;
    const delay = Date.parse(approval.expiresAt) - Date.now();
    if (delay <= 0) return;
    const handle = setTimeout(() => tick(value => value + 1), Math.min(delay + 1, 2_147_483_647));
    return () => clearTimeout(handle);
  }, [approval]);
  const task = state.tasks.find(item => item.id === approval?.taskId);
  const option = approval?.options.find(item => item.id === optionId);
  const pending = command ? state.pending[command.commandId] : undefined;
  const expired = approval && (approval.state === 'expired' || (pendingApproval(approval) && Date.parse(approval.expiresAt) <= Date.now()));
  const editable = approval && pendingApproval(approval) && !expired && approval.kind !== 'start-gate';
  const valid = !!option && !(approval?.kind === 'review' && optionId === 'request-changes' && !comment.trim());
  async function execute(retry = false) {
    if (inFlight.current || !editable || !valid || !projectId || state.session !== 'authenticated') return;
    if (Date.parse(approval.expiresAt) <= Date.now()) { tick(value => value + 1); return; }
    const created = retry && command ? command : approvalsDecide({ projectId, approvalId, expectedRevision: approval.revision, contextDigest: approval.context.digest, optionId, comment });
    inFlight.current = true; setBusy(true); setCommand(created);
    try {
      const result = await (retry ? store.retry(created.commandId) : store.send(created));
      if (store.getState().selectedProjectId !== projectId || store.getState().session !== 'authenticated') return;
      const conflict = store.getState().pending[created.commandId]?.error?.code === 'conflict';
      if (result || conflict) {
        setConfirm(false);
        await Promise.all([store.loadApproval(approvalId), store.loadInbox(), store.loadGlobalInbox(), store.loadTasks(), ...(approval.taskId ? [store.loadTaskDetail(approval.taskId)] : [])]);
        if (store.getState().selectedProjectId !== projectId || store.getState().session !== 'authenticated') return;
        if (result) { store.announceDecision(); onClose(); }
        else { setChanged(true); setOptionId(''); setComment(''); setCommand(null); }
      }
    } finally { inFlight.current = false; setBusy(false); }
  }
  if (state.session !== 'authenticated') return null;
  if (results && approval?.taskId) return <TaskDetail store={store} taskId={approval.taskId} initialTab="results" onClose={() => setResults(false)} />;
  return <Dialog labelledBy={`${id}-title`} onClose={() => { if (!inFlight.current) onClose(); }}>
    <Button disabled={busy} onClick={onClose}>{t('inboxUi.close')}</Button>
    <h2 id={`${id}-title`}>{approval?.subject ?? t('inboxUi.decision')}</h2>
    {(!ready || state.loading[`approval:${approvalId}`]) && <p role="status">{t('viewStates.loading')}</p>}
    {state.errors[`approval:${approvalId}`] && <><ErrorNotice error={state.errors[`approval:${approvalId}`]!} /><Button onClick={() => { void store.loadApproval(approvalId); }}>{t('errors.retry')}</Button></>}
    {changed && <p role="status">{t('inboxUi.changed')}</p>}
    {approval && <>
      <p className="plain-text">{approval.summary}</p><p className="plain-text">{approval.impactIfWaiting}</p>
      <p>{t('inboxUi.expires')}: <time dateTime={approval.expiresAt}>{new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(approval.expiresAt))}</time></p>
      {approval.kind === 'review' && approval.taskId && <Button disabled={busy} onClick={() => setResults(true)}>{t('inboxUi.openResults')}</Button>}
      {approval.kind === 'question' && task && <p>{task.code} · {task.title}</p>}
      {expired && <p role="status">{t('inboxUi.expired')}</p>}
      {!editable && !expired && <p>{t(`inboxUi.states.${approval.state}`)}</p>}
      {approval.outcome && <section className="plain-text stack"><h3>{t('inboxUi.outcome')}</h3><p>{approval.options.find(item => item.id === approval.outcome?.optionId)?.label}</p><p>{approval.outcome.comment}</p></section>}
      {editable && <>
        <fieldset disabled={busy || confirm || !!command}><legend>{t('inboxUi.options')}</legend><div role="radiogroup" aria-label={t('inboxUi.options')} className="stack">
          {approval.options.map(item => <label className="decision-option" key={item.id}><input type="radio" name={`${id}-option`} value={item.id} checked={optionId === item.id} onChange={() => setOptionId(item.id)} /><span>{item.label} {approval.recommendation === item.id && <strong>{t('inboxUi.recommended')}</strong>}<span className="plain-text consequence">{item.consequence}</span></span></label>)}
        </div></fieldset>
        <div className="field"><label htmlFor={`${id}-comment`}>{t('inboxUi.comment')}{approval.kind === 'review' && optionId === 'request-changes' ? ` (${t('inboxUi.required')})` : ''}</label>
          <textarea id={`${id}-comment`} rows={4} maxLength={32000} value={comment} required={approval.kind === 'review' && optionId === 'request-changes'} disabled={busy || confirm || !!command} onChange={event => setComment(event.target.value)} aria-describedby={`${id}-counter`} />
          <p id={`${id}-counter`}>{new Intl.NumberFormat(i18n.locale).format(comment.length)} / {new Intl.NumberFormat(i18n.locale).format(32000)} {t('inboxUi.characters')}</p>
        </div>
        {!confirm && !command && <Button variant="primary" disabled={!valid || busy} onClick={() => setConfirm(true)}>{t('inboxUi.decide')}</Button>}
        {confirm && option && <div role="group" aria-label={t('taskUi.confirmation')} className="confirmation-row"><p className="plain-text"><strong>{option.label}</strong><br />{option.consequence}</p><Button disabled={busy || !!command} onClick={() => { void execute(); }}>{t('workUi.confirm')}</Button><Button disabled={busy || !!command} onClick={() => setConfirm(false)}>{t('workUi.back')}</Button></div>}
        {pending?.error && <ErrorNotice error={pending.error} />}
        {pending?.status === 'failed' && <Button disabled={busy} onClick={() => { void execute(true); }}>{t('errors.retry')}</Button>}
      </>}
    </>}
  </Dialog>;
}
