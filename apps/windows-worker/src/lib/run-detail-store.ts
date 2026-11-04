import { isActive, type RunDetail } from "../../shared/runs";

export type DetailState = {
  detail: RunDetail | null;
  error: string;
  stale: boolean;
};

// One request and one timer per project/run, regardless of the number of views.
export class RunDetailStore {
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  private receivedAt = 0;
  private state: DetailState = { detail: null, error: "", stale: false };
  constructor(
    readonly projectId: string,
    readonly runId: string,
    private read: () => Promise<RunDetail>,
  ) {}
  getSnapshot = () => this.state;
  hasSubscribers = () => this.listeners.size > 0;
  canEvict = () => !this.listeners.size && !this.pending;
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
  refresh = (): Promise<void> => {
    if (this.pending) return this.pending;
    clearTimeout(this.timer);
    this.pending = Promise.resolve().then(() => this.fetch());
    return this.pending;
  };
  private async fetch() {
    // Mark a hung request stale without launching another request.
    const staleTimer = setTimeout(() => {
      this.state = { ...this.state, stale: true };
      this.emit();
    }, 3000);
    try {
      const detail = await this.read();
      if (
        detail.run.id !== this.runId ||
        detail.run.projectId !== this.projectId
      )
        throw new Error("Chi tiết không đúng dự án hoặc lượt chạy.");
      this.receivedAt = Date.now();
      this.state = { detail, stale: false, error: "" };
    } catch (error) {
      this.state = {
        ...this.state,
        error:
          error instanceof Error ? error.message : "Không tải được chi tiết.",
        stale: !this.receivedAt || Date.now() - this.receivedAt >= 3000,
      };
    } finally {
      clearTimeout(staleTimer);
      this.pending = undefined;
      this.emit();
      if (this.listeners.size)
        this.timer = setTimeout(
          () => void this.refresh(),
          this.state.error ||
            (this.state.detail && isActive(this.state.detail.run.state))
            ? 600
            : 2500,
        );
    }
  }
  private emit() {
    for (const listener of this.listeners) listener();
  }
}
