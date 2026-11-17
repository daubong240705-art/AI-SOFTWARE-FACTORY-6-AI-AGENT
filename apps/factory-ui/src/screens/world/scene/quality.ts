import { useCallback, useEffect, useState } from 'react';
import type { WorldPreferences } from '../preferences';

export type WorldQuality = 'high' | 'low';
export function softwareRenderer(gl: WebGL2RenderingContext | WebGLRenderingContext): boolean {
  const extension = gl.getExtension('WEBGL_debug_renderer_info');
  if (!extension) return false;
  const renderer: unknown = gl.getParameter(extension.UNMASKED_RENDERER_WEBGL);
  return typeof renderer === 'string' && /SwiftShader|llvmpipe|Software|Mesa OffScreen/i.test(renderer);
}
export function useWorldQuality(preference: WorldPreferences['quality']) {
  const [software, setSoftware] = useState(false);
  const [slow, setSlow] = useState(false);
  const [fps, setFps] = useState(0);
  const [monitor] = useState(() => ({ slowSince: null as number | null }));
  useEffect(() => { monitor.slowSince = null; setSlow(false); }, [preference, monitor]);
  const measure = useCallback((value: number, live: boolean, now: number) => {
    setFps(value);
    if (!live || value >= 24) { monitor.slowSince = null; return; }
    monitor.slowSince ??= now;
    if (now - monitor.slowSince >= 3000) setSlow(true);
  }, [monitor]);
  const quality: WorldQuality = preference === 'auto' ? software || slow ? 'low' : 'high' : preference;
  return { quality, fps, measure, setSoftware };
}
