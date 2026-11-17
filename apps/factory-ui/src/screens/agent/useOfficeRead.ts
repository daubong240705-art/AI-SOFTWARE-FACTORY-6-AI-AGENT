import { useEffect } from 'react';
import type { Store } from '@/state/store';

/** Keep event refreshes and the five-second progress poll paused while hidden. */
export function useOfficeRead(store: Store, projectId: string) {
  useEffect(() => {
    let poll: ReturnType<typeof setInterval> | undefined;
    let unwatch: (() => void) | undefined;
    const stop = () => { clearInterval(poll); unwatch?.(); unwatch = undefined; };
    const sync = () => {
      stop();
      if (document.hidden) return;
      unwatch = store.watchM3('office', store.loadOffice);
      poll = setInterval(() => { void store.loadOffice(); }, 5000);
    };
    sync(); document.addEventListener('visibilitychange', sync);
    return () => { stop(); document.removeEventListener('visibilitychange', sync); };
  }, [store, projectId]);
}
