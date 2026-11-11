import { useEffect, useId, useRef, useState } from 'react';
import type { Approval, Command } from '@factory/contracts';
import { approvalsDecide } from '../api/commands';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog } from '../components/Dialog';
import { ErrorNotice } from '../components/ErrorNotice';
import { i18n, useT } from '../i18n';
import type { Store } from '../state/store';
import { TaskDetail } from './TaskDetail';
import { ReviewResult } from './attention/ReviewResult';
import { DecisionOptions } from './attention/DecisionOptions';
import { DecisionActions } from './attention/DecisionActions';
import { AgentSummary, Facts, Fold } from './attention/ReviewShared';
import { attentionTitle, readableText } from './attention/presentation';

export const pendingApproval = (approval: Approval) => approval.state === 'pending' || approval.state === 'requested';
export function DecisionDialog({ store, approvalId, onClose }: { store: Store; approvalId: string; onClose: () => void }) {
  return <DecisionPanel store={store} approvalId={approvalId} onClose={onClose} />;
}
export function DecisionPanel({ store, approvalId, onClose, inline = false, onSuccess }: { store: Store; approvalId: string; onClose: () => void; inline?: boolean; onSuccess?: () => void }) {
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
  const commentInput = useRef<HTMLTextAreaElement>(null);
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
        if (result) { store.announceDecision(); onSuccess?.(); onClose(); }
        else { setChanged(true); setOptionId(''); setComment(''); setCommand(null); }
      }
    } finally { inFlight.current = false; setBusy(false); }
  }
  if (state.session !== 'authenticated') return null;
  if (results && approval?.taskId) return <TaskDetail store={store} taskId={approval.taskId} initialTab="results" onClose={() => setResults(false)} />;
  const review = inline && approval?.kind === 'review';
  const content = <>
    <header className="p-6">
      {!inline && <Button variant="ghost" className="mb-3" disabled={busy} onClick={onClose}>{t('inboxUi.close')}</Button>}
      {task && <p className="mb-1 font-mono text-xs text-muted-foreground">{task.code} · {state.projects.find(project => project.id === projectId)?.name ?? t('overview.project')}</p>}
      <h2 id={`${id}-title`} className="font-display text-2xl leading-tight font-semibold tracking-tight">{approval ? review && task ? attentionTitle(task.title) : attentionTitle(approval.subject) : t('inboxUi.decision')}</h2>
      {approval && <AgentSummary key={approval.id} text={approval.summary} />}
    </header>
    {(!ready || state.loading[`approval:${approvalId}`]) && <div role="status" className="space-y-3 px-6 pb-6"><span className="sr-only">{t('viewStates.loading')}</span><Skeleton className="h-6 w-1/2" /><Skeleton className="h-48 w-full" /></div>}
    {state.errors[`approval:${approvalId}`] && <div className="px-6 pb-6"><ErrorNotice error={state.errors[`approval:${approvalId}`]!} /><Button variant="outline" onClick={() => { void store.loadApproval(approvalId); }}>{t('errors.retry')}</Button></div>}
    {changed && <p role="status" className="px-6 pb-4 text-sm text-muted-foreground">{t('inboxUi.changed')}</p>}
    {approval && <>
      {review && approval.taskId && <ReviewResult store={store} taskId={approval.taskId} approval={approval} />}
      <div className="space-y-5 px-6 pb-6">
        {!inline && approval.kind === 'review' && approval.taskId && <Button variant="outline" disabled={busy} onClick={() => setResults(true)}>{t('inboxUi.openResults')}</Button>}
        {expired && <p role="status" className="text-sm text-muted-foreground">{t('inboxUi.expired')}</p>}
        {!editable && !expired && <p className="text-sm text-muted-foreground">{t(`inboxUi.states.${approval.state}`)}</p>}
        {approval.outcome && <Card className="gap-2 border-border p-4 shadow-none"><h3 className="text-sm font-semibold">{t('inboxUi.outcome')}</h3><p className="text-sm">{readableText(approval.options.find(item => item.id === approval.outcome?.optionId)?.label ?? '')}</p><p className="text-sm text-muted-foreground">{readableText(approval.outcome.comment)}</p></Card>}
        {editable && <>
          {!review && <DecisionOptions approval={approval} id={id} value={optionId} onChange={setOptionId} disabled={busy || confirm || !!command} />}
          <div className="space-y-2"><Label htmlFor={`${id}-comment`}>{t('reviewUi.note')}{approval.kind === 'review' && optionId === 'request-changes' ? ` (${t('inboxUi.required')})` : ''}</Label>
            <Textarea ref={commentInput} id={`${id}-comment`} rows={3} maxLength={32000} value={comment} required={approval.kind === 'review' && optionId === 'request-changes'} disabled={busy || confirm || !!command} onChange={event => setComment(event.target.value)} aria-describedby={`${id}-counter`} className="min-h-24 resize-y border-border bg-card" />
            <p id={`${id}-counter`} className="text-right text-xs text-muted-foreground">{new Intl.NumberFormat(i18n.locale).format(comment.length)} / {new Intl.NumberFormat(i18n.locale).format(32000)} {t('inboxUi.characters')}</p>
          </div>
        </>}
        {!review && <>
          <p className="text-xs leading-relaxed text-muted-foreground">{t('reviewUi.waiting').replace('{impact}', readableText(approval.impactIfWaiting))}</p>
          <Fold title={t('attention.technicalDetails')}><Facts mono rows={[[t('attention.identifier'), approval.id], [t('attention.digest'), approval.context.digest], [t('reviewUi.recordNumber'), String(approval.revision)], [t('inboxUi.expires'), new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(approval.expiresAt))]]} /></Fold>
        </>}
      </div>
      {editable && <DecisionActions approval={approval} inline={inline} confirm={confirm} command={!!command} busy={busy} valid={valid} optionId={optionId} error={pending?.error} failed={pending?.status === 'failed'} onPrimary={() => {
        if (review) { const accept = approval.options.find(item => item.id === 'accept' || item.id === 'approve'); if (!accept) return; setOptionId(accept.id); }
        else if (!valid) return;
        setConfirm(true);
      }} onChanges={() => { setOptionId('request-changes'); commentInput.current?.focus(); }} onConfirmChanges={() => setConfirm(true)} onExecute={() => { void execute(); }} onBack={() => setConfirm(false)} onRetry={() => { void execute(true); }} />}
    </>}
  </>;
  return inline ? <section className="flex min-h-full flex-col" aria-labelledby={`${id}-title`}>{content}</section> : <Dialog labelledBy={`${id}-title`} onClose={() => { if (!inFlight.current) onClose(); }}>{content}</Dialog>;
}
