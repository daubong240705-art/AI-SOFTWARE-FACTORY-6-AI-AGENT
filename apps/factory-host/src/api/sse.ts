import { API_VERSION, cursorSchema, idSchema, streamResetSchema } from "@factory/contracts";
import type { FastifyInstance } from "fastify";
import type { Socket } from "node:net";
import type { EventHub } from "../events/hub.js";
import { createIdGenerator } from "../ids.js";
import type { Storage } from "../storage/database.js";
import { failure } from "./http.js";
import type { ApiGuards } from "./server.js";

export function registerEventStream(app: FastifyInstance, guards: ApiGuards, deps: {
  storage: Storage; hub: EventHub; newId?: () => string;
  keepAliveMs?: number; maxStreams?: number; batchSize?: number;
}): void {
  const { storage, hub, keepAliveMs = 15_000, maxStreams = 20, batchSize = 100 } = deps;
  const newId = deps.newId ?? createIdGenerator();
  if (![keepAliveMs, maxStreams, batchSize].every((value) => Number.isSafeInteger(value) && value > 0))
    throw new Error("Event stream limits must be positive integers");
  const streams = new Set<() => void>();
  const unusedSockets = new Set<Socket>();
  let closing = false;
  const onConnection = (socket: Socket): void => {
    if (closing) { socket.end(); return; }
    unusedSockets.add(socket);
    socket.once("close", () => unusedSockets.delete(socket));
  };
  const onRequest = (request: { socket: Socket }): void => { unusedSockets.delete(request.socket); };
  app.server.on("connection", onConnection);
  app.server.on("request", onRequest);
  const closeStreams = (): void => {
    closing = true;
    for (const close of [...streams]) close();
  };
  // onClose runs after HTTP connections have closed; stop hijacked replies first.
  app.addHook("preClose", async () => {
    closeStreams();
    // HTTP closeIdleConnections excludes speculative TCP connections with no request yet.
    for (const socket of unusedSockets) socket.end();
    app.server.closeIdleConnections();
  });
  app.addHook("onClose", async () => {
    closeStreams();
    app.server.off("connection", onConnection);
    app.server.off("request", onRequest);
    unusedSockets.clear();
  });

  app.get("/projects/:projectId/events", { preHandler: guards.session }, async (request, reply) => {
    const project = idSchema.safeParse((request.params as { projectId: string }).projectId);
    if (!project.success)
      return failure(reply, 400, "validation", "Invalid project id.", "correct-input", newId);
    const projectId = project.data;
    const exists = storage.raw.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
    const current = exists ? hub.currentCursor(projectId) : null;
    if (!current)
      return failure(reply, 404, "not-found", "Project stream not found.", "correct-input", newId);
    const query = request.query as { after?: unknown };
    const supplied = query.after !== undefined ? query.after : request.headers["last-event-id"];
    const parts = typeof supplied === "string" ? supplied.split(":") : [];
    const parsed = cursorSchema.safeParse(supplied === undefined
      ? { epoch: current.epoch, sequence: "0" }
      : parts.length === 2 ? { epoch: parts[0], sequence: parts[1] } : null);
    if (!parsed.success)
      return failure(reply, 400, "validation", "Invalid event cursor.", "correct-input", newId);
    if (closing || streams.size >= maxStreams)
      return failure(reply, 429, "resource-exhausted", "Event streams temporarily unavailable.", "wait", newId);

    reply.hijack();
    const res = reply.raw;
    const socket = request.raw.socket;
    let last = parsed.data;
    let closed = false;
    let running = false;
    let pending = false;
    let ping = false;
    let unsubscribe = (): void => {};
    let timer: ReturnType<typeof setInterval> | undefined;
    let releaseDrain: (() => void) | undefined;
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      streams.delete(shutdown);
      if (timer !== undefined) clearInterval(timer);
      try { unsubscribe(); } catch { /* A failing observer must stay isolated. */ }
      releaseDrain?.();
      res.off("close", cleanup);
      socket.off("close", cleanup);
    };
    const end = (): void => {
      cleanup();
      try { if (!res.destroyed && !res.writableEnded) res.end(); } catch { res.destroy(); }
    };
    const shutdown = (): void => {
      end();
      if (res.writableFinished || socket.destroyed) return;
      // A client that stopped reading must not block Host shutdown indefinitely.
      const deadline = setTimeout(() => socket.destroy(), 1000);
      deadline.unref();
      const clearDeadline = (): void => {
        clearTimeout(deadline);
        res.off("finish", clearDeadline);
        res.off("close", clearDeadline);
      };
      res.once("finish", clearDeadline);
      res.once("close", clearDeadline);
    };
    streams.add(shutdown);
    res.on("close", cleanup);
    socket.on("close", cleanup);
    // Keep an error listener installed even after end: errors can arrive asynchronously.
    res.on("error", end);

    const write = async (frame: string): Promise<boolean> => {
      if (closed || res.destroyed || res.writableEnded) { end(); return false; }
      if (!res.write(frame)) {
        await new Promise<void>((resolve) => {
          const release = (): void => {
            res.off("drain", release);
            releaseDrain = undefined;
            resolve();
          };
          releaseDrain = release;
          res.once("drain", release);
          if (closed || res.destroyed) release();
        });
      }
      return !closed;
    };
    const drain = async (): Promise<void> => {
      if (running || closed) return;
      running = true;
      try {
        while (!closed && (pending || ping)) {
          if (pending) {
            pending = false;
            let hasMore = true;
            while (!closed && hasMore) {
              const page = hub.readAfter(projectId, last, batchSize);
              if (page.kind === "snapshot-required") {
                const reset = streamResetSchema.parse({ apiVersion: API_VERSION, projectId,
                  type: "snapshot-required", reason: page.reason });
                await write(`event: snapshot-required\ndata: ${JSON.stringify(reset)}\n\n`);
                end();
                return;
              }
              for (const event of page.events) {
                if (!await write(`id: ${event.cursor.epoch}:${event.cursor.sequence}\nevent: factory-event\ndata: ${JSON.stringify(event)}\n\n`)) return;
                last = event.cursor;
              }
              hasMore = page.hasMore;
              if (hasMore) await new Promise<void>((resolve) => setImmediate(resolve));
            }
          }
          if (ping && !closed) { ping = false; await write(": ping\n\n"); }
        }
      } catch { end(); }
      finally { running = false; }
    };
    try {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store",
        "Connection": "keep-alive", "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
        "Cross-Origin-Resource-Policy": "same-origin",
      });
      res.flushHeaders();
      // Subscribe before replay, so appends during an awaited write set pending.
      unsubscribe = hub.subscribe(projectId, () => { pending = true; void drain(); });
      timer = setInterval(() => { ping = true; void drain(); }, keepAliveMs);
      timer.unref();
      pending = true;
      void drain();
    } catch { end(); }
    return reply;
  });
}
