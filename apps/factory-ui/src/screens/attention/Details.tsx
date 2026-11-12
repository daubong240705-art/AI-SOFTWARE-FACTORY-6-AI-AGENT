import { useId, useRef, useState } from 'react';
import type { Command } from '@factory/contracts';
import { workflowsDecidePatch } from '../../api/commands';
import { Button } from '../../components/Button';
import { ErrorNotice } from '../../components/ErrorNotice';
import { useT } from '../../i18n';
import type { Store } from '../../state/store';
import type { AttentionItem } from '../shell/attention';
import { TaskActions } from '../TaskDetail';
import { ActionHints } from './ActionHints';
export { IntegrationConflictPanel } from './IntegrationConflictPanel';

export function GatePanel({ store, row, taskId, onSuccess }: { store: Store; row: AttentionItem; taskId: string; onSuccess: () => void }) {
  const t = useT(); const state = store.useStoreSelector(value => value); const task = state.tasks.find(item => item.id === taskId);
  return <div className="attention-panel stack"><h2>{row.title}</h2>{task ? <><p>{task.code} · {task.title}</p><p className="plain-text">{task.goal}</p><ul>{task.acceptance.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul>
    <footer className="attention-actions"><TaskActions store={store} task={task} attempt={undefined} attention onSuccess={onSuccess} /><ActionHints /></footer></> : <><p>{t('attention.taskUnavailable')}</p><Button onClick={() => { void store.loadTasks(); }}>{t('errors.retry')}</Button></>}</div>;
}
export function PatchPanel({ store, row, onSuccess }: { store: Store; row: AttentionItem; onSuccess: () => void }) {
  const t = useT(); const id = useId(); const state = store.useStoreSelector(value => value);
  const patch = state.globalInbox.patches?.find(item => `patch:${item.id}` === row.key);
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null);
  const [command, setCommand] = useState<Command | null>(null); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const error = command ? state.pending[command.commandId]?.error : undefined;
  async function execute(retry = false) {
    if (lock.current || !patch || !confirm || store.getState().selectedProjectId !== row.projectId || store.getState().session !== 'authenticated') return;
    const created = retry && command ? command : workflowsDecidePatch({ projectId: row.projectId, patchId: patch.id, decision: confirm });
    lock.current = true; setBusy(true); setCommand(created);
    try {
      const result = await (retry ? store.retry(created.commandId) : store.send(created));
      if (store.getState().selectedProjectId !== row.projectId || store.getState().session !== 'authenticated') return;
      if (result || store.getState().pending[created.commandId]?.error?.code === 'conflict') await Promise.all([store.loadGlobalInbox(), store.loadInbox()]);
      if (result) { store.announceDecision(); onSuccess(); }
      else if (store.getState().pending[created.commandId]?.error?.code === 'conflict') { setCommand(null); setConfirm(null); }
    } finally { lock.current = false; setBusy(false); }
  }
  return <div className="attention-panel stack" aria-labelledby={id}><h2 id={id}>{t('attention.kinds.plan-patch')}</h2>{patch && <><h3>{patch.instanceTitle}</h3><p className="plain-text">{patch.reason}</p><ul className="stack">{patch.ops.map((op, index) => <li key={index}>{op}</li>)}</ul>
    <details><summary>{t('attention.technicalDetails')}</summary><dl><dt>{t('attention.identifier')}</dt><dd>{patch.id}</dd><dt>{t('attention.instance')}</dt><dd>{patch.instanceId}</dd></dl></details>
    <footer className="attention-actions">{!confirm && <><Button className="attention-approve" data-attention-primary disabled={busy} onClick={() => setConfirm('approve')}>{t('attention.approve')}</Button><Button disabled={busy} onClick={() => setConfirm('reject')}>{t('attention.reject')}</Button></>}
      {confirm && <div role="group" aria-label={t('taskUi.confirmation')} className="confirmation-row"><p>{t(`attention.${confirm === 'approve' ? 'approve' : 'reject'}`)}</p><Button disabled={busy || !!command} onClick={() => { void execute(); }}>{t('workUi.confirm')}</Button><Button disabled={busy || !!command} onClick={() => setConfirm(null)}>{t('workUi.back')}</Button></div>}
      {error && <ErrorNotice error={error} />}{error && <Button disabled={busy} onClick={() => { void execute(true); }}>{t('errors.retry')}</Button>}<ActionHints />
    </footer></>}</div>;
}
export function ReadOnlyPanel({ store, row }: { store: Store; row: AttentionItem }) {
  const t = useT(); const inbox = store.useStoreSelector(state => state.globalInbox);
  const breaker = inbox.teamBreakers?.find(item => `breaker:${item.teamId}` === row.key);
  const conflict = inbox.integrationConflicts?.find(item => `conflict:${item.taskId}` === row.key);
  const monitor = inbox.monitors?.find(item => `monitor:${item.monitorId}` === row.key);
  const description = row.kind === 'team-breaker' ? breaker?.reason : row.kind === 'integration-conflict' ? conflict?.branch : row.kind === 'monitor' && monitor?.value !== null ? `${monitor?.kind}: ${monitor?.value}` : row.title;
  return <div className="attention-panel stack"><h2>{t(`attention.kinds.${row.kind}`)}</h2><p className="plain-text">{description || row.title}</p><a href={`#/project/${encodeURIComponent(row.projectId)}`}>{t('attention.open')}</a></div>;
}
