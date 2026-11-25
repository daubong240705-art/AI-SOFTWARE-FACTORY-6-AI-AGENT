import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import type { Database } from "better-sqlite3";
import type { Command, EntityRef, FactoryEvent, ToolCallStatus, TraceSpan } from "@factory/contracts";
import { EventHub } from "../events/hub.js";
import { createIdGenerator, type Clock } from "../ids.js";
import type { ToolResult } from "../mcp/tools.js";
import { deterministicUuid } from "../org/service.js";
import type { TokenGrant } from "../proxy/tokens.js";
import { nodeRef, source, usageTotals, type Entity, type NodeKey, type Usage } from "./sources.js";

type Position = { id: string; trace_id: string };
type Stored = Position & { parent_id: string | null; started_at: string; ended_at: string | null; status: string };
type Scope = { projectId: string; parent: Position; target?: Entity; attemptId?: string; taskId?: string; node?: NodeKey };
type Request = { title: string; targetId: string; target?: Entity };
type ChatTransaction = { active: boolean; turns: Map<string, { parent: Position; messageId: string }> };
const recorders = new WeakMap<Database, TraceRecorder>();
export const tracesFor = (raw: Database) => recorders.get(raw);
export const spanId = (kind: TraceSpan["kind"], ref: string) => deterministicUuid(`trace:${kind}:${ref}`);

export function requestFor(command: Command, operator: boolean): Request | undefined {
  switch (command.type) {
    case "chat.send": return { title: command.type, targetId: command.payload.messageId };
    case "flow-runs.start": return { title: command.type, targetId: command.payload.runId, target: { kind: "flow-run", ref: command.payload.runId } };
    case "tasks.create": return operator ? { title: command.type, targetId: command.payload.taskId, target: { kind: "task", ref: command.payload.taskId } } : undefined;
    default: return;
  }
}

function tracedEntity(entity: Pick<EntityRef, "kind" | "id" | "revision">): Entity | undefined {
  switch (entity.kind) {
    case "flow-run": case "task": case "attempt": case "effect": case "approval": return { kind: entity.kind, ref: entity.id };
    case "artifact-version": return { kind: "artifact", ref: `${entity.id}:${entity.revision}` };
    default: return;
  }
}

export class TraceRecorder {
  private readonly scope = new AsyncLocalStorage<Scope>();
  private readonly hubChat = new AsyncLocalStorage<ChatTransaction>();
  private readonly newId: () => string;
  private warned = false;

  constructor(private readonly raw: Database, private readonly clock: Clock, private readonly log = (message: string) => console.error(message)) {
    this.newId = createIdGenerator(clock);
    recorders.set(raw, this);
  }

  private safe<Value>(fn: () => Value): Value | undefined {
    try { return fn(); }
    catch {
      if (!this.warned) {
        this.warned = true;
        try { this.log("Trace recording failed; execution will continue."); } catch { /* Logging must not interrupt execution. */ }
      }
      return undefined;
    }
  }

  private write(projectId: string, span: TraceSpan): Position {
    this.raw.prepare(`INSERT INTO trace_spans VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id,id) DO UPDATE SET title=excluded.title,status=excluded.status,
        started_at=excluded.started_at,ended_at=excluded.ended_at,tokens=excluded.tokens,detail_json=excluded.detail_json`)
      .run(projectId, span.id, span.traceId, span.parentId, span.kind, span.ref, span.title, span.status,
        span.startedAt, span.endedAt, span.tokens, JSON.stringify(span.detail));
    return { id: span.id, trace_id: span.traceId };
  }

  private stored(projectId: string, id: string): Stored | undefined {
    return this.raw.prepare("SELECT id,trace_id,parent_id,started_at,ended_at,status FROM trace_spans WHERE project_id=? AND id=?")
      .get(projectId, id) as Stored | undefined;
  }

  private request(projectId: string, id: string, request: Request, startedAt: string, endedAt: string | null): Position {
    return this.write(projectId, { id, traceId: id, parentId: null, kind: "request", ref: id, title: request.title,
      status: endedAt ? "completed" : "running", startedAt, endedAt, tokens: null, detail: { targetId: request.targetId } });
  }

  begin(projectId: string, commandId: string, request: Request | undefined): Scope | undefined {
    if (!request) return;
    return this.safe(() => {
      if (!this.raw.prepare("SELECT 1 FROM projects WHERE id=?").get(projectId)) return;
      const parent = this.request(projectId, commandId, request, this.clock().toISOString(), null);
      return { projectId, parent, ...(request.target && { target: request.target }) };
    });
  }

