import { useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { integrationRetry, integrationSkip } from '@/api/commands';
import type { IntegrationResponse } from '@/api/notificationModels';
import { CommandFormFrame } from '@/components/CommandFormFrame';
import { ErrorNotice } from '@/components/ErrorNotice';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { integrationPendingKey, type IntegrationCommand } from '@/state/notifications';
import type { Store } from '@/state/store';

export function ConflictActions({ store, projectId, item }: {
  store: Store; projectId: string; item: IntegrationResponse['items'][number];
}) {
  const t = useT(); const state = store.useStoreSelector(s => s);
  const [confirm, setConfirm] = useState(false);
  const previous = useRef<IntegrationCommand | null>(null);
  const key = integrationPendingKey(item.taskId); const busy = Boolean(state.loading[key]);
  const canAct = state.selectedProjectId === projectId && state.session === 'authenticated'
    && item.state === 'conflict' && !state.errors.integration && !state.loading.integration;
  async function send(command: IntegrationCommand) {
    const result = await store.sendIntegration(command);
    if (result && store.getState().selectedProjectId === projectId && store.getState().session === 'authenticated') store.announceDecision();
    return result;
  }
  async function retry() {
    if (!canAct || busy) return;
    const command = previous.current?.type === 'integration.retry' && store.getState().pending[previous.current.commandId]?.status === 'failed'
      ? previous.current : integrationRetry({ projectId, taskId: item.taskId });
    previous.current = command; await send(command);
  }
  return <div className="space-y-3">
    {!confirm && state.errors[key] && <ErrorNotice error={state.errors[key]} />}
    <div className="flex flex-wrap gap-2" aria-busy={busy}>
      <Button size="sm" disabled={!canAct || busy} onClick={() => { void retry(); }}><RotateCcw className="size-3.5" aria-hidden="true" />{t('integrationUi.retry')}</Button>
      <Button variant="outline" size="sm" disabled={!canAct || busy} onClick={() => setConfirm(true)}>{t('integrationUi.skip')}</Button>
    </div>
    {confirm && <CommandFormFrame store={store} pendingKey={key} title={t('integrationUi.skipTitle')}
      description={t('integrationUi.skipDescription')} submitLabel={t('integrationUi.skip')} invalidKey="integrationUi.invalid"
      submitDisabled={!canAct} onClose={() => setConfirm(false)} send={send}
      onSubmit={() => store.getState().integration.items.find(row => row.taskId === item.taskId)?.state === 'conflict'
        ? integrationSkip({ projectId, taskId: item.taskId }) : 'integrationUi.unavailable'}>
      <p className="text-sm text-muted-foreground"><span className="font-mono">{item.code}</span> · {item.title}</p>
    </CommandFormFrame>}
  </div>;
}
