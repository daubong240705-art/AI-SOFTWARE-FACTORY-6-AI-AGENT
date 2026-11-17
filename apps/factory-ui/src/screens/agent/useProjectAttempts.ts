import { useEffect, useRef, useState } from 'react';
import type { Office } from '@/api/officeModels';
import type { Store } from '@/state/store';
import type { ProjectAttempt } from './presentation';

/** Local, abortable reads; an office refresh also refreshes usage and finished runs. */
export function useProjectAttempts(store: Store, projectId: string, range: number, office: Office | undefined | null) {
  const [snapshot, setSnapshot] = useState<{ key: string; attempts: ProjectAttempt[]; error: boolean; loaded: boolean }>(
    { key: '', attempts: [], error: false, loaded: false });
  const reload = useRef<() => void>(() => {});
  const key = `${projectId}:${range}`;
  useEffect(() => {
    let disposed = false; let request = 0; let controller: AbortController | undefined;
    const load = async () => {
      if (document.hidden || disposed) return;
      const current = ++request;
      controller?.abort(); controller = new AbortController();
      try {
        const result = await store.listProjectAttempts(projectId, { since: new Date(Date.now() - range).toISOString(), limit: 500 }, controller.signal);
        if (!disposed && current === request) setSnapshot({ key, attempts: result.attempts, error: false, loaded: true });
      } catch {
        if (!disposed && current === request) setSnapshot(previous => ({ key,
          attempts: previous.key === key ? previous.attempts : [], error: true, loaded: true }));
      }
    };
    const refresh = () => { void load(); };
    reload.current = refresh;
    refresh();
    const poll = setInterval(refresh, 10_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      disposed = true; controller?.abort(); clearInterval(poll);
      document.removeEventListener('visibilitychange', refresh);
      reload.current = () => {};
    };
  }, [store, projectId, range, key]);
  useEffect(() => { if (office) reload.current(); }, [office]);
  return { attempts: snapshot.key === key ? snapshot.attempts : [], error: snapshot.key === key && snapshot.error,
    loading: snapshot.key !== key || !snapshot.loaded, retry: () => reload.current() };
}