  finish(scope: Scope | undefined, failed: boolean): void {
    if (scope) this.safe(() => this.raw.prepare("UPDATE trace_spans SET status=?,ended_at=? WHERE project_id=? AND id=?")
      .run(failed ? "rejected" : "completed", this.clock().toISOString(), scope.projectId, scope.parent.id));
  }

  effects(projectId: string, scope: Scope | undefined, effects: EntityRef[]): void {
    this.within(scope, () => {
      for (const effect of effects) {
        const entity = tracedEntity(effect);
        if (entity) this.entity(projectId, entity);
      }
    });
  }

  within<Value>(scope: Scope | undefined, fn: () => Value): Value { return scope ? this.scope.run(scope, fn) : fn(); }

  withinNode<Value>(projectId: string, key: NodeKey, fn: () => Value): Value {
    const parent = this.entity(projectId, { kind: "node-run", ref: nodeRef(key) });
    return this.within(parent && { projectId, parent, node: key }, fn);
  }

  transaction<Value>(fn: () => Value): Value {
    if (this.hubChat.getStore()?.active) return fn();
    const context: ChatTransaction = { active: true, turns: new Map() };
    return this.hubChat.run(context, () => {
      const before = this.safe(() => (this.raw.prepare("SELECT coalesce(max(rowid),0) latest FROM usage_records").get() as { latest: number }).latest);
      try {
        const value = fn();
        for (const [projectId, turn] of context.turns) this.safe(() => this.syncChat(projectId, turn.messageId, turn.parent, before));
        return value;
      } finally { context.active = false; context.turns.clear(); }
    });
  }

  private syncChat(projectId: string, messageId: string, parent: Position, usageAfter?: number): void {
    this.raw.prepare(`UPDATE trace_spans SET (status,ended_at)=(SELECT state,
      CASE WHEN state NOT IN ('queued','running') THEN updated_at END FROM lead_turns WHERE project_id=? AND id=?)
      WHERE project_id=? AND id=?`).run(projectId, messageId, projectId, parent.id);
    if (usageAfter === undefined) return;
    const rows = this.raw.prepare(`SELECT input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,estimated_tokens
      FROM usage_records u JOIN lead_turns t ON t.project_id=u.project_id AND t.conversation_id=u.conversation_id
      WHERE t.project_id=? AND t.id=? AND u.rowid>? AND u.attempt_id IS NULL`).all(projectId, messageId, usageAfter) as Usage[];
    if (!rows.length) return;
    const usage = usageTotals(rows);
    this.raw.prepare(`UPDATE trace_spans SET tokens=?,detail_json=json_set(detail_json,'$.usage',json(?)) WHERE project_id=? AND id=?`)
      .run(usage.unknownSpans ? null : usage.known, JSON.stringify(usage), projectId, parent.id);
  }

  private chat(projectId: string, messageId: string, since?: string): Position | undefined {
    const existing = this.raw.prepare(`SELECT id,trace_id FROM trace_spans WHERE project_id=? AND kind='request'
      AND title='chat.send' AND json_extract(detail_json,'$.targetId')=? AND status<>'rejected'`).get(projectId, messageId) as Position | undefined;
    if (existing) return existing;
    if (!since) return;
    const row = this.raw.prepare(`SELECT created_at FROM lead_turns WHERE project_id=? AND id=? AND created_at>=?`)
      .get(projectId, messageId, since) as { created_at: string } | undefined;
    if (row) return this.write(projectId, { id: spanId("request", messageId), traceId: spanId("request", messageId), parentId: null,
      kind: "request", ref: messageId, title: "chat.send", status: "completed", startedAt: row.created_at, endedAt: row.created_at,
      tokens: null, detail: { targetId: messageId, historical: true } });
    return;
  }

