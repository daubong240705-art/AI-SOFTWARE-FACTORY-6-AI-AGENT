import { useRef, useState, type ReactNode } from 'react';
import { ErrorNotice } from '@/components/ErrorNotice';
import { PortalContainerContext } from '@/components/Select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError } from '@/components/ui/field';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { pendingKey, type Area, type AutomationCommand } from './types';

export function FormFrame({ area, itemId, store, onClose, onSubmit, children }: {
  area: Area; itemId?: string | undefined; store: Store; onClose: () => void;
  onSubmit: () => AutomationCommand | string; children: ReactNode;
}) {
  const t = useT(); const key = pendingKey(area, itemId);
  const { busy, error } = store.useStoreSelector(s => ({ busy: s.loading[key], error: s.errors[key] }));
  const [problem, setProblem] = useState(''); const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const inFlight = useRef(false);
  async function submit() {
    if (inFlight.current || busy) return;
    setProblem('');
    let command: AutomationCommand | string;
    try { command = onSubmit(); } catch { setProblem('automationWrite.invalid'); return; }
    if (typeof command === 'string') { setProblem(command); return; }
    inFlight.current = true;
    try { if (await store.sendAutomation(command) || store.getState().errors[key]?.code === 'conflict') onClose(); }
    finally { inFlight.current = false; }
  }
  return <Dialog open onOpenChange={open => { if (!open && !inFlight.current && !busy) onClose(); }}>
    <DialogContent ref={setPanel} showCloseButton={false} className="max-h-[90dvh] overflow-y-auto rounded-xl border-border bg-card">
      <PortalContainerContext.Provider value={panel}>
        <DialogHeader><DialogTitle className="font-display text-xl">{t(`automationWrite.${itemId ? 'editTitle' : 'add'}.${area}`)}</DialogTitle><DialogDescription>{t('automationWrite.formHelp')}</DialogDescription></DialogHeader>
        <form className="space-y-5" onSubmit={event => { event.preventDefault(); void submit(); }}>
          <fieldset disabled={Boolean(busy)} className="space-y-5">{children}</fieldset>
          {problem && <FieldError>{t(problem)}</FieldError>}{error && <ErrorNotice error={error} />}
          <DialogFooter><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={onClose}>{t('automationWrite.cancel')}</Button><Button type="submit" disabled={Boolean(busy)}>{t(busy ? 'automationWrite.saving' : itemId ? 'automationWrite.save' : 'automationWrite.create')}</Button></DialogFooter>
        </form>
      </PortalContainerContext.Provider>
    </DialogContent>
  </Dialog>;
}
