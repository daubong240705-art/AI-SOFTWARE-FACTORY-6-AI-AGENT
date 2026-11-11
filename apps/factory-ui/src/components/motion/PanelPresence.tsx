import { useEffect } from 'react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';

/** Reserve the existing grid column until the panel's short exit completes. */
export function usePanelLayout(open: boolean) {
  const [visible, setVisible] = useState(open);
  useEffect(() => { if (open) setVisible(true); }, [open]);
  return [open || visible, () => setVisible(false)] as const;
}

function Panel({ children, className, fallbackFocus }: { children: ReactNode; className?: string | undefined; fallbackFocus?: (() => HTMLElement | null) | undefined }) {
  const present = useIsPresent(); const reduced = useReducedMotion(); const node = useRef<HTMLDivElement>(null);
  // Capture before DockedPane's layout effect moves focus into the pane.
  const opener = useRef(typeof document === 'undefined' ? null : document.activeElement);
  const fallback = useRef(fallbackFocus); const exiting = useRef(false);
  useLayoutEffect(() => {
    exiting.current = !present;
    if (present || !node.current?.contains(document.activeElement)) return;
    const target = opener.current instanceof HTMLElement && opener.current.isConnected ? opener.current : fallback.current?.();
    target?.focus();
  }, [present]);
  useLayoutEffect(() => () => {
    if (!exiting.current) return;
    const target = document.activeElement;
    // DockedPane also returns focus on unmount. Preserve any focus chosen during exit.
    queueMicrotask(() => { if (target instanceof HTMLElement && target.isConnected && target !== document.body) target.focus(); });
  }, []);
  return <motion.div ref={node} data-motion-panel data-exiting={!present} inert={!present} className={className}
    initial={reduced ? false : { x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1, transition: { duration: reduced ? 0 : 0.22, ease: 'easeOut' } }}
    exit={{ x: reduced ? 0 : 24, opacity: 0, transition: { duration: reduced ? 0 : 0.16, ease: 'easeOut' } }}>{children}</motion.div>;
}

export function PanelPresence({ children, className, fallbackFocus, onExitComplete }: { children: ReactNode; className?: string; fallbackFocus?: () => HTMLElement | null; onExitComplete?: () => void }) {
  return <AnimatePresence {...(onExitComplete ? { onExitComplete } : {})}>{children && <Panel key="panel" className={className} fallbackFocus={fallbackFocus}>{children}</Panel>}</AnimatePresence>;
}