  private observe(projectId: string, entity: Entity, at: string, fallback?: Position, ancestors = new Set<string>(), historical = false): Position | undefined {
    const { kind, ref } = entity;
    const id = spanId(kind, ref);
    if (ancestors.has(id) || ancestors.size >= 128) return;
    ancestors.add(id);
    const row = source(this.raw, projectId, entity);
    if (!row) return;
    const stored = this.stored(projectId, id);
    const scope = historical ? undefined : this.scope.getStore();
    let parent: Position | undefined;
    if (!stored) {
      if (scope?.projectId === projectId) {
        if (scope.target?.kind === kind && scope.target.ref === ref) parent = scope.parent;
        if (scope.attemptId && ["artifact", "effect", "approval"].includes(kind)
          && (!row.parent || (row.parent.kind === "attempt" && row.parent.ref === scope.attemptId)
            || (kind === "approval" && row.parent.kind === "task" && row.parent.ref === scope.taskId))) parent = scope.parent;
        if (scope.node) {
          if ((!row.parent && (kind === "approval" || kind === "artifact"))
            || (kind === "flow-run" && row.parent?.kind === "flow-run" && row.parent.ref === scope.node.run_id)
            || (kind === "task" && row.parent?.kind === "node-run" && row.parent.ref === nodeRef(scope.node))) parent = scope.parent;
        }
      }
      parent ??= fallback;
      if (!parent && row.parent) {
        const parentId = spanId(row.parent.kind, row.parent.ref);
        parent = this.stored(projectId, parentId) ?? this.observe(projectId, row.parent, at, undefined, ancestors, historical);
        if (!parent) return;
      }
      if (!parent && !["flow-run", "task"].includes(kind)) return;
    }
    const costs = kind === "attempt" ? usageTotals(this.raw.prepare(`SELECT input_tokens,cached_input_tokens,output_tokens,
      reasoning_output_tokens,estimated_tokens FROM usage_records WHERE project_id=? AND attempt_id=?`).all(projectId, ref) as Usage[]) : undefined;
    const startedAt = row.startedAt ?? stored?.started_at ?? at;
    const endedAt = row.endedAt ?? (row.terminal ? (stored?.status === row.status ? stored.ended_at : null) ?? (historical ? null : at) : null);
    return this.write(projectId, { id, traceId: stored?.trace_id ?? parent?.trace_id ?? id,
      parentId: stored ? stored.parent_id : parent?.id ?? null, kind, ref, title: row.title, status: row.status, startedAt, endedAt,
      tokens: costs?.unknownSpans === 0 ? costs.known : null, detail: { ...row.detail, ...(costs && { usage: costs }) } });
  }

  entity(projectId: string, entity: Entity, at?: string, parent?: Entity): Position | undefined {
    return this.safe(() => this.raw.transaction(() => {
      const timestamp = at ?? this.clock().toISOString();
      const fallback = parent && (this.stored(projectId, spanId(parent.kind, parent.ref)) ?? this.observe(projectId, parent, timestamp));
      return this.observe(projectId, entity, timestamp, fallback);
    })());
  }

  event(input: Pick<FactoryEvent, "projectId" | "causationId" | "payload">): Position | undefined {
    if (!this.raw.inTransaction) return;
    if (input.payload.type !== "message.appended" && (input.payload.type !== "entity.changed" || !tracedEntity(input.payload.entity))) return;
    return this.safe(() => this.raw.transaction(() => {
      const { projectId, causationId, payload } = input;
      const context = this.hubChat.getStore();
      if (payload.type === "message.appended") {
        const messageId = payload.message.speaker === "user" ? payload.message.id : causationId;
        const chat = this.chat(projectId, messageId);
        if (chat && context?.active) context.turns.set(projectId, { parent: chat, messageId });
        return chat;
      }
      if (payload.type !== "entity.changed") return;
      const entity = tracedEntity(payload.entity);
      if (!entity) return;
      const chat = entity.kind === "task" ? this.chat(projectId, causationId)
        : entity.kind === "artifact" && context?.active ? context.turns.get(projectId)?.parent : undefined;
      return this.observe(projectId, entity, this.clock().toISOString(), chat);
    })());
  }

