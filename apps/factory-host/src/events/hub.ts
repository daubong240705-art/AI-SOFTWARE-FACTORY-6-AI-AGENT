import type { Database } from "better-sqlite3";
import { API_VERSION, cursorSchema, eventSchema, type Cursor, type FactoryEvent } from "@factory/contracts";
import { createIdGenerator, systemClock, type Clock } from "../ids.js";

export type ReadResult =
  | { kind: "events"; events: FactoryEvent[]; hasMore: boolean }
  | { kind: "snapshot-required"; reason: "expired" | "epoch-changed" | "gap" };

interface EventRow { body_json: string }
const boundedLimit = (limit: number): number => Number.isNaN(limit) ? 100 : Math.max(1, Math.min(500, Math.trunc(limit)));
const parseRow = (row: EventRow): FactoryEvent => eventSchema.parse(JSON.parse(row.body_json));

export class EventHub {
  private readonly clock: Clock;
  private readonly newId: () => string;
  private depth = 0;
  private pending = new Map<string, Cursor>();
  private readonly listeners = new Map<string, Set<(cursor: Cursor) => void>>();

  constructor(private readonly raw: Database, options: { clock?: Clock; newId?: () => string } = {}) {
    this.clock = options.clock ?? systemClock;
    this.newId = options.newId ?? createIdGenerator(this.clock);
  }

  ensureStream(projectId: string): Cursor {
    this.raw.prepare("INSERT INTO project_streams (project_id, epoch) VALUES (?, ?) ON CONFLICT(project_id) DO NOTHING")
      .run(projectId, this.newId());
    return this.currentCursor(projectId) as Cursor;
  }

  currentCursor(projectId: string): Cursor | null {
    const row = this.raw.prepare("SELECT epoch, CAST(last_sequence AS TEXT) AS sequence FROM project_streams WHERE project_id = ?")
      .get(projectId) as Cursor | undefined;
    return row ?? null;
  }

