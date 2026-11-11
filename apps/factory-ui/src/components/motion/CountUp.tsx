import { useEffect } from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { i18n, useT } from '@/i18n';

export function CountUp({ value }: { value: number }) {
  useT();
  const reduced = useReducedMotion(); const current = useMotionValue(value);
  const number = new Intl.NumberFormat(i18n.locale);
  const text = useTransform(current, latest => number.format(Math.round(latest)));
  useEffect(() => {
    if (reduced) { current.set(value); return; }
    const animation = animate(current, value, { duration: 0.4, ease: 'easeOut' });
    return () => animation.stop();
  }, [current, value, reduced]);
  return <span className="inline-grid tabular-nums"><span className="invisible col-start-1 row-start-1" aria-hidden>{number.format(value)}</span><motion.span className="col-start-1 row-start-1" aria-hidden>{text}</motion.span><span className="sr-only">{number.format(value)}</span></span>;
}
