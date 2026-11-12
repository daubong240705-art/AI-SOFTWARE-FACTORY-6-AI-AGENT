import { useRef, useState, type ReactNode } from 'react';
import type { Command } from '@factory/contracts';
import { ErrorNotice } from '@/components/ErrorNotice';
import { PortalContainerContext } from '@/components/Select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError } from '@/components/ui/field';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';

export function CommandFormFrame<C extends Command>({ pendingKey, store, onClose, onSubmit, send, title, description, submitLabel, invalidKey, submitDisabled = false, children }: {
  pendingKey: string; store: Store; onClose: () => void; onSubmit: () => C | string;
  send: (command: C) => Promise<unknown>; title: string; description: string; submitLabel: string;
  invalidKey: string; submitDisabled?: boolean; children: ReactNode;
}) {
  const t = useT();
  const { busy, error } = store.useStoreSelector(s => ({ busy: s.loading[pendingKey], error: s.errors[pendingKey] }));
  const [problem, setProblem] = useState(''); const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const inFlight = useRef(false);
  async function submit() {
    if (inFlight.current || busy || submitDisabled) return;
    setProblem('');
    let command: C | string;
    try { command = onSubmit(); } catch { setProblem(invalidKey); return; }
    if (typeof command === 'string') { setProblem(command); return; }
    inFlight.current = true;
    try { if (await send(command) || store.getState().errors[pendingKey]?.code === 'conflict') onClose(); }
    finally { inFlight.current = false; }
  }
  return <Dialog open onOpenChange={open => { if (!open && !inFlight.current && !busy) onClose(); }}>
    <DialogContent ref={setPanel} showCloseButton={false} className="max-h-[90dvh] overflow-y-auto overflow-x-hidden rounded-xl border-border bg-card [&>*]:min-w-0">
      <PortalContainerContext.Provider value={panel}>
        <DialogHeader><DialogTitle className="font-display text-xl">{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <form className="space-y-5" aria-busy={Boolean(busy)} onSubmit={event => { event.preventDefault(); void submit(); }}>
          <fieldset disabled={Boolean(busy)} className="min-w-0 space-y-5">{children}</fieldset>
          {problem && <FieldError>{t(problem)}</FieldError>}{error && <ErrorNotice error={error} />}
          <DialogFooter><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={onClose}>{t('automationWrite.cancel')}</Button><Button type="submit" disabled={Boolean(busy) || submitDisabled}>{busy ? t('automationWrite.saving') : submitLabel}</Button></DialogFooter>
        </form>
      </PortalContainerContext.Provider>
    </DialogContent>
  </Dialog>;
}
