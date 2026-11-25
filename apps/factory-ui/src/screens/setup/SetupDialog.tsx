import { useCallback, useEffect, useId, useReducer, useRef, useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { idSchema, setupProposalSchema, setupProposePayloadSchema, type SetupProposal } from '@factory/contracts';
import { ApiClientError, createApiClient } from '@/api/client';
import { setupCommand } from '@/api/commands';
import { Dialog } from '@/components/Dialog';
import { LoadingState } from '@/components/LoadingState';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/i18n';
import { useRead } from '../agents/shared';
import { openFlowRoute, agentHash } from '../shell/navigation';
import { baseUrl } from '../monitor/live';
import { formatNumber } from '../monitor/presentation';
import { ProposalIssues, ProposalReview } from './ProposalReview';

type Target = { mode: 'project' } | { mode: 'flow'; flowId?: string };
type ProposeCommand = ReturnType<typeof setupCommand<'setup.propose'>>;
const targets = new Map<string, Target>();
function rememberTarget(id: string, target: Target) {
  targets.set(id, target);
  try { sessionStorage.setItem(`factory.setup.target.${id}`, JSON.stringify(target)); } catch { /* Storage is optional. */ }
}
function readTarget(id: string): Target | undefined {
  if (targets.has(id)) return targets.get(id);
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(`factory.setup.target.${id}`) ?? 'null');
    if (stored && typeof stored === 'object' && 'mode' in stored) {
      if (stored.mode === 'project') return { mode: 'project' };
      if (stored.mode === 'flow') {
        const flowId = 'flowId' in stored ? idSchema.safeParse(stored.flowId) : null;
        return flowId ? flowId.success ? { mode: 'flow', flowId: flowId.data } : undefined : { mode: 'flow' };
      }
    }
  } catch { /* A historic proposal may not have a saved target. */ }
  return undefined;
}

