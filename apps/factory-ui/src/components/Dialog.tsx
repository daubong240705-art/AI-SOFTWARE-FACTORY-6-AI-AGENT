import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { PortalContainerContext } from './Select';

const focusable = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

export function Dialog({ labelledBy, onClose, children, className = '' }: { labelledBy: string; onClose: () => void; children: ReactNode; className?: string }) {
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const opener = document.activeElement;
    if (!panel) return;
    // Walk in document order, including when a selector engine groups selector-list results.
    const controls = () => Array.from(panel.querySelectorAll<HTMLElement>('*')).filter((node) => node.matches(focusable) && node.tabIndex >= 0 && !node.hidden && !node.closest('[hidden]'));
    const focusFirst = () => (controls()[0] ?? panel).focus();
    focusFirst();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const items = controls();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) { event.preventDefault(); panel.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const containFocus = (event: FocusEvent) => { if (!panel.contains(event.target as Node)) focusFirst(); };
    document.addEventListener('keydown', keydown);
    document.addEventListener('focusin', containFocus);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('focusin', containFocus);
      document.body.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [panel]);
  return <div className={`dialog-backdrop ${className}`}><PortalContainerContext.Provider value={panel}><div ref={setPanel} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} className="dialog card stack">{children}</div></PortalContainerContext.Provider></div>;
}
