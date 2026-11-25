import { Choice, ChoiceOption } from '@/components/ui/choice';
import { useCallback, useReducer, useState } from 'react';
import type { HttpEffect } from '@/api/integrationModels';
import { Button } from '@/components/ui/button';
import { TechDetails } from '@/components/app/TechDetails';
import { AdminDialog, DialogButtons, Field, useRead } from '../agents/shared';
import { useGroups } from '../groups/GroupsContext';
import { IntegrationError, RetryRead, useIntegrationLabels, useIntegrationWrite } from './shared';

function Reconcile({ projectId, effect, close, refresh }: { projectId: string; effect: HttpEffect; close: () => void; refresh: () => void }) {
  const { api } = useGroups();
  const t = useIntegrationLabels();
  const write = useIntegrationWrite();
  const [resolution, setResolution] = useState<'' | 'done' | 'failed'>('');
  return <AdminDialog title={t('reconcile')} description={t('reconcileHelp')} close={close} busy={write.busy}
    onSubmit={() => { if (resolution && !write.conflict) void write.run(() => api.reconcileHttpEffect(projectId, effect.id, resolution), () => { refresh(); close(); }, 'reconciled'); }}
    footer={<DialogButtons close={close} label={t('reconcile')} busy={write.busy} disabled={!resolution || write.conflict} />}>
    <TechDetails identifier={effect.id} />
    <Field label={t('resolution')}>{props => <Choice {...props} value={resolution} onValueChange={selectedValue => setResolution(selectedValue === 'done' ? 'done' : selectedValue === 'failed' ? 'failed' : '')}>
      <ChoiceOption value="">{t('selectResolution')}</ChoiceOption><ChoiceOption value="done">{t('resolvedDone')}</ChoiceOption><ChoiceOption value="failed">{t('resolvedFailed')}</ChoiceOption>
    </Choice>}</Field>
    <IntegrationError error={write.error} />
    {write.conflict && <Button type="button" variant="outline" onClick={() => { refresh(); close(); }}>{t('refresh')}</Button>}
  </AdminDialog>;
}

export default function HttpEffects({ projectId }: { projectId: string }) {
  const { api } = useGroups();
  const t = useIntegrationLabels();
  const [attempt, refresh] = useReducer((value: number) => value + 1, 0);
  const read = useCallback((signal: AbortSignal) => api.listHttpEffects(projectId, signal), [api, projectId]);
  const result = useRead(read, attempt);
  const [effect, setEffect] = useState<HttpEffect>();
  const unknown = result.data?.effects.filter(item => item.state === 'unknown');
  return <section aria-label={t('effects')} className="max-h-[35%] shrink-0 overflow-auto border-t bg-card px-4 py-2 sm:px-8">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{t('effects')}</h2><Button type="button" size="sm" variant="ghost" disabled={result.loading} onClick={refresh}>{t('refresh')}</Button></div>
    <RetryRead error={result.error} loading={result.loading && !result.data} retry={refresh} />
    {unknown?.length === 0 && <p className="text-sm text-muted-foreground">{t('noEffects')}</p>}
    {unknown && unknown.length > 0 && <ul className="divide-y">{unknown.map((item, index) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
      <div className="min-w-0 text-sm">{t('effects')} · {index + 1}<TechDetails identifier={item.id} /></div>
      <Button type="button" size="sm" variant="outline" onClick={() => setEffect(item)}>{t('reconcile')}</Button>
    </li>)}</ul>}
    {effect && <Reconcile projectId={projectId} effect={effect} close={() => setEffect(undefined)} refresh={refresh} />}
  </section>;
}
