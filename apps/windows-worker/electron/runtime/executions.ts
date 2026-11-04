type Closable = { close(): Promise<void> };
export type ExecutionHandle = {
  id: string;
  taskId?: string;
  runtime?: Closable;
  proxy?: Closable;
};

/** Run-owned resources. Failed containment keeps ownership for an explicit retry. */
export class Executions {
  private handles = new Map<string, ExecutionHandle>();
  private closing = new Map<string, Promise<void>>();
  private stopped = false;

  get size(): number {
    return this.handles.size;
  }

  open(id: string, taskId?: string): ExecutionHandle {
    if (this.stopped) throw new Error("Run execution admission is closed");
    if (this.handles.has(id)) throw new Error("Execution already owned");
    const handle: ExecutionHandle = { id, taskId };
    this.handles.set(id, handle);
    return handle;
  }

  close(id: string): Promise<void> {
    const pending = this.closing.get(id);
    if (pending) return pending;
    const handle = this.handles.get(id);
    if (!handle) return Promise.resolve();
    const closing = Promise.resolve()
      .then(async () => {
        // Attempt both resources even if one fails. Never release failed ownership.
        const results = await Promise.allSettled([
          Promise.resolve().then(() => handle.runtime?.close()),
          Promise.resolve().then(() => handle.proxy?.close()),
        ]);
        const errors = results.filter((r) => r.status === "rejected");
        if (errors.length)
          throw new AggregateError(
            errors.map((r) => r.reason),
            "Execution containment failed",
          );
        this.handles.delete(id);
      })
      .finally(() => {
        this.closing.delete(id);
      });
    this.closing.set(id, closing);
    return closing;
  }

  async stop(): Promise<void> {
    // Synchronous latch: startup cannot admit a new execution during drain.
    this.stopped = true;
    const results = await Promise.allSettled(
      [...this.handles.keys()].map((id) => this.close(id)),
    );
    const errors = results.filter((r) => r.status === "rejected");
    if (errors.length)
      throw new AggregateError(
        errors.map((r) => r.reason),
        "Run containment failed",
      );
  }
}
