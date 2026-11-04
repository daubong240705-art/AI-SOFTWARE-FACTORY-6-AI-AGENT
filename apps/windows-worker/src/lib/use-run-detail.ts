import { useMemo, useSyncExternalStore } from "react";
import { RunDetailStore, type DetailState } from "./run-detail-store";

const stores = new Map<string, RunDetailStore>();
const empty: DetailState = { detail: null, error: "", stale: false };
const subscribeEmpty = () => () => {};
export function useRunDetail(projectId: string | null, runId: string | null) {
  const store = useMemo(() => {
    if (!projectId || !runId) return null;
    const key = `${projectId}:${runId}`;
    let value = stores.get(key);
    if (!value) {
      value = new RunDetailStore(projectId, runId, async () => {
        const reply = await window.worker.runDetail(runId);
        if (!reply.ok) throw new Error(reply.error);
        return reply.value;
      });
      if (stores.size >= 12) {
        const inactive = [...stores].find(([, entry]) => entry.canEvict());
        if (inactive) stores.delete(inactive[0]);
      }
      stores.set(key, value);
    }
    return value;
  }, [projectId, runId]);
  const state = useSyncExternalStore(
    store?.subscribe ?? subscribeEmpty,
    store?.getSnapshot ?? (() => empty),
  );
  return { ...state, refresh: store?.refresh };
}
