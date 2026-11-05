import { useSyncExternalStore } from "react";
import { WorkspaceStore } from "./workspace-store";

const store = new WorkspaceStore(async () => {
  const reply = await window.worker.workspaceSummary();
  if (!reply.ok) throw Error(reply.error);
  return reply.value;
});
export function useWorkspace() {
  return {
    ...useSyncExternalStore(store.subscribe, store.getSnapshot),
    refresh: store.refresh,
  };
}
