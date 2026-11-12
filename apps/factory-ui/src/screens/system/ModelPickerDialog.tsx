import { useEffect, useState } from 'react';
import { modelSettingsPendingKey, type ModelSettingsResponse } from '@/api/modelSettings';
import { ErrorNotice } from '@/components/ErrorNotice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { ModelPickerForm } from './ModelPickerForm';

export function ModelPickerDialog({ store, onClose }: { store: Store; onClose: () => void }) {
  const t = useT(); const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [snapshot, setSnapshot] = useState<ModelSettingsResponse | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { busy, error } = store.useStoreSelector(state => ({ busy: state.loading[modelSettingsPendingKey], error: state.errors['system:models'] }));
  useEffect(() => {
    let live = true;
    void store.loadModelSettings().then(() => {
      const state = store.getState();
      if (live && !state.errors['system:models']) setSnapshot(state.system.models);
    });
    return () => { live = false; };
  }, [store, attempt]);
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent ref={setContainer} showCloseButton={false} className="max-h-[90dvh] overflow-x-hidden overflow-y-auto rounded-xl border-border bg-card sm:max-w-[760px] [&>*]:min-w-0">
      <DialogHeader><DialogTitle className="font-display text-2xl">{t('modelsUi.change')}</DialogTitle><DialogDescription>{t('modelsUi.description')}</DialogDescription></DialogHeader>
      {snapshot ? <ModelPickerForm data={snapshot} store={store} onClose={onClose} container={container} /> : error ? <div className="space-y-4"><ErrorNotice error={error} /><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>{t('modelsUi.cancel')}</Button><Button type="button" onClick={() => setAttempt(value => value + 1)}>{t('errors.retry')}</Button></div></div>
        : <div className="space-y-3" role="status" aria-label={t('viewStates.loading')}><Skeleton className="h-9 w-full" /><Skeleton className="h-48 w-full" /><Button type="button" variant="outline" onClick={onClose}>{t('modelsUi.cancel')}</Button></div>}
    </DialogContent>
  </Dialog>;
}
