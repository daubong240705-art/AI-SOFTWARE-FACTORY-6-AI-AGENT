import { useId, useRef, useState } from 'react';
import type { Command } from '@factory/contracts';
import { workflowsDecidePatch } from '../../api/commands';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Section, TechDetails } from '@/components/app';
import { useT } from '../../i18n';
import { shallowSelectionEqual } from '../../state/storeSelector';
import type { Store } from '../../state/store';
import type { AttentionItem } from '../shell/attention';
import { TaskActions } from '../TaskDetail';
import { AttentionPane } from './AttentionPane';
export { IntegrationConflictPanel } from './IntegrationConflictPanel';

export function GatePanel({ store, row, taskId, onSuccess }: { store: Store; row: AttentionItem; taskId: string; onSuccess: () => void }) {
  const t = useT();
  const { task, projectName } = store.useStoreSelector(value => ({ task: value.tasks.find(item => item.id === taskId), projectName: value.projects.find(project => project.id === row.projectId)?.name }), shallowSelectionEqual);
  // TaskActions also serves task details; keep its confirmation and error above the buttons here.
  const actions = task ? <div className="contents [&>[role=group]]:order-first [&>[role=group]]:mt-0 [&>[role=group]]:basis-full [&>[role=group]]:rounded-lg [&>[role=group]]:border-0 [&>[role=group]]:bg-need/10 [&>[role=group]]:p-3 [&>[role=alert]]:order-first [&>[role=alert]]:basis-full">
    <TaskActions store={store} task={task} attempt={undefined} attention onSuccess={onSuccess} />
  </div> : undefined;
  return <AttentionPane kind={t('attention.kinds.start-gate')} projectId={row.projectId} projectName={row.projectName ?? projectName ?? t('overview.project')} code={task?.code ?? row.code} since={row.since} title={row.title} actions={actions}>
    {task ? <>
      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{task.title}</p>
      <Section title={t('taskUi.goal')}><p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{task.goal}</p></Section>
      <Section title={t('taskUi.acceptance')}><ul className="list-disc space-y-1 pl-5">{task.acceptance.map((criterion, index) => <li key={index} className="whitespace-pre-wrap [overflow-wrap:anywhere]">{criterion}</li>)}</ul></Section>
    </> : <><p>{t('attention.taskUnavailable')}</p><Button type="button" variant="outline" onClick={() => { void store.loadTasks(); }}>{t('errors.retry')}</Button></>}
  </AttentionPane>;
}

export function PatchPanel({ store, row, onSuccess }: { store: Store; row: AttentionItem; onSuccess: () => void }) {
  const t = useT(); const id = useId();
  const state = store.useStoreSelector(value => ({ patches: value.globalInbox.patches, pending: value.pending, projectName: value.projects.find(project => project.id === row.projectId)?.name }), shallowSelectionEqual);
  const patch = state.patches?.find(item => `patch:${item.id}` === row.key);
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
  const actions = <>
    {confirm && <div role="group" aria-label={t('taskUi.confirmation')} className="basis-full space-y-3 rounded-lg bg-need/10 p-3">
      <p>{t(`attention.${confirm === 'approve' ? 'approve' : 'reject'}`)}</p>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy || !!command} onClick={() => { void execute(); }}>{t('workUi.confirm')}</Button><Button type="button" variant="outline" disabled={busy || !!command} onClick={() => setConfirm(null)}>{t('workUi.back')}</Button></div>
    </div>}
    {error && <div className="basis-full"><ErrorNotice error={error} /></div>}
    {!confirm && <><Button type="button" variant="outline" className="border-transparent bg-need text-need-foreground font-semibold hover:bg-need/90 hover:text-need-foreground" data-attention-primary disabled={busy} onClick={() => setConfirm('approve')}>{t('attention.approve')}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setConfirm('reject')}>{t('attention.reject')}</Button></>}
    {error && <Button type="button" variant="outline" disabled={busy} onClick={() => { void execute(true); }}>{t('errors.retry')}</Button>}
  </>;
  return <AttentionPane kind={t('attention.kinds.plan-patch')} projectId={row.projectId} projectName={row.projectName ?? state.projectName ?? t('overview.project')} code={row.code} since={row.since} title={patch?.instanceTitle ?? row.title} titleId={id} actions={patch ? actions : undefined}>
    {patch && <><p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{patch.reason}</p><Section><ul className="list-disc space-y-1 pl-5">{patch.ops.map((op, index) => <li key={index} className="whitespace-pre-wrap [overflow-wrap:anywhere]">{op}</li>)}</ul></Section>
      <TechDetails identifier={patch.id}><dl className="grid gap-1"><dt>{t('attention.instance')}</dt><dd className="font-mono">{patch.instanceId}</dd></dl></TechDetails>
    </>}
  </AttentionPane>;
}

export function ReadOnlyPanel({ store, row }: { store: Store; row: AttentionItem }) {
  const t = useT();
  const inbox = store.useStoreSelector(state => ({ breakers: state.globalInbox.teamBreakers, conflicts: state.globalInbox.integrationConflicts, monitors: state.globalInbox.monitors, projectName: state.projects.find(project => project.id === row.projectId)?.name }), shallowSelectionEqual);
  const breaker = inbox.breakers?.find(item => `breaker:${item.teamId}` === row.key);
  const conflict = inbox.conflicts?.find(item => `conflict:${item.taskId}` === row.key);
  const monitor = inbox.monitors?.find(item => `monitor:${item.monitorId}` === row.key);
  const description = row.kind === 'team-breaker' ? breaker?.reason : row.kind === 'integration-conflict' ? conflict?.branch : row.kind === 'monitor' && monitor?.value !== null ? `${monitor?.kind}: ${monitor?.value}` : row.title;
  return <AttentionPane kind={t(`attention.kinds.${row.kind}`)} projectId={row.projectId} projectName={row.projectName ?? inbox.projectName ?? t('overview.project')} code={row.code} since={row.since} title={row.title}>
    <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{description || row.title}</p>
    <Button variant="link" className="h-auto w-fit p-0" asChild><a href={`#/project/${encodeURIComponent(row.projectId)}`}>{t('attention.open')}</a></Button>
  </AttentionPane>;
}
