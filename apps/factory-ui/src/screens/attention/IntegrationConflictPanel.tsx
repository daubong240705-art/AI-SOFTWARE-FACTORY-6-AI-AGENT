import { useEffect, useId, useRef, useState } from 'react';
import { GitBranch, RotateCcw } from 'lucide-react';
import { integrationRetry, integrationSkip } from '@/api/commands';
import { CommandFormFrame } from '@/components/CommandFormFrame';
import { ErrorNotice } from '@/components/ErrorNotice';
import { Button } from '@/components/ui/button';
import { Section } from '@/components/app';
import { AttentionPane } from './AttentionPane';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';
import { shallowSelectionEqual } from '@/state/storeSelector';
import { integrationPendingKey, type IntegrationCommand } from '@/state/notifications';
import type { Store } from '@/state/store';
import type { AttentionItem } from '../shell/attention';

export function IntegrationConflictPanel({ store, row, onSuccess }: { store: Store; row: AttentionItem; onSuccess: () => void }) {
  const t = useT(); const id = useId(); const state = store.useStoreSelector(s => ({ session: s.session, projects: s.projects, integration: s.integration, globalInbox: s.globalInbox, loading: s.loading, errors: s.errors, pending: s.pending }), shallowSelectionEqual);
  const [confirm, setConfirm] = useState(false); const previous = useRef<IntegrationCommand | null>(null);
  const taskId = row.key.slice('conflict:'.length); const key = integrationPendingKey(taskId);
  const item = state.integration.items.find(item => item.taskId === taskId);
  const busy = Boolean(state.loading[key]); const error = state.errors[key];
  const canAct = item?.state === 'conflict' && !state.errors.integration && !state.loading.integration;
  useEffect(() => { void store.loadIntegration(); }, [store, row.projectId]);
  async function send(command: IntegrationCommand) {
    const result = await store.sendIntegration(command);
    if (result && store.getState().selectedProjectId === row.projectId && store.getState().session === 'authenticated') { store.announceDecision(); onSuccess(); }
    return result;
  }
  async function retry() {
    if (!canAct || busy) return;
    const command = previous.current?.type === 'integration.retry' && store.getState().pending[previous.current.commandId]?.status === 'failed'
      ? previous.current : integrationRetry({ projectId: row.projectId, taskId });
    previous.current = command; await send(command);
  }
  const inboxItem = state.globalInbox.integrationConflicts?.find(item => item.taskId === taskId && item.projectId === row.projectId);
  const body = <>
    <Section>
      <dl className="space-y-3 text-sm"><div><dt className="mb-1 text-xs text-muted-foreground">{t('integrationUi.branch')}</dt><dd className="m-0 flex items-start gap-2 break-all font-mono text-xs"><GitBranch className="size-4 shrink-0" aria-hidden="true" />{item?.branch ?? inboxItem?.branch}</dd></div>{state.integration.branch && <div><dt className="mb-1 text-xs text-muted-foreground">{t('integrationUi.target')}</dt><dd className="m-0 break-all font-mono text-xs">{state.integration.branch}</dd></div>}</dl>
      {state.loading.integration && !item ? <Skeleton className="h-10 w-full" /> : <p className="text-sm leading-relaxed text-muted-foreground">{item ? t(`integrationUi.errors.${item.errorKind === 'conflict' || item.errorKind === 'git-failed' ? item.errorKind : 'unknown'}`) : t('integrationUi.unavailable')}</p>}
      {state.errors.integration && <ErrorNotice error={state.errors.integration} />}
      {(!item || state.errors.integration) && <Button variant="outline" disabled={Boolean(state.loading.integration)} onClick={() => { void store.loadIntegration(); }}>{t('errors.retry')}</Button>}
    </Section>
  </>;
  const actions = <>
    {!confirm && error && <div className="basis-full"><ErrorNotice error={error} /></div>}
    {confirm && <CommandFormFrame store={store} pendingKey={key} title={t('integrationUi.skipTitle')} description={t('integrationUi.skipDescription')} submitLabel={t('integrationUi.skip')} invalidKey="integrationUi.invalid" submitDisabled={!canAct} onClose={() => setConfirm(false)} onSubmit={() => store.getState().integration.items.find(item => item.taskId === taskId)?.state === 'conflict' ? integrationSkip({ projectId: row.projectId, taskId }) : 'integrationUi.unavailable'} send={send}><p className="text-sm text-muted-foreground"><span className="font-mono">{item?.code}</span> · {item?.title}</p></CommandFormFrame>}
    <Button data-attention-primary disabled={!canAct || busy} onClick={() => { void retry(); }}><RotateCcw className="size-4" />{t('integrationUi.retry')}</Button><Button variant="outline" disabled={!canAct || busy} onClick={() => setConfirm(true)}>{t('integrationUi.skip')}</Button>
  </>;
  return <AttentionPane kind={t('attention.kinds.integration-conflict')} projectId={row.projectId} projectName={row.projectName ?? state.projects.find(project => project.id === row.projectId)?.name ?? t('overview.project')} code={item?.code ?? row.code} since={row.since} title={item?.title ?? row.title} titleId={id} actions={actions}>{body}</AttentionPane>;
}
