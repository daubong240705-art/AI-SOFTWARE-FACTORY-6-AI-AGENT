import type { StoreOptions } from './store';

export function createExtractionPolling({ pending, refresh, timer }: {
  pending: () => boolean;
  refresh: () => Promise<void>;
  timer: NonNullable<StoreOptions['timer']>;
}) {
  let handle: unknown;
  let running = false;
  let listening = false;
  const clear = () => { if (handle !== undefined) timer.clearTimeout(handle); handle = undefined; };
  function sync() {
    const needed = pending();
    if (typeof document !== 'undefined' && needed !== listening) {
      document[needed ? 'addEventListener' : 'removeEventListener']('visibilitychange', sync);
      listening = needed;
    }
    if (!needed || (typeof document !== 'undefined' && document.hidden)) { clear(); return; }
    if (handle !== undefined || running) return;
    handle = timer.setTimeout(() => {
      handle = undefined;
      if (!pending() || (typeof document !== 'undefined' && document.hidden)) { sync(); return; }
      running = true;
      void refresh().finally(() => { running = false; sync(); });
    }, 3000);
  }
  function stop() {
    clear();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', sync);
    listening = false;
  }
  return { sync, stop };
}