  backfill(): void {
    this.safe(() => this.raw.transaction(() => {
      const since = new Date(this.clock().getTime() - 30 * 86_400_000).toISOString();
      this.raw.prepare("UPDATE trace_spans SET status='unknown' WHERE kind='tool-call' AND status='running' AND started_at>=?").run(since);
      const creations = this.raw.prepare(`SELECT c.project_id,c.command_id,c.created_at,t.id FROM command_receipts c
        JOIN json_each(c.response_json,'$.receipt.effects') e JOIN tasks t ON t.project_id=c.project_id AND t.id=json_extract(e.value,'$.id')
        WHERE c.created_at>=? AND c.state='completed' AND json_extract(e.value,'$.kind')='task' AND json_extract(e.value,'$.revision')=1
        AND t.origin_kind='operator' AND t.created_by_agent_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM flow_tasks f WHERE f.project_id=t.project_id AND f.task_id=t.id)
        ORDER BY c.created_at,c.command_id`).all(since) as Array<{ project_id: string; command_id: string; created_at: string; id: string }>;
      for (const row of creations) {
        const task: Entity = { kind: "task", ref: row.id };
        if (this.stored(row.project_id, spanId(task.kind, task.ref)) || this.stored(row.project_id, row.command_id)) continue;
        const root = this.request(row.project_id, row.command_id, { title: "tasks.create", targetId: row.id }, row.created_at, row.created_at);
        this.observe(row.project_id, task, row.created_at, root, new Set(), true);
      }
      const manualRuns = this.raw.prepare(`SELECT project_id,id,created_at FROM flow_runs
        WHERE created_at>=? AND trigger='manual' AND parent_run_id IS NULL`).all(since) as Array<{ project_id: string; id: string; created_at: string }>;
      for (const row of manualRuns) {
        const runId = spanId("flow-run", row.id);
        if (this.stored(row.project_id, runId)) continue;
        const root = this.request(row.project_id, spanId("request", row.id), { title: "flow-runs.start", targetId: row.id }, row.created_at, row.created_at);
        this.observe(row.project_id, { kind: "flow-run", ref: row.id }, row.created_at, root, new Set(), true);
      }
      const events = this.raw.prepare(`SELECT project_id, json_extract(body_json,'$.occurredAt') at,
        json_extract(body_json,'$.causationId') cause,json_extract(body_json,'$.payload.entity.id') id,
        json_extract(body_json,'$.payload.entity.kind') kind,json_extract(body_json,'$.payload.entity.revision') revision
        FROM event_log WHERE json_extract(body_json,'$.occurredAt')>=? AND json_extract(body_json,'$.payload.type')='entity.changed'
        ORDER BY json_extract(body_json,'$.occurredAt'),project_id,sequence`).all(since) as
        Array<{ project_id: string; at: string; cause: string; id: string; kind: EntityRef["kind"]; revision: number }>;
      for (const row of events) {
        const entity = tracedEntity(row);
        if (entity) this.observe(row.project_id, entity, row.at, entity.kind === "task" ? this.chat(row.project_id, row.cause, since) : undefined,
          new Set(), true);
      }
      const pending = this.raw.prepare(`SELECT 'flow-run' kind,project_id,id ref,created_at at FROM flow_runs WHERE created_at>=?
        UNION ALL SELECT 'task',c.project_id,json_extract(effect.value,'$.id'),c.created_at FROM command_receipts c
          JOIN json_each(c.response_json,'$.receipt.effects') effect WHERE c.created_at>=? AND c.state='completed'
          AND json_extract(effect.value,'$.kind')='task' AND json_extract(effect.value,'$.revision')=1
        UNION ALL SELECT 'node-run',n.project_id,n.run_id||':'||n.node_id||':'||n.iteration||':'||n.attempt_no,
          coalesce(n.started_at,r.created_at) FROM flow_node_runs n JOIN flow_runs r ON r.project_id=n.project_id AND r.id=n.run_id
          WHERE r.created_at>=? OR n.started_at>=? OR n.ended_at>=?
        UNION ALL SELECT 'attempt',a.project_id,a.id,coalesce(a.started_at,e.at,a.ended_at,r.created_at) FROM attempts a
          LEFT JOIN attempt_events e ON e.project_id=a.project_id AND e.attempt_id=a.id AND e.seq=1
          LEFT JOIN flow_tasks f ON f.project_id=a.project_id AND f.task_id=a.task_id
          LEFT JOIN flow_runs r ON r.project_id=f.project_id AND r.id=f.run_id
          WHERE a.started_at>=? OR a.ended_at>=? OR e.at>=? OR r.created_at>=?
        UNION ALL SELECT 'artifact',project_id,artifact_id||':'||version,created_at FROM artifact_versions WHERE created_at>=? AND produced_by_attempt_id IS NOT NULL
        UNION ALL SELECT 'effect',project_id,id,created_at FROM effects WHERE created_at>=?
        UNION ALL SELECT 'approval',project_id,id,requested_at FROM approvals WHERE requested_at>=?`)
        .all(since, since, since, since, since, since, since, since, since, since, since, since) as Array<Entity & { project_id: string; at: string }>;
      for (const row of pending) this.observe(row.project_id, row, row.at, undefined, new Set(), true);
      for (const row of this.raw.prepare("SELECT project_id,id FROM lead_turns WHERE created_at>=?").all(since) as Array<{ project_id: string; id: string }>) {
        const root = this.chat(row.project_id, row.id, since);
        if (root) this.syncChat(row.project_id, row.id, root);
      }
    })());
  }

