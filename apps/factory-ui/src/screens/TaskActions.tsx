import { useRef, useState } from 'react';
import { isLiveAttempt, type Command, type Task } from '@factory/contracts';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { runsCancel, tasksRelease, tasksRetry } from '../api/commands';
import type { Attempt } from '../api/client';
import { ErrorNotice } from '../components/ErrorNotice';
import { useT } from '../i18n';
import type { Store } from '../state/store';

type Action = 'start' | 'stop' | 'retry';
const stoppable = new Set(['queued', 'leased', 'preparing', 'running', 'waiting-input']);
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
    <div className="flex flex-wrap gap-2">{available.map(action => <Button type="button" key={action} variant={action === 'stop' ? 'outline' : 'default'} className={cn(action === 'stop' && 'text-need', attention && action === 'start' && 'bg-need text-need-foreground hover:bg-need/90')} data-attention-primary={attention && action === 'start' ? 'true' : undefined} disabled={disabled} onClick={() => setConfirm(action)}>{t(attention && action === 'start' ? 'attention.release' : `workUi.${action}`)}</Button>)}</div>
    {confirm && <Card role="group" aria-label={t('taskUi.confirmation')} className="mt-4 gap-3 border-border p-4 shadow-none"><p className="text-sm leading-relaxed text-muted-foreground">{t(`workUi.explanation.${confirm}`)}</p><div className="flex flex-wrap gap-2"><Button type="button" variant={confirm === 'stop' ? 'outline' : 'default'} className={confirm === 'stop' ? 'text-need' : ''} disabled={busy || state.session !== 'authenticated'} onClick={() => run(confirm)}>{t('workUi.confirm')}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setConfirm(null)}>{t('workUi.back')}</Button></div></Card>}
    {pending?.error && <ErrorNotice error={pending.error} />}
    {pending?.status === 'failed' && command && <Button type="button" variant="outline" disabled={busy || state.session !== 'authenticated' || (conflict && (!lastAction || !available.includes(lastAction)))} onClick={() => { if (conflict && lastAction) setConfirm(lastAction); else void execute(command, true); }}>{t(conflict ? 'workUi.fresh' : 'errors.retry')}</Button>}
  </>;
}

