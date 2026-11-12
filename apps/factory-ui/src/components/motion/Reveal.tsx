import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react';

/** A fresh view enters immediately; navigation never waits for an outgoing view. */
export function Reveal({ delay = 0, duration = 0.18, rise = 8, children, ...props }: HTMLMotionProps<'div'> & { delay?: number; duration?: number; rise?: number }) {
  const reduced = useReducedMotion();
  return <motion.div initial={reduced ? false : { opacity: 0, y: rise }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : duration, delay: reduced ? 0 : delay, ease: 'easeOut' }} {...props}>{children}</motion.div>;
}
