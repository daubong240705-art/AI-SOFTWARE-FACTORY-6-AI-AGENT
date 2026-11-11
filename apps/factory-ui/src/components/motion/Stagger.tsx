import { Children, createContext, useContext, useEffect, useLayoutEffect, useRef } from 'react';
import { motion, useAnimationControls, useIsPresent, useReducedMotion, type HTMLMotionProps } from 'motion/react';

const FirstBatch = createContext(true);

export function Stagger({ children, ...props }: HTMLMotionProps<'ul'>) {
  const first = useRef(true);
  const hasItems = Children.count(children) > 0;
  useEffect(() => { if (hasItems) first.current = false; }, [hasItems]);
  return <FirstBatch value={first.current}><motion.ul {...props}>{children}</motion.ul></FirstBatch>;
}

/** Only the first twelve rows stagger. Later additions enter without a delay. */
export function StaggerItem({ index = 0, collapse = false, children, ...props }: HTMLMotionProps<'li'> & { index?: number; collapse?: boolean }) {
  const first = useContext(FirstBatch); const reduced = useReducedMotion();
  const controls = useAnimationControls(); const present = useIsPresent();
  const entry = useRef({ first, index });
  useLayoutEffect(() => {
    if (reduced) { controls.set({ opacity: 1, y: 0 }); return; }
    controls.set({ opacity: 0, y: 8 });
    void controls.start({ opacity: 1, y: 0, transition: { duration: 0.18, ease: 'easeOut', delay: entry.current.first && entry.current.index < 12 ? entry.current.index * 0.03 : 0 } });
  }, [controls, reduced]);
  return <motion.li initial={false} animate={controls} inert={!present} exit={{ opacity: 0, ...(collapse ? { height: 0, marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0, overflow: 'hidden' } : {}), transition: { duration: reduced ? 0 : 0.16, ease: 'easeOut' } }} {...props}>{children}</motion.li>;
}
