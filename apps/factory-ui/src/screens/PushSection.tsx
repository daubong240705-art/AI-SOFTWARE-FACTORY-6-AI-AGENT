import { useEffect, useId, useRef, useState } from 'react';
import type { Task } from '@factory/contracts';
import type { Attempt, AttemptEvent } from '../api/client';
import { Button } from '../components/Button';
import { ErrorNotice } from '../components/ErrorNotice';
import { useT } from '../i18n';
import type { Store } from '../state/store';
import { Select } from '../components/Select';

export function workspaceBranch(events: AttemptEvent[]): string | null {
  for (const event of [...events].reverse()) {
    if (event.kind !== 'state' || !event.body || typeof event.body !== 'object' || Array.isArray(event.body)) continue;
    const body = event.body;
    if (('state' in body && body.state === 'workspace-ready') || ('type' in body && body.type === 'workspace-ready') || ('to' in body && body.to === 'workspace-ready')) {
      return 'branch' in body && typeof body.branch === 'string' && body.branch.startsWith('factory/') && body.branch.length <= 160 ? body.branch : null;
    }
  }
  return null;
}
export function PushSection({ store, task, attempt }: { store: Store; task: Task; attempt: Attempt | undefined }) {
  const t = useT(); const id = useId();
  const state = store.useStoreSelector(value => value);
  const [remote, setRemote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const inFlight = useRef(false);
  const branch = attempt ? workspaceBranch(state.details[task.id]?.events[attempt.id] ?? []) : null;
  const selected = state.remotes?.includes(remote) ? remote : state.remotes?.[0] ?? '';
  const effects = attempt ? state.details[task.id]?.effects[attempt.id] ?? [] : [];
  const latest = [...effects].filter(effect => effect.remote === selected).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const blocking = latest.some(effect => effect.state !== 'failed');
  const area = `push:${task.id}:${attempt?.id}`;
  const busy = !!state.loading[area];
  const effectsArea = `effects:${task.id}:${attempt?.id}`;
  const effectsReady = attempt && Object.hasOwn(state.details[task.id]?.effects ?? {}, attempt.id) && !state.loading[effectsArea] && !state.errors[effectsArea];
  useEffect(() => { void store.loadRemotes(); }, [store]);
  useEffect(() => { setConfirm(false); if (attempt && branch && task.state === 'done' && state.remotes?.length) void store.loadEffects(task.id, attempt.id); }, [store, task.id, task.state, attempt?.id, branch, selected, state.remotes]);
  async function execute(effectId?: string) {
    if (!attempt || inFlight.current || busy || state.session !== 'authenticated') return;
    inFlight.current = true;
    try { await (effectId ? store.reconcile(task.id, attempt.id, effectId) : store.push(task.id, attempt.id, selected)); setConfirm(false); }
    finally { inFlight.current = false; }
  }
  if (!state.remotes?.length || task.state !== 'done' || !attempt || !branch) return null;
  return <section className="stack push-section"><h3>{t('inboxUi.push')}</h3>
    <div className="field"><label htmlFor={id}>{t('inboxUi.remote')}</label><Select id={id} value={selected} disabled={busy || confirm} onValueChange={setRemote} options={state.remotes.map(name => ({ value: name, label: name }))} /></div>
    <p className="plain-text">{branch}</p>
    {!blocking && !confirm && <Button disabled={busy || !effectsReady} onClick={() => setConfirm(true)}>{t('inboxUi.push')}</Button>}
    {confirm && <div role="group" aria-label={t('taskUi.confirmation')} className="confirmation-row"><p>{t('inboxUi.pushConfirm').replace('{branch}', branch).replace('{name}', selected)}</p><Button disabled={busy} onClick={() => { void execute(); }}>{t('workUi.confirm')}</Button><Button disabled={busy} onClick={() => setConfirm(false)}>{t('workUi.back')}</Button></div>}
    {state.errors[area] && <ErrorNotice error={state.errors[area]!} />}
    {state.errors[`effects:${task.id}:${attempt.id}`] && <><ErrorNotice error={state.errors[`effects:${task.id}:${attempt.id}`]!} /><Button onClick={() => { void store.loadEffects(task.id, attempt.id); }}>{t('errors.retry')}</Button></>}
    <ul className="task-list stack" aria-live="polite">{latest.map(effect => <li key={effect.id}><p>{effect.remote} · {t(`inboxUi.effects.${effect.state}`)}{effect.error ? `: ${t(`inboxUi.effectErrors.${effect.error}`)}` : ''}</p>{effect.state === 'unknown' && <><p>{t('inboxUi.reconcileHelp')}</p><Button disabled={busy} onClick={() => { void execute(effect.id); }}>{t('inboxUi.reconcile')}</Button></>}</li>)}</ul>
  </section>;
}