export function SetupDialog({ projectId, target, close, onApplied }: { projectId: string; target: Target; close: () => void; onApplied?: () => void }) {
  const t = useT();
  const titleId = useId();
  const inputId = useId();
  const [api] = useState(() => createApiClient({ baseUrl }));
  const [request, setRequest] = useState('');
  const [id, setId] = useState<string | null>(null);
  const [edited, setEdited] = useState<SetupProposal | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(false);
  const inFlight = useRef(false);
  const retry = useRef<ProposeCommand | null>(null);
  const [epoch, refresh] = useReducer((value: number) => value + 1, 0);
  const readList = useCallback((signal: AbortSignal) => api.listSetupProposals(projectId, signal), [api, projectId]);
  const readDetail = useCallback((signal: AbortSignal) => api.getSetupProposal(projectId, id!, signal), [api, projectId, id]);
  const history = useRead(readList, epoch);
  const detail = useRead(id ? readDetail : null, epoch);
  const item = detail.data?.proposal ?? history.data?.proposals.find(entry => entry.id === id);
  const generating = item?.state === 'generating' || history.data?.proposals.some(entry => entry.state === 'generating');
  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(() => { if (!inFlight.current) refresh(); }, 2000);
    return () => clearInterval(timer);
  }, [generating]);

  function select(next: string | null) {
    setId(next); setEdited(null); setConfirmDiscard(false); setConfirmTarget(false); setError(null);
  }
  async function write(command: Parameters<typeof api.sendSetupCommand>[0], done: () => void) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try { await api.sendSetupCommand(command); done(); }
    catch (failure) {
      if (command.type === 'setup.propose' && failure instanceof ApiClientError && failure.kind === 'api' && failure.code !== 'outcome-unknown') retry.current = null;
      setError(failure);
    }
    finally { inFlight.current = false; setBusy(false); refresh(); }
  }
  function propose(text: string, scope: Target) {
    const payload = setupProposePayloadSchema.safeParse({ ...scope, request: text, proposalId: crypto.randomUUID() });
    if (!payload.success) { setInvalid(true); return; }
    const previous = retry.current;
    const command = previous && previous.payload.request === payload.data.request && previous.payload.mode === scope.mode &&
      (scope.mode === 'project' || previous.payload.mode === 'flow' && previous.payload.flowId === scope.flowId)
      ? previous : setupCommand('setup.propose', projectId, payload.data);
    setInvalid(false);
    retry.current = command;
    rememberTarget(command.payload.proposalId, scope);
    void write(command, () => { retry.current = null; select(command.payload.proposalId); });
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); propose(request, target); }
  const proposed = edited ?? item?.proposal;
  const valid = setupProposalSchema.safeParse(proposed);
  const conflict = error instanceof ApiClientError && error.code === 'conflict';
  const knownTarget = item && readTarget(item.id);
  const title = target.mode === 'project' ? 'projectTitle' : target.flowId ? 'editFlow' : 'newFlow';
  const locked = busy || detail.loading || !!detail.error;

  return <Dialog labelledBy={titleId} onClose={close} className="sm:max-w-4xl">
    <DialogHeader className="text-left"><DialogTitle id={titleId} className="font-display text-2xl">{t(`setupProposalUi.${title}`)}</DialogTitle><DialogDescription>{t(target.mode === 'flow' && target.flowId ? 'setupProposalUi.editFlowHelp' : 'setupProposalUi.help')}</DialogDescription></DialogHeader>
    {id === null ? <form noValidate className="space-y-2" onSubmit={submit}>
      <label className="font-medium" htmlFor={inputId}>{t('setupProposalUi.request')}</label>
      <Textarea id={inputId} data-testid="setup-request" required maxLength={4000} rows={5} disabled={busy} value={request} placeholder={t(target.mode === 'project' ? 'setupProposalUi.projectExample' : 'setupProposalUi.flowExample')} aria-describedby={`${inputId}-count${invalid ? ` ${inputId}-error` : ''}`} aria-invalid={invalid} onChange={event => { setRequest(event.target.value); setInvalid(false); }} />
      <p id={`${inputId}-count`} className="text-xs text-muted-foreground">{formatNumber(request.length)} / {formatNumber(4000)}</p>
      {invalid && <p id={`${inputId}-error`} role="alert" className="text-sm text-destructive">{t('setupProposalUi.required')}</p>}
      <Button type="submit" data-testid="setup-propose" disabled={busy}>{busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}{t('setupProposalUi.propose')}</Button>
    </form> : <section className="space-y-3">
      <Button type="button" variant="outline" size="sm" data-testid="setup-new-request" disabled={busy} onClick={() => select(null)}>{t('setupProposalUi.newRequest')}</Button>
      {detail.loading && !item && <LoadingState inline />}
      {item && <>
        <div className="space-y-2 rounded-lg border bg-muted/25 p-3 text-sm [overflow-wrap:anywhere]"><p className="whitespace-pre-wrap">{item.request}</p><p role="status" className="flex flex-wrap items-center gap-2">{item.state === 'generating' && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}{t(`setupProposalUi.state.${item.state}`)} · {t('setupProposalUi.tokens')}: {item.tokens === null ? t('setupProposalUi.unknown') : formatNumber(item.tokens)}</p></div>
        <ProposalIssues issues={item.issues} />
        {proposed && <ProposalReview key={item.id} api={api} projectId={projectId} proposal={proposed} issues={item.issues} editable={item.state === 'ready' && !busy} onEdit={setEdited} />}
        {item.applied && <section className="space-y-2"><h3 className="font-semibold">{t('setupProposalUi.appliedLinks')}</h3><ul className="space-y-1 text-sm">
          {item.applied.agentIds.map((agentId, index) => <li key={agentId}><a className="text-primary underline" data-testid={`setup-open-agent-${agentId}`} href={agentHash(projectId, agentId)} onClick={close}>{item.proposal?.agents[index]?.config.name ?? t('setupProposalUi.agents')}</a></li>)}
          {item.applied.flowIds.map((flowId, index) => <li key={flowId}><button type="button" className="text-primary underline" data-testid={`setup-open-draft-${flowId}`} onClick={() => { openFlowRoute(projectId, { kind: 'flows', id: flowId }); close(); }}>{item.proposal?.flows[index]?.title ?? t('setupProposalUi.workflows')} · Draft</button></li>)}
        </ul></section>}
        {confirmDiscard && <p role="status" className="text-sm">{t('setupProposalUi.discardHelp')}</p>}
        {confirmTarget && <p role="status" className="text-sm">{t(`setupProposalUi.regenerateTarget.${title}`)}</p>}
        <div className="flex flex-wrap gap-2">
          {item.state === 'ready' && <Button type="button" data-testid="setup-apply" disabled={locked || conflict || !valid.success || confirmDiscard} onClick={() => {
            if (valid.success) void write(setupCommand('setup.apply', projectId, { proposalId: item.id, expectedRevision: item.revision, edited: valid.data }), () => { setEdited(null); onApplied?.(); });
          }}>{t('setupProposalUi.apply')}</Button>}
          {['ready', 'invalid', 'failed', 'discarded'].includes(item.state) && <Button type="button" variant="outline" data-testid="setup-regenerate" disabled={locked || confirmDiscard} onClick={() => {
            if (knownTarget || confirmTarget) propose(item.request, knownTarget ?? target); else setConfirmTarget(true);
          }}>{t(confirmTarget ? 'setupProposalUi.confirmRegenerate' : 'setupProposalUi.regenerate')}</Button>}
          {item.state !== 'applied' && item.state !== 'discarded' && <Button type="button" variant={confirmDiscard ? 'destructive' : 'outline'} data-testid="setup-discard" disabled={locked} onClick={() => {
            if (confirmDiscard) void write(setupCommand('setup.discard', projectId, { proposalId: item.id, expectedRevision: item.revision }), () => { setConfirmDiscard(false); setEdited(null); });
            else { setConfirmDiscard(true); setConfirmTarget(false); }
          }}>{t(confirmDiscard ? 'setupProposalUi.confirmDiscard' : 'setupProposalUi.discard')}</Button>}
          {(confirmDiscard || confirmTarget) && <Button type="button" variant="ghost" data-testid="setup-cancel-confirm" onClick={() => { setConfirmDiscard(false); setConfirmTarget(false); }}>{t('actions.cancel')}</Button>}
          {busy && <LoaderCircle role="status" aria-label={t('viewStates.loading')} className="size-5 self-center animate-spin" />}
        </div>
      </>}
    </section>}
    {(error != null || history.error || detail.error) && <div className="flex flex-wrap items-center gap-2 text-sm" role="alert"><p className="text-destructive">{t(conflict ? 'setupProposalUi.conflict' : error instanceof ApiClientError && error.code === 'validation' ? 'setupProposalUi.validation' : error ? 'setupProposalUi.writeError' : 'setupProposalUi.readError')}</p><Button type="button" variant="outline" size="sm" data-testid="setup-reload" disabled={busy} onClick={() => { setError(null); refresh(); }}>{t('setupProposalUi.reload')}</Button></div>}
    <section className="space-y-2 border-t pt-3"><h3 className="font-semibold">{t('setupProposalUi.history')}</h3>
      {history.loading && !history.data && <LoadingState inline />}
      {history.data && (history.data.proposals.length ? <ul className="max-h-36 space-y-1 overflow-auto">{history.data.proposals.map(entry => <li key={entry.id}><button type="button" data-testid={`setup-history-${entry.id}`} aria-pressed={id === entry.id} disabled={busy} onClick={() => { if (id !== entry.id) select(entry.id); }} className="flex w-full flex-wrap justify-between gap-2 rounded border p-2 text-left text-sm hover:bg-muted aria-pressed:bg-muted"><span className="min-w-0 flex-1 truncate">{entry.request}</span><span className="shrink-0 text-muted-foreground">{t(`setupProposalUi.state.${entry.state}`)}</span></button></li>)}</ul> : <p className="text-sm text-muted-foreground">{t('setupProposalUi.noHistory')}</p>)}
    </section>
    <div className="flex justify-end"><Button type="button" variant="ghost" data-testid="setup-close" onClick={close}>{t('setupProposalUi.close')}</Button></div>
  </Dialog>;
}
