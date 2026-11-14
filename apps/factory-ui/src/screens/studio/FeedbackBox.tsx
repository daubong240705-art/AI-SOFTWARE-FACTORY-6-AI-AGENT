import { useEffect, useId, useRef, useState } from 'react';
import { workflowsCreate, workflowsStart } from '@/api/commands';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ErrorNotice } from '@/components/ErrorNotice';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { isFinished } from './presentation';

type Attempt = { create: ReturnType<typeof workflowsCreate>; created: boolean; start?: ReturnType<typeof workflowsStart> };
export function FeedbackBox({ store, projectId }: { store: Store; projectId: string }) {
  const t = useT(); const id = useId(); const state = store.useStoreSelector(value => value);
  const [mode, setMode] = useState<'fix' | 'improve'>('fix'); const [request, setRequest] = useState('');
  const [scope, setScope] = useState<'all' | 'ui' | 'rules'>('all');
  const [busy, setBusy] = useState(false); const [success, setSuccess] = useState(false); const [problem, setProblem] = useState('');
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const lock = useRef(false); const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const workflows = state.m5.workflows.filter(item => item.key === 'game-build');
  // Retrying our own request continues its create/start sequence, including a lost create receipt.
  const unfinished = workflows.some(item => !isFinished(item.state) && item.id !== attempt?.create.payload.instanceId);
  const finishedBuild = workflows.some(item => item.state === 'completed');
  const reason = state.session !== 'authenticated' ? 'auth.required' : state.errors.workflows ? 'studioUi.workflowError'
    : unfinished ? 'studioUi.feedbackBusy' : !finishedBuild ? 'studioUi.feedbackNoBuild' : '';
  const disabled = busy || !!reason;
  const command = attempt?.start ?? attempt?.create;
  const error = command ? state.pending[command.commandId]?.error : undefined;
  const current = () => mounted.current && store.getState().selectedProjectId === projectId && store.getState().session === 'authenticated';
  async function submit() {
    if (lock.current || disabled || !request.trim() || request.length > 500) return;
    lock.current = true; setBusy(true); setSuccess(false); setProblem('');
    const entry = attempt ?? { create: workflowsCreate({ projectId, instanceId: crypto.randomUUID(), definitionKey: 'game-build', packKey: 'web-games',
      params: { mode, request: request.trim(), touchRules: scope !== 'ui', touchUi: scope !== 'rules' } }), created: false };
    setAttempt(entry);
    try {
      if (!entry.created) {
        if (!await store.send(entry.create) || !current()) return;
        entry.created = true; setAttempt({ ...entry });
      }
      if (!entry.start) {
        await store.loadWorkflow(entry.create.payload.instanceId);
        if (!current()) return;
        const instance = store.getState().m5.workflowDetails[entry.create.payload.instanceId];
        if (instance?.revision === undefined || store.getState().errors[`workflow:${entry.create.payload.instanceId}`]) { setProblem('workflowGraph.revisionUnavailable'); return; }
        entry.start = workflowsStart({ projectId, instanceId: instance.id, expectedRevision: instance.revision });
        setAttempt({ ...entry });
      }
      if (!await store.send(entry.start) || !current()) return;
      setAttempt(null); setSuccess(true); setRequest('');
    } catch { if (current()) setProblem('studioUi.feedbackError'); }
    finally {
      await store.loadWorkflows();
      lock.current = false; if (current()) setBusy(false);
    }
  }
  return <Card className="gap-4 p-5" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`} className="text-lg font-semibold">{t('studioUi.feedback')}</h3>
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={disabled || !!attempt} className="space-y-4">
        <legend className="sr-only">{t('studioUi.feedbackType')}</legend>
        <div role="group" aria-label={t('studioUi.feedbackType')} className="flex flex-wrap gap-2">
          {(['fix', 'improve'] as const).map(kind => <Button key={kind} type="button" variant={mode === kind ? 'default' : 'outline'} aria-pressed={mode === kind} onClick={() => { setMode(kind); setSuccess(false); }}>{t(`studioUi.feedbackTypes.${kind}`)}</Button>)}
        </div>
        <div className="space-y-2"><label htmlFor={`${id}-request`} className="text-sm font-medium">{t('studioUi.feedbackPrompt')}</label>
          <Textarea id={`${id}-request`} required minLength={1} maxLength={500} rows={4} value={request} aria-describedby={`${id}-counter`} onChange={event => { setRequest(event.target.value); setSuccess(false); }} placeholder={t('studioUi.feedbackPlaceholder')} />
          <p id={`${id}-counter`} className="text-right text-xs text-muted-foreground">{t('studioUi.counter').replace('{count}', String(request.length))}</p>
        </div>
        <div className="flex flex-wrap gap-5 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={scope === 'ui'} onChange={event => setScope(event.target.checked ? 'ui' : 'all')} />{t('studioUi.uiOnly')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={scope === 'rules'} onChange={event => setScope(event.target.checked ? 'rules' : 'all')} />{t('studioUi.rulesOnly')}</label>
        </div>
      </fieldset>
      {reason && <p id={`${id}-reason`} className="text-sm text-muted-foreground">{t(reason)}</p>}
      <Button type="submit" disabled={disabled || !request.trim() || request.length > 500} aria-describedby={reason ? `${id}-reason` : undefined}>{t(busy ? 'studioUi.sendingFeedback' : attempt ? 'errors.retry' : 'studioUi.sendFeedback')}</Button>
      {success && <p role="status" className="text-sm text-ok">{t('studioUi.feedbackSent')}</p>}
      {error && <ErrorNotice error={error} />}{problem && <p role="alert" className="text-sm text-destructive">{t(problem)}</p>}
    </form>
  </Card>;
}
