import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { WorldQuality } from './quality';

type MotionKind = 'live' | 'ambient';
type Motion = { request: (kind: MotionKind) => () => void };
const WorldMotionContext = createContext<Motion | null>(null);
export function useWorldMotion(): Motion {
  const motion = useContext(WorldMotionContext);
  if (!motion) throw new Error('World motion requires Ticker');
  return motion;
}
export function Ticker({ quality, still, interactive = false, onMeasure, children }: {
  quality: WorldQuality; still: boolean; interactive?: boolean; children: ReactNode;
  onMeasure: (fps: number, live: boolean, now: number) => void;
}) {
  const invalidate = useThree(state => state.invalidate);
  const counts = useRef({ live: 0, ambient: 0 });
  const wake = useRef<() => void>(() => {});
  const sample = useRef({ since: 0, frames: 0 });
  const motion = useMemo<Motion>(() => ({ request(kind) {
    counts.current[kind] += 1; wake.current();
    let released = false;
    return () => { if (!released) { released = true; counts.current[kind] -= 1; wake.current(); } };
  } }), []);
  useFrame(() => {
    const now = performance.now();
    const measured = sample.current;
    if (!measured.since) measured.since = now;
    measured.frames += 1;
    if (now - measured.since >= 1000) {
      onMeasure(measured.frames * 1000 / (now - measured.since), counts.current.live > 0, now);
      measured.since = now; measured.frames = 0;
    }
  });
  useEffect(() => {
    let raf = 0; let previous = 0;
    const target = () => still && !interactive || document.hidden ? 0 : counts.current.live > 0 ? quality === 'low' ? 30 : 60
      : counts.current.ambient > 0 ? quality === 'low' ? 12 : 30 : 0;
    const tick = (now: number) => {
      raf = 0;
      const fps = target();
      if (!fps) return;
      if (now - previous >= 1000 / fps - 0.5) { previous = now; invalidate(); }
      raf = requestAnimationFrame(tick);
    };
    const restart = () => {
      cancelAnimationFrame(raf); raf = 0; previous = 0;
      sample.current = { since: 0, frames: 0 };
      onMeasure(0, false, performance.now());
      if (target()) raf = requestAnimationFrame(tick);
    };
    wake.current = restart;
    document.addEventListener('visibilitychange', restart);
    restart(); invalidate();
    return () => { wake.current = () => {}; cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', restart); };
  }, [quality, still, interactive, invalidate, onMeasure]);
  return <WorldMotionContext.Provider value={motion}>{children}</WorldMotionContext.Provider>;
}
