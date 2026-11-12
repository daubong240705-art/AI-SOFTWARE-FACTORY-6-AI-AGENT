import { useEffect, useState } from 'react';
import type { Store } from '@/state/store';

/** Keep both polling and event refreshes scoped to the visible activity tab. */
export function useActivity(store: Store, enabled: boolean) {
  const { session, selectedProjectId } = store.useStoreSelector(state => state);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled || session !== 'authenticated') return;
    let poll: ReturnType<typeof setInterval> | undefined;
    let clock: ReturnType<typeof setInterval> | undefined;
    let unwatch: (() => void) | undefined;
    const stop = () => { clearInterval(poll); clearInterval(clock); unwatch?.(); unwatch = undefined; };
    const sync = () => {
      stop();
      if (document.hidden) return;
      setNow(Date.now());
      unwatch = store.watchActivity();
      poll = setInterval(() => { void store.loadActivity(); }, 5000);
      clock = setInterval(() => setNow(Date.now()), 10_000);
    };
    sync(); document.addEventListener('visibilitychange', sync);
    return () => { stop(); document.removeEventListener('visibilitychange', sync); };
  }, [store, enabled, session, selectedProjectId]);
  return now;
}
