import type {
  MonitorReply,
  MonitorRequest,
  MonitorSnapshot,
} from "../../shared/monitor";

export type MonitorState = {
  snapshot: MonitorSnapshot | null;
  stale: boolean;
  error: string;
  receivedAt: number;
};
export class MonitorStore {
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight = false;
  private state: MonitorState = {
    snapshot: null,
    stale: false,
    error: "",
    receivedAt: 0,
  };
  constructor(
    readonly projectId: string,
    private read: (request: MonitorRequest) => Promise<MonitorReply>,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1 && !this.inFlight) void this.refresh();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) clearTimeout(this.timer);
    };
  };
  refresh = async (): Promise<void> => {
    if (this.inFlight) return;
    clearTimeout(this.timer);
    this.inFlight = true;
    const staleTimer = setTimeout(
      () => {
        if (
          !this.state.receivedAt ||
          Date.now() - this.state.receivedAt >= 3000
        ) {
          this.state = { ...this.state, stale: true };
          for (const listener of this.listeners) listener();
        }
      },
      Math.max(
        0,
        3000 - (this.state.receivedAt ? Date.now() - this.state.receivedAt : 0),
      ),
    );
    try {
      const previous = this.state.snapshot;
      const reply = await this.read({
        projectId: this.projectId,
        epoch: previous?.epoch,
        sinceRevision: previous?.revision,
      });
      const version = reply.unchanged ? reply : reply.snapshot;
      if (version.projectId !== this.projectId)
        throw new Error("Phản hồi không đúng dự án.");
      if (
        reply.unchanged &&
        (!previous ||
          reply.epoch !== previous.epoch ||
          reply.revision !== previous.revision)
      )
        throw new Error("Cần đồng bộ lại trạng thái.");
      if (
        !reply.unchanged &&
        previous?.epoch === version.epoch &&
        previous.revision > version.revision
      )
        throw new Error("Bỏ qua phản hồi trạng thái cũ.");
      this.state = {
        snapshot: reply.unchanged
          ? { ...previous!, observedAt: reply.observedAt }
          : reply.snapshot,
        stale: false,
        error: "",
        receivedAt: Date.now(),
      };
    } catch {
      this.state = {
        ...this.state,
        error: "Không tải được trạng thái agent.",
        stale:
          !this.state.receivedAt || Date.now() - this.state.receivedAt >= 3000,
      };
    } finally {
      clearTimeout(staleTimer);
      this.inFlight = false;
      for (const listener of this.listeners) listener();
      if (this.listeners.size)
        this.timer = setTimeout(
          () => void this.refresh(),
          this.state.snapshot?.activeRun || this.state.error ? 500 : 2000,
        );
    }
  };
}
