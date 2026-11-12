import { useState, type ReactNode } from 'react';
import { Dialog as UiDialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { PortalContainerContext } from './Select';

export function Dialog({ labelledBy, onClose, children, className = '' }: {
  labelledBy: string; onClose: () => void; children: ReactNode; className?: string;
}) {
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  // Opened from code, not a Radix trigger: remember who had focus so closing can hand it back.
  const [opener] = useState(() => typeof document === 'undefined' || !(document.activeElement instanceof HTMLElement) ? null : document.activeElement);
  return <UiDialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent ref={setPanel} aria-labelledby={labelledBy} aria-describedby={undefined} showCloseButton={false}
      onCloseAutoFocus={event => { if (opener?.isConnected) { event.preventDefault(); opener.focus(); } }}
      className={cn('max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border-border bg-card sm:max-w-2xl', className)}>
      <DialogTitle className="sr-only" aria-hidden />
      <PortalContainerContext.Provider value={panel}>{children}</PortalContainerContext.Provider>
    </DialogContent>
  </UiDialog>;
}
