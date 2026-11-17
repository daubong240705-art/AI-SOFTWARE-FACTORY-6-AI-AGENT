import { useEffect, useRef } from 'react';

export type FallbackReason = 'narrow' | 'webgl' | 'reduced-motion' | 'error' | 'preference';
export type RenderStats = Readonly<{ calls: number; triangles: number; geometries: number; textures: number; fps: number }>;
export type WorldDebugSnapshot = Readonly<{
  version: 1; mode: 'loading' | '3d' | 'fallback'; fallbackReason: FallbackReason | null;
  ready: boolean; quality: 'high' | 'low'; still: boolean; render: RenderStats;
}>;
export const emptyRender: RenderStats = Object.freeze({ calls: 0, triangles: 0, geometries: 0, textures: 0, fps: 0 });
declare global { interface Window { readonly __factoryWorld?: WorldDebugSnapshot } }
export function useWorldDebug(source: () => WorldDebugSnapshot) {
  const latest = useRef(source);
  latest.current = source;
  useEffect(() => {
    let cached: WorldDebugSnapshot | undefined;
    let sampledAt = -Infinity;
    const getter = () => {
      const now = performance.now();
      if (!cached || now - sampledAt >= 250) {
        const value = latest.current();
        cached = Object.freeze({ ...value, render: Object.freeze({ ...value.render }) });
        sampledAt = now;
      }
      return cached;
    };
    Object.defineProperty(window, '__factoryWorld', { configurable: true, get: getter });
    return () => {
      if (Object.getOwnPropertyDescriptor(window, '__factoryWorld')?.get === getter) Reflect.deleteProperty(window, '__factoryWorld');
    };
  }, []);
}
