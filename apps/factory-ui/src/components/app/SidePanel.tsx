import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DockedPane } from '@/screens/DockedPane';
import { cn } from '@/lib/utils';

export function SidePanel({ id, title, label, onClose, fallbackFocus, actions, footer, children, className }: {
  id?: string; title: ReactNode; label: string; onClose: () => void; fallbackFocus?: () => HTMLElement | null;
  actions?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string;
}) {
  return <DockedPane {...(id === undefined ? {} : { id })} {...(fallbackFocus === undefined ? {} : { fallbackFocus })} label={label} onClose={onClose} className={cn('flex h-full flex-col overflow-hidden p-0', className)}>
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4"><h2 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h2>{actions}<Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label={label}><X aria-hidden="true" /></Button></header>
    <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    {footer && <footer className="flex shrink-0 justify-end gap-2 border-t border-border p-3">{footer}</footer>}
  </DockedPane>;
}
