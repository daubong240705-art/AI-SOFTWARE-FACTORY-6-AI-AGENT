import { useLayoutEffect, useRef, type ReactNode } from 'react';

export function DockedPane({ children, label, onClose, className = '', id, fallbackFocus }: {
  children: ReactNode; label: string; onClose: () => void; className?: string; id?: string; fallbackFocus?: () => HTMLElement | null;
}) {
  const pane = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const fallback = useRef(fallbackFocus); fallback.current = fallbackFocus;
  useLayoutEffect(() => {
    const opener = document.activeElement;
    const node = pane.current;
    (node?.querySelector<HTMLElement>('button') ?? node)?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[role="dialog"]')) return;
      event.preventDefault(); event.stopPropagation(); close.current();
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      else fallback.current?.()?.focus();
    };
  }, []);
  return <section ref={pane} id={id} role="region" aria-label={label} tabIndex={-1} className={`project-dock min-h-0 min-w-0 overflow-x-hidden overflow-y-auto border-border outline-none ${className}`}>{children}</section>;
}

