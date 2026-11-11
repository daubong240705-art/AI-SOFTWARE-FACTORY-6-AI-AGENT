import type { ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';

function Content({ children }: { children: ReactNode }) {
  const present = useIsPresent(); const reduced = useReducedMotion();
  return <motion.div className="col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col" inert={!present} initial={{ opacity: reduced ? 1 : 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.12, ease: 'easeOut' }}>{children}</motion.div>;
}

export function Crossfade({ contentKey, children }: { contentKey: string; children: ReactNode }) {
  return <div className="grid min-h-0 flex-1 grid-cols-1"><AnimatePresence initial={false}><Content key={contentKey}>{children}</Content></AnimatePresence></div>;
}
