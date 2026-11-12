import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { SystemCard, SystemRead, SystemStatus } from './SystemCard';
import { ModelPickerSummary } from './ModelPickerSummary';
import { ModelPickerDialog } from './ModelPickerDialog';

export function ModelsCard({ store }: { store: Store }) {
  const t = useT(); const [open, setOpen] = useState(false);
  const { models, projectId } = store.useStoreSelector(state => ({ models: state.system.models, projectId: state.selectedProjectId ?? state.projects[0]?.id }));
  return <SystemCard title={t('modelsUi.title')}><SystemRead store={store} area="models">
    {models && <div className="space-y-5"><div className="flex flex-wrap items-start justify-between gap-4"><Badge variant="secondary">{t(`modelsUi.${models.settings.source}`)}</Badge><Button type="button" onClick={() => setOpen(true)}>{t('modelsUi.change')}</Button></div>
      <ModelPickerSummary settings={models.settings} />
      <SystemStatus tone={models.gateway.configured && models.gateway.keyPresent ? 'ok' : 'muted'} label={t(`modelsUi.${!models.gateway.configured ? 'gatewayMissing' : models.gateway.keyPresent ? 'gatewayReady' : 'gatewayNoKey'}`)} />
      {!projectId && <p className="text-sm text-muted-foreground">{t('modelsUi.noProject')}</p>}
      <p className="max-w-5xl text-xs leading-relaxed text-muted-foreground">{t('modelsUi.note')}</p>
      {open && <ModelPickerDialog store={store} onClose={() => setOpen(false)} />}
    </div>}
  </SystemRead></SystemCard>;
}