  /** Nested calls join the transaction owned by the outermost hub call. */
  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    const wasInTransaction = this.raw.inTransaction;
    this.pending = new Map();
    this.depth += 1;
    let result: T;
    try {
      result = this.raw.transaction(fn).immediate();
    } catch (error) {
      this.pending.clear();
      throw error;
    } finally {
      this.depth -= 1;
    }
    const notifications = this.pending;
    this.pending = new Map();
    // An externally owned transaction has not committed when its savepoint releases.
    if (!wasInTransaction) {
      for (const [projectId, cursor] of notifications) {
        for (const listener of [...(this.listeners.get(projectId) ?? [])]) {
          try { listener({ ...cursor }); } catch { /* Observers cannot undo a commit. */ }
        }
      }
    }
    return result;
  }

  append(input: { projectId: string; payload: FactoryEvent["payload"]; causationId: string; rootCausationId?: string }): FactoryEvent {
    if (!this.raw.inTransaction) throw new Error("EventHub.append requires an active transaction");
    const previousCursor = this.currentCursor(input.projectId);
    if (!previousCursor) throw new Error(`Project ${input.projectId} has no event stream`);
    const sequence = BigInt(previousCursor.sequence) + 1n;
    const event = eventSchema.parse({
      apiVersion: API_VERSION,
      eventId: this.newId(),
      projectId: input.projectId,
      occurredAt: this.clock().toISOString(),
      cursor: { epoch: previousCursor.epoch, sequence: String(sequence) },
      previousCursor,
      causationId: input.causationId,
      rootCausationId: input.rootCausationId ?? input.causationId,
      payload: input.payload,
    });
    this.raw.transaction(() => {
      this.raw.prepare("INSERT INTO event_log (event_id, project_id, epoch, sequence, body_json) VALUES (?, ?, ?, ?, ?)")
        .run(event.eventId, event.projectId, event.cursor.epoch, sequence, JSON.stringify(event));
      this.raw.prepare("INSERT INTO outbox (event_id, delivered_at, attempts) VALUES (?, NULL, 0)").run(event.eventId);
      this.raw.prepare("UPDATE project_streams SET last_sequence = ? WHERE project_id = ?").run(sequence, event.projectId);
    })();
    if (this.depth > 0) this.pending.set(event.projectId, { ...event.cursor });
    return event;
  }

  readAfter(projectId: string, after: Cursor, limit = 100): ReadResult {
    cursorSchema.parse(after);
    return this.raw.transaction((): ReadResult => {
      const stream = this.currentCursor(projectId);
      if (!stream || stream.epoch !== after.epoch) return { kind: "snapshot-required", reason: "epoch-changed" };
      const sequence = BigInt(after.sequence);
      const last = BigInt(stream.sequence);
      if (sequence > last) return { kind: "snapshot-required", reason: "gap" };
      const oldest = this.raw.prepare("SELECT CAST(MIN(sequence) AS TEXT) AS sequence FROM event_log WHERE project_id = ? AND epoch = ?")
        .get(projectId, stream.epoch) as { sequence: string | null };
      if ((oldest.sequence === null && sequence < last) || (oldest.sequence !== null && BigInt(oldest.sequence) > sequence + 1n))
        return { kind: "snapshot-required", reason: "expired" };
      const size = boundedLimit(limit);
      const rows = this.raw.prepare("SELECT body_json FROM event_log WHERE project_id = ? AND epoch = ? AND sequence > ? ORDER BY sequence LIMIT ?")
        .all(projectId, stream.epoch, sequence, size + 1) as EventRow[];
      return { kind: "events", events: rows.slice(0, size).map(parseRow), hasMore: rows.length > size };
    })();
  }

  subscribe(projectId: string, listener: (cursor: Cursor) => void): () => void {
    let listeners = this.listeners.get(projectId);
    if (!listeners) { listeners = new Set(); this.listeners.set(projectId, listeners); }
    listeners.add(listener);
    return () => { listeners.delete(listener); if (listeners.size === 0) this.listeners.delete(projectId); };
  }

  prune(projectId: string, keepLast: number): number {
    if (!Number.isSafeInteger(keepLast) || keepLast < 1) throw new Error("keepLast must be an integer >= 1");
    return this.raw.transaction(() => {
      const cutoff = this.raw.prepare("SELECT CAST(sequence AS TEXT) AS sequence FROM event_log WHERE project_id = ? ORDER BY event_log.sequence DESC LIMIT 1 OFFSET ?")
        .get(projectId, keepLast - 1) as { sequence: string } | undefined;
      if (!cutoff) return 0;
      const sequence = BigInt(cutoff.sequence);
      this.raw.prepare("DELETE FROM outbox WHERE event_id IN (SELECT event_id FROM event_log WHERE project_id = ? AND sequence < ?)")
        .run(projectId, sequence);
      return this.raw.prepare("DELETE FROM event_log WHERE project_id = ? AND sequence < ?").run(projectId, sequence).changes;
    }).immediate();
  }

  claimUndelivered(limit = 100): FactoryEvent[] {
    return this.raw.transaction(() => {
      const rows = this.raw.prepare("SELECT e.body_json FROM event_log e JOIN outbox o ON o.event_id = e.event_id WHERE o.delivered_at IS NULL ORDER BY e.project_id, e.sequence LIMIT ?")
        .all(boundedLimit(limit)) as EventRow[];
      const events = rows.map(parseRow);
      const update = this.raw.prepare("UPDATE outbox SET attempts = attempts + 1 WHERE event_id = ?");
      for (const event of events) update.run(event.eventId);
      return events;
    }).immediate();
  }

  markDelivered(eventIds: string[]): void {
    this.raw.transaction(() => {
      const at = this.clock().toISOString();
      const update = this.raw.prepare("UPDATE outbox SET delivered_at = ? WHERE event_id = ? AND delivered_at IS NULL");
      for (const id of eventIds) update.run(at, id);
    }).immediate();
  }
}
