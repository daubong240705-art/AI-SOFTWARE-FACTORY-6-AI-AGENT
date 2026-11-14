import { useEffect, useState } from 'react';

/** Serial reads, paused while hidden; every request is aborted when the view leaves. */
export function useStudioRead<T>(read: (signal: AbortSignal) => Promise<T>, interval: number | false) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setData(null); setError(false);
    let disposed = false; let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function load() {
      if (disposed || busy || document.hidden) return;
      clearTimeout(timer); busy = true;
      try {
        const result = await read(controller.signal);
        if (!disposed) { setData(result); setError(false); }
      } catch { if (!disposed) setError(true); }
      finally {
        busy = false;
        if (!disposed && interval !== false && !document.hidden) timer = setTimeout(() => { void load(); }, interval);
      }
    }
    const visibility = () => { clearTimeout(timer); if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', visibility);
    void load();
    return () => { disposed = true; clearTimeout(timer); controller.abort(); document.removeEventListener('visibilitychange', visibility); };
  }, [read, interval, revision]);
  return { data, error, reload: () => setRevision(value => value + 1) };
}
