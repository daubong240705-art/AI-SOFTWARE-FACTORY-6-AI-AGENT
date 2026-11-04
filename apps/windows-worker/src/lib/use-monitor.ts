import { useMemo, useSyncExternalStore } from "react";
import { MonitorStore, type MonitorState } from "./monitor-store";
import type { BoardQuery } from "../../shared/board";

const stores = new Map<string, MonitorStore>();
const empty: MonitorState = {
  snapshot: null,
  stale: false,
  error: "",
  receivedAt: 0,
};
const subscribeEmpty = () => () => {};
export function useMonitor(
  projectId: string | null,
  board?: BoardQuery,
  overview = false,
) {
  const queryKey = JSON.stringify(board);
  const store = useMemo(() => {
    if (!projectId) return null;
    const key = `${projectId}:${queryKey ?? "roster"}:${overview}`;
    let current = stores.get(key);
    if (!current) {
      current = new MonitorStore(projectId, async (request) => {
        const reply = await window.worker.monitorSnapshot({
          ...request,
          ...(queryKey ? { board: JSON.parse(queryKey) as BoardQuery } : {}),
          ...(overview ? { overview: true } : {}),
        });
        if (!reply.ok) throw new Error(reply.error);
        return reply.value;
      });
      if (stores.size >= 64) {
        const inactive = [...stores].find(
          ([, value]) => !value.hasSubscribers(),
        );
        if (inactive) stores.delete(inactive[0]);
      }
      stores.set(key, current);
    }
    return current;
  }, [projectId, queryKey, overview]);
  const state = useSyncExternalStore(
    store?.subscribe ?? subscribeEmpty,
    store?.getSnapshot ?? (() => empty),
  );
  return { ...state, refresh: store?.refresh };
}