  tool(grant: TokenGrant, name: string, args: unknown, invoke: () => ToolResult | Promise<ToolResult>, builtIn = false): ToolResult | Promise<ToolResult> {
    const start = performance.now();
    const { projectId, attemptId } = grant;
    const call = this.safe(() => this.raw.transaction(() => {
      const parent = this.observe(projectId, { kind: "attempt", ref: attemptId }, this.clock().toISOString());
      if (!parent) return;
      const id = this.newId();
      const createdAt = this.clock().toISOString();
      const label = builtIn || this.raw.prepare(`SELECT 1 FROM integrations i WHERE
        EXISTS (SELECT 1 FROM integration_tools t WHERE t.integration_id=i.id AND 'ext.'||i.name||'.'||t.name=?)
        OR (i.kind='http-api' AND EXISTS (SELECT 1 FROM json_each(i.config_json,'$.operations')
          WHERE 'http.'||i.name||'.'||json_extract(value,'$.name')=?))`).get(name, name) ? name : "unrecognized";
      const position = this.write(projectId, { id, traceId: parent.trace_id, parentId: parent.id, kind: "tool-call", ref: id,
        title: label, status: "running", startedAt: createdAt, endedAt: null, tokens: null, detail: {} });
      return { position, label, createdAt, argsBytes: bytes(args) };
    })());
    if (!call) return invoke();
    const done = (result?: ToolResult) => this.safe(() => this.raw.transaction(() => {
      const status = outcome(result);
      const durationMs = Math.max(0, Math.round(performance.now() - start));
      const resultBytes = result ? bytes(result) : 0;
      const agent = this.raw.prepare("SELECT seat_id FROM attempt_seats WHERE project_id=? AND attempt_id=?")
        .get(projectId, attemptId) as { seat_id: string } | undefined;
      this.raw.prepare("INSERT INTO tool_calls VALUES (?,?,?,?,?,?,?,?,?,?)").run(projectId, call.position.id, attemptId,
        agent?.seat_id ?? null, call.label, status, durationMs, call.argsBytes, resultBytes, call.createdAt);
      this.raw.prepare("UPDATE trace_spans SET status=?,ended_at=?,detail_json=? WHERE project_id=? AND id=?")
        .run(status, this.clock().toISOString(), JSON.stringify({ durationMs, argsBytes: call.argsBytes, resultBytes }), projectId, call.position.id);
    })());
    try {
      const result = this.within({ projectId, parent: call.position, attemptId, taskId: grant.taskId }, invoke);
      if (result instanceof Promise) return result.then((value) => { done(value); return value; }, (error: unknown) => { done(); throw error; });
      done(result);
      return result;
    } catch (error) { done(); throw error; }
  }
}

function bytes(value: unknown): number {
  try { return Buffer.byteLength(JSON.stringify(value) ?? ""); } catch { return 0; }
}

function outcome(result?: ToolResult): ToolCallStatus {
  if (!result || !result.isError) return result ? "ok" : "error";
  const text = result.content[0]?.text;
  if (text === "\u0111ang ch\u1edd ng\u01b0\u1eddi duy\u1ec7t; th\u1eed l\u1ea1i sau khi \u0111\u01b0\u1ee3c duy\u1ec7t") return "ask-pending";
  if (text === "tool is not available" || text === "Ng\u01b0\u1eddi duy\u1ec7t \u0111\u00e3 t\u1eeb ch\u1ed1i y\u00eau c\u1ea7u g\u1ecdi c\u00f4ng c\u1ee5."
    || text === "L\u1ea7n g\u1ecdi \u0111\u00e3 \u0111\u01b0\u1ee3c duy\u1ec7t \u0111\u00e3 \u0111\u01b0\u1ee3c s\u1eed d\u1ee5ng.") return "denied";
  return "error";
}

export class TraceEventHub extends EventHub {
  constructor(raw: Database, private readonly recorder: TraceRecorder, options: ConstructorParameters<typeof EventHub>[1]) { super(raw, options); }

  override transaction<Value>(fn: () => Value): Value { return super.transaction(() => this.recorder.transaction(fn)); }

  override append(input: Parameters<EventHub["append"]>[0]): FactoryEvent {
    const span = this.recorder.event(input);
    return super.append(span ? { ...input, rootCausationId: span.trace_id } : input);
  }
}
