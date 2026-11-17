import { useEffect, useState } from 'react';

export type WorldCapability = { webgl2: boolean; narrow: boolean; reducedMotion: boolean };
const narrowQuery = '(max-width: 767px)';
const motionQuery = '(prefers-reduced-motion: reduce)';
function matches(query: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(query).matches;
}
export function worldCapability(): WorldCapability {
  let webgl2 = false;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    try {
      const gl = canvas.getContext('webgl2');
      webgl2 = gl !== null;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch { /* Context creation can fail on restricted or weak GPUs. */ }
    canvas.remove();
  }
  return { webgl2, narrow: matches(narrowQuery), reducedMotion: matches(motionQuery) };
}
export function useWorldCapability(): WorldCapability {
  const [capability, setCapability] = useState(worldCapability);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const narrow = matchMedia(narrowQuery);
    const motion = matchMedia(motionQuery);
    const update = () => setCapability(previous => ({ ...previous, narrow: narrow.matches, reducedMotion: motion.matches }));
    update();
    narrow.addEventListener('change', update); motion.addEventListener('change', update);
    return () => { narrow.removeEventListener('change', update); motion.removeEventListener('change', update); };
  }, []);
  return capability;
}
