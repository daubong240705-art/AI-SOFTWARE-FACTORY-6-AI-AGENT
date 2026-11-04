import { useMemo, useSyncExternalStore } from "react";
import { MonitorStore, type MonitorState } from "./monitor-store";

const stores = new Map<string, MonitorStore>();
const empty: MonitorState = {
  snapshot: null,
  stale: false,
  error: "",
  receivedAt: 0,
};
const subscribeEmpty = () => () => {};
export function useMonitor(projectId: string | null) {
  const store = useMemo(() => {
    if (!projectId) return null;
    let current = stores.get(projectId);
    if (!current) {
      current = new MonitorStore(projectId, async (request) => {
        const reply = await window.worker.monitorSnapshot(request);
        if (!reply.ok) throw new Error(reply.error);
        return reply.value;
      });
      stores.set(projectId, current);
    }
    return current;
  }, [projectId]);
  const state = useSyncExternalStore(
    store?.subscribe ?? subscribeEmpty,
    store?.getSnapshot ?? (() => empty),
  );
  return { ...state, refresh: store?.refresh };
}
