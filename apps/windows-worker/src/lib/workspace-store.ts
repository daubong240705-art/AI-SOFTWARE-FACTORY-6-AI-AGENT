import type { WorkspaceSummary } from "../../shared/workspace";

export type WorkspaceState = {
  data: WorkspaceSummary | null;
  error: string;
  stale: boolean;
};
export class WorkspaceStore {
  private state: WorkspaceState = { data: null, error: "", stale: false };
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  private receivedAt = 0;
  constructor(private read: () => Promise<WorkspaceSummary>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      if (this.receivedAt && Date.now() - this.receivedAt >= 3000)
        this.state = { ...this.state, stale: true };
      void this.refresh();
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) clearTimeout(this.timer);
    };
  };
  private emit() {
    for (const listener of this.listeners) listener();
  }
  refresh = (): Promise<void> => {
    if (this.pending) return this.pending;
    clearTimeout(this.timer);
    this.pending = Promise.resolve().then(async () => {
      const timeout = setTimeout(() => {
        this.state = { ...this.state, stale: true };
        this.emit();
      }, 3000);
      try {
        const data = await this.read();
        if (data.scope !== "all-projects") throw Error("Phản hồi sai phạm vi.");
        this.receivedAt = Date.now();
        this.state = { data, error: "", stale: false };
      } catch {
        this.state = {
          ...this.state,
          error: "Không tải được tổng quan toàn ứng dụng.",
          stale: true,
        };
      } finally {
        clearTimeout(timeout);
        this.pending = undefined;
        this.emit();
        if (this.listeners.size)
          this.timer = setTimeout(
            () => void this.refresh(),
            this.state.data?.active ? 900 : 2500,
          );
      }
    });
    return this.pending;
  };
}
