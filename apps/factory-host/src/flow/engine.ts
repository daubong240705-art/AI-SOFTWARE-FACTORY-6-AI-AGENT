import type { Database } from "better-sqlite3";
import { FLOW_NODE_PORTS, FLOW_RUN_TRANSITIONS, canTransitionTask, idSchema, isTerminalFlowRunState, type FlowDefinition, type FlowEdge, type FlowNode, type FlowRunState } from "@factory/contracts";
import { publicApprovalText, withdrawPendingReviews } from "../approvals/service.js";
import type { UploadDeps } from "../artifacts/uploads.js";
import { CommandError } from "../commands/errors.js";
import { getAttempt, liveAttemptOfTask } from "../dispatch/attempts.js";
import type { Dispatcher } from "../dispatch/dispatcher.js";
import { moveTask } from "../dispatch/tasks.js";
import type { EventHub } from "../events/hub.js";
import type { Clock } from "../ids.js";
import { tracesFor } from "../trace/recorder.js";
import { nodeRef } from "../trace/sources.js";
import { getTask } from "../work/service.js";
import { registerWorkflowLifecycle, withoutWorkflowAdvancement } from "./lifecycle.js";
import { boundedJson, decode, definitionOf, emit, flowByKey, getRun, getVersion, latestNodes, runRef, type FlowRow, type NodeRow, type RunRow, type VersionRow } from "./store.js";
import { evaluate, readPath } from "./expressions.js";
import { bundleStallReason, executeWork, syncWork, type NodeOutcome } from "./work.js";

export interface FlowEngineDeps {
  raw: Database; hub: EventHub; clock: Clock; dispatcher?: Dispatcher; newId: () => string;
  upload?: Pick<UploadDeps, "store" | "config" | "afterRegister">;
  httpAction?: { effects: import("../integrations/http-effects.js").HttpEffects; store: import("../integrations/store.js").IntegrationStore };
  bundleAction?: import("../integrations/bundle-effects.js").BundleEffects;
}
type TimerKind = "wait" | "node-timeout" | "run-timeout" | "retry-backoff" | "approval-timeout";
interface TimerRow { project_id: string; run_id: string; node_id: string; iteration: number; kind: TimerKind; due_at: string }
const active = (row: NodeRow) => ["pending", "ready", "running", "waiting"].includes(row.state);
const minute = 60_000;
const timestamp = (deps: FlowEngineDeps) => deps.clock().toISOString();
const future = (deps: FlowEngineDeps, ms: number) => new Date(Math.min(8.64e15, deps.clock().getTime() + ms)).toISOString();

export function setRun(deps: FlowEngineDeps, run: RunRow, state: FlowRunState, reason: string | null = null): void {
  if (run.state === state && run.state_reason === reason) return;
  if (run.state !== state && !FLOW_RUN_TRANSITIONS[run.state].includes(state)) throw new CommandError("conflict", "invalid run transition", "refresh");
  const ended = isTerminalFlowRunState(state) ? timestamp(deps) : null;
  const started = run.started_at ?? (state === "running" ? timestamp(deps) : null);
  deps.raw.prepare(`UPDATE flow_runs SET state=?,state_reason=?,revision=revision+1,started_at=?,ended_at=? WHERE project_id=? AND id=?`)
    .run(state, reason, started, ended, run.project_id, run.id);
  Object.assign(run, { state, state_reason: reason, revision: run.revision + 1, started_at: started, ended_at: ended });
  emit(deps.hub, run.project_id, run.id, runRef(run));
}

export function arm(deps: FlowEngineDeps, run: RunRow, row: Pick<NodeRow, "node_id" | "iteration">, kind: TimerKind, due: string): void {
  deps.raw.prepare(`INSERT INTO flow_timers VALUES(?,?,?,?,?,?,0) ON CONFLICT(project_id,run_id,node_id,iteration,kind)
    DO UPDATE SET due_at=excluded.due_at,done=0`).run(run.project_id, run.id, row.node_id, row.iteration, kind, due);
}
const runTimer = (node_id: "duration" | "stall") => ({ node_id, iteration: 1 });
function nodeChanged(deps: FlowEngineDeps, run: RunRow): void {
  deps.raw.prepare("UPDATE flow_runs SET revision=revision+1 WHERE project_id=? AND id=?").run(run.project_id, run.id);
  run.revision++;
  emit(deps.hub, run.project_id, run.id, runRef(run));
}
function setNode(deps: FlowEngineDeps, run: RunRow, row: NodeRow, patch: Partial<NodeRow>): void {
  Object.assign(row, patch);
  deps.raw.prepare(`UPDATE flow_node_runs SET state=?,port=?,input_json=?,output_json=?,error=?,task_id=?,approval_id=?,child_run_id=?,pinned=?,started_at=?,ended_at=?
    WHERE project_id=? AND run_id=? AND node_id=? AND iteration=? AND attempt_no=?`).run(row.state, row.port, row.input_json, row.output_json,
    row.error, row.task_id, row.approval_id, row.child_run_id, row.pinned, row.started_at, row.ended_at,
    run.project_id, run.id, row.node_id, row.iteration, row.attempt_no);
  tracesFor(deps.raw)?.entity(run.project_id, { kind: "node-run", ref: nodeRef({ ...row, run_id: run.id }) });
  nodeChanged(deps, run);
}
function addNode(deps: FlowEngineDeps, run: RunRow, nodeId: string, iteration = 1, attempt = 1, round = 1): NodeRow {
  const row: NodeRow = { node_id: nodeId, iteration, attempt_no: attempt, state: "pending", port: null, input_json: JSON.stringify({ round }),
    output_json: null, error: null, task_id: null, approval_id: null, child_run_id: null, pinned: 0, started_at: null, ended_at: null };
  deps.raw.prepare(`INSERT INTO flow_node_runs(project_id,run_id,node_id,iteration,attempt_no,state,input_json) VALUES(?,?,?,?,?,'pending',?)`)
    .run(run.project_id, run.id, nodeId, iteration, attempt, row.input_json);
  tracesFor(deps.raw)?.entity(run.project_id, { kind: "node-run", ref: nodeRef({ ...row, run_id: run.id }) });
  nodeChanged(deps, run);
  return row;
}
function decideEdges(deps: FlowEngineDeps, run: RunRow, def: FlowDefinition, row: NodeRow, deferDone = false): void {
  const write = deps.raw.prepare("INSERT OR REPLACE INTO flow_edge_state VALUES(?,?,?,?,?)");
  for (const edge of def.edges) if (edge.from.node === row.node_id && (!deferDone || edge.from.port !== "done"))
    write.run(run.project_id, run.id, edge.id, row.iteration, Number(edge.from.port === row.port));
}
function edgeDecision(raw: Database, run: RunRow, edge: FlowEdge, nodes: Map<string, NodeRow>): number | undefined {
  const iteration = nodes.get(edge.from.node)?.iteration;
  return (raw.prepare("SELECT fired FROM flow_edge_state WHERE project_id=? AND run_id=? AND edge_id=? AND iteration=?")
    .get(run.project_id, run.id, edge.id, iteration) as { fired: number } | undefined)?.fired;
}
function forward(def: FlowDefinition, roots: string[]): Set<string> {
  const reached = new Set<string>();
  for (const id of roots) {
    if (reached.has(id)) continue;
    reached.add(id);
    for (const edge of def.edges) if (!edge.loopBack && edge.from.node === id) roots.push(edge.to.node);
  }
  return reached;
}
const outgoing = (def: FlowDefinition, id: string, port: string) => def.edges.filter((edge) => !edge.loopBack && edge.from.node === id && edge.from.port === port);
function loopBody(def: FlowDefinition, id: string): string[] {
  const exits = forward(def, outgoing(def, id, "done").map((edge) => edge.to.node));
  return [...forward(def, outgoing(def, id, "body").map((edge) => edge.to.node))].filter((key) => !exits.has(key));
}
const output = (row?: NodeRow) => row?.output_json == null ? null : decode(row.output_json);
const roundOf = (row: NodeRow) => decode<{ round?: number }>(row.input_json ?? "{}").round ?? 1;
export function runOutputs(raw: Database, run: RunRow): Record<string, unknown> {
  const nodes = latestNodes(raw, run);
  return Object.assign(Object.create(null) as Record<string, unknown>, ...definitionOf(run.definition_json).nodes
    .filter((item) => item.type === "output" && nodes.get(item.id)?.state === "succeeded").map((item) => output(nodes.get(item.id))));
}
function context(run: RunRow, nodes: Map<string, NodeRow>, iteration: number) {
  const inputs = decode<Record<string, unknown>>(run.inputs_json);
  return { trigger: { input: inputs }, inputs, loop: { iteration }, run: { id: run.id, test: Boolean(run.test) },
    nodes: Object.fromEntries([...nodes].flatMap(([id, row]) => row.state !== "succeeded" ? [] : [[id,
      { output: output(row), artifacts: readPath(output(row), "artifacts") ?? [], port: row.port }]])) };
}

export function validateInputs(def: FlowDefinition, provided: Record<string, unknown>): Record<string, unknown> {
  const result: Array<[string, unknown]> = [];
  for (const key of Object.keys(provided)) if (!def.inputs.some((input) => input.name === key))
    throw new CommandError("validation", `unknown flow input ${publicApprovalText(key).slice(0, 80)}`, "correct-input");
  for (const input of def.inputs) {
    const value = Object.hasOwn(provided, input.name) ? provided[input.name] : input.default;
    if (value === undefined && !input.required) continue;
    const valid = input.type === "enum" ? typeof value === "string" && input.values?.includes(value)
      : input.type === "bool" ? typeof value === "boolean" : input.type === "number" ? typeof value === "number" && Number.isFinite(value)
        : typeof value === "string" && (input.type !== "artifact" || idSchema.safeParse(value).success);
    if (!valid) throw new CommandError("validation", `invalid or missing flow input ${input.name}`, "correct-input");
    result.push([input.name, value]);
  }
  return Object.fromEntries(result);
}

export function insertRun(deps: FlowEngineDeps, flow: FlowRow, options: {
  id: string; version?: VersionRow; inputs: Record<string, unknown>; pinned?: Record<string, unknown>; test?: boolean;
  mockAgents?: boolean; trigger: string; parent?: { run: RunRow; nodeId: string };
}): RunRow {
  const definition = options.version?.definition_json ?? flow.draft_json;
  const def = definitionOf(definition);
  if (getRun(deps.raw, flow.project_id, options.id)) throw new CommandError("conflict", "run already exists", "correct-input");
  if (flow.archived) throw new CommandError("conflict", "flow is archived", "correct-input");
  if (options.parent && options.parent.run.depth >= 3) throw new CommandError("validation", "sub-workflow depth exceeded", "correct-input");
  const inputs = options.trigger === "error" ? { ...validateInputs(def, Object.fromEntries(Object.entries(options.inputs)
    .filter(([key]) => def.inputs.some(({ name }) => name === key)))), ...options.inputs } : validateInputs(def, options.inputs);
  for (const input of def.inputs) if (input.type === "artifact" && Object.hasOwn(inputs, input.name)
    && !deps.raw.prepare(`SELECT 1 FROM artifact_versions WHERE project_id=? AND artifact_id=? AND status NOT IN ('withdrawn','rejected') LIMIT 1`)
      .get(flow.project_id, inputs[input.name])) throw new CommandError("validation", `artifact input ${input.name} not found in project`, "correct-input");
  const pinned = options.pinned ?? {};
  for (const [id, value] of Object.entries(pinned)) {
    if (!def.nodes.some((item) => item.id === id)) throw new CommandError("validation", `unknown pinned node ${id}`, "correct-input");
    boundedJson(value, 65536);
  }
  const busy = otherRunning(deps.raw, flow.project_id, flow.id, options.id);
  const skipped = busy && def.settings.concurrency === "skip";
  const now = timestamp(deps);
  deps.raw.prepare(`INSERT INTO flow_runs VALUES(?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)`).run(flow.project_id, options.id, flow.id,
    options.version?.version ?? null, Number(options.test ?? false), definition, boundedJson(inputs), boundedJson(pinned), Number(options.mockAgents ?? false),
    skipped ? "cancelled" : "queued", skipped ? "concurrency skip" : null, options.trigger, options.parent?.run.id ?? null,
    options.parent?.nodeId ?? null, options.parent ? options.parent.run.depth + 1 : 0, now, skipped ? now : null);
  const run = getRun(deps.raw, flow.project_id, options.id)!;
  emit(deps.hub, run.project_id, run.id, runRef(run));
  return run;
}
function otherRunning(raw: Database, projectId: string, flowId: string, runId: string): boolean {
  return Boolean(raw.prepare(`SELECT 1 FROM flow_runs WHERE project_id=? AND flow_id=? AND id<>?
    AND state IN ('running','waiting','paused','stalled') LIMIT 1`).get(projectId, flowId, runId));
}
function clearTimers(deps: FlowEngineDeps, run: RunRow, row?: NodeRow): void {
  if (row) deps.raw.prepare("UPDATE flow_timers SET done=1 WHERE project_id=? AND run_id=? AND node_id=? AND iteration=? AND kind<>'run-timeout'")
    .run(run.project_id, run.id, row.node_id, row.iteration);
  else deps.raw.prepare("UPDATE flow_timers SET done=1 WHERE project_id=? AND run_id=?").run(run.project_id, run.id);
}

export function stopTasks(deps: FlowEngineDeps, run: RunRow, cancel: boolean, row?: NodeRow): void {
  const tasks = deps.raw.prepare(`SELECT task_id FROM flow_tasks WHERE project_id=? AND run_id=?
    AND (? IS NULL OR (node_id=? AND iteration=?))`).all(run.project_id, run.id, row?.node_id ?? null, row?.node_id ?? null, row?.iteration ?? null) as { task_id: string }[];
  withoutWorkflowAdvancement(deps.raw, () => {
    for (const { task_id } of tasks) {
      const attempt = liveAttemptOfTask(deps.raw, run.project_id, task_id);
      if (cancel) {
        const task = getTask(deps.raw, run.project_id, task_id);
        if (task && task.state !== "failed" && canTransitionTask(task.state, "cancelled")) {
          for (const entity of withdrawPendingReviews(deps.raw, run.project_id, task_id, deps.clock())) emit(deps.hub, run.project_id, run.id, entity);
          const next = moveTask(deps.raw, run.project_id, task_id, "cancelled", { now: timestamp(deps) });
          emit(deps.hub, run.project_id, run.id, { kind: "task", id: task_id, revision: next.revision });
        }
      }
      if (attempt && deps.dispatcher) queueMicrotask(() => {
        if (!deps.raw.open) return;
        const task = getTask(deps.raw, run.project_id, task_id);
        if (cancel ? task?.state === "cancelled" : getRun(deps.raw, run.project_id, run.id)?.state === "paused")
          void deps.dispatcher!.stopAttempt(run.project_id, attempt.id).catch(() => {});
      });
    }
  });
}
function closeApproval(deps: FlowEngineDeps, run: RunRow, id: string, state: "withdrawn" | "expired"): void {
  const row = deps.raw.prepare(`UPDATE approvals SET state=?,revision=revision+1 WHERE project_id=? AND id=? AND state='pending' RETURNING revision`)
    .get(state, run.project_id, id) as { revision: number } | undefined;
  if (row) emit(deps.hub, run.project_id, run.id, { kind: "approval", id, revision: row.revision });
}
function closeNodeWork(deps: FlowEngineDeps, run: RunRow, row: NodeRow): void {
  clearTimers(deps, run, row);
  if (row.task_id) stopTasks(deps, run, true, row);
  if (row.approval_id) closeApproval(deps, run, row.approval_id, "withdrawn");
  if (row.child_run_id) {
    const child = getRun(deps.raw, run.project_id, row.child_run_id);
    if (child && !isTerminalFlowRunState(child.state)) cancelRun(deps, child, "parent node closed");
  }
}
export function cancelRun(deps: FlowEngineDeps, run: RunRow, reason: string): void {
  setRun(deps, run, "cancelled", reason);
  clearTimers(deps, run);
  for (const row of latestNodes(deps.raw, run).values()) if (active(row)) {
    closeNodeWork(deps, run, row);
    setNode(deps, run, row, { state: "cancelled", ended_at: timestamp(deps) });
  }
}
function failRun(deps: FlowEngineDeps, run: RunRow, def: FlowDefinition, reason: string, nodeId?: string): void {
  if (run.state === "stalled") setRun(deps, run, "running");
  setRun(deps, run, "failed", reason.slice(0, 500));
  const key = def.settings.errorWorkflow;
  if (!key || run.trigger === "error") return;
  const flow = flowByKey(deps.raw, run.project_id, key);
  const version = flow && getVersion(deps.raw, run.project_id, flow.id);
  if (flow && version) {
    try {
      insertRun(deps, flow, { id: deps.newId(), version, trigger: "error", test: Boolean(run.test),
        mockAgents: Boolean(run.mock_agents), inputs: { runId: run.id, nodeId: nodeId ?? "", error: publicApprovalText(reason).slice(0, 500) } });
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
      setRun(deps, run, "failed", `${reason}; error workflow could not start`.slice(0, 500));
    }
  }
}

function finish(deps: FlowEngineDeps, run: RunRow, def: FlowDefinition, item: FlowNode, row: NodeRow, result: NodeOutcome): void {
  if (result.kind === "stalled") {
    const outputJson = boundedJson(result.output, 65536);
    if (row.output_json !== outputJson) setNode(deps, run, row, { output_json: outputJson });
    return;
  }
  if (result.kind === "waiting") {
    setNode(deps, run, row, { state: "waiting", ...result.patch });
    return;
  }
  clearTimers(deps, run, row);
  if (result.kind === "failed") {
    const warnings = decode<{ missing?: string[] }>(row.input_json ?? "{}").missing;
    const reason = publicApprovalText(result.error).slice(0, 500);
    const error = (warnings?.length ? `${reason}; unknown template path: ${warnings.join(", ")}` : reason).slice(0, 2000);
    if (row.approval_id) {
      closeApproval(deps, run, row.approval_id, "withdrawn");
      stopTasks(deps, run, true, row);
    }
    if (result.retryable && item.retry && row.attempt_no <= item.retry.max) {
      setNode(deps, run, row, { state: "failed", error, ended_at: timestamp(deps) });
      arm(deps, run, row, "retry-backoff", future(deps, item.retry.backoffSeconds * 1000));
      return;
    }
    if (item.onError === "continue" || item.onError === "port" || result.errorPort) {
      setNode(deps, run, row, { state: "succeeded", error, port: item.onError === "continue" && !result.errorPort ? "out" : "error", output_json: boundedJson(result.output ?? { error: reason }), ended_at: timestamp(deps) });
      decideEdges(deps, run, def, row);
      return;
    }
    setNode(deps, run, row, { state: "failed", error, ended_at: timestamp(deps),
      ...(result.output === undefined ? {} : { output_json: boundedJson(result.output) }) });
    failRun(deps, run, def, reason, item.id);
    return;
  }
  let outputJson: string;
  try { outputJson = boundedJson(result.output ?? null, 65536); }
  catch { finish(deps, run, def, item, row, { kind: "failed", error: "node output exceeds 64 KiB" }); return; }
  if (row.approval_id && row.task_id) stopTasks(deps, run, true, row);
  setNode(deps, run, row, { state: "succeeded", port: result.port, output_json: outputJson, pinned: Number(result.pinned ?? false), ended_at: timestamp(deps) });
  decideEdges(deps, run, def, row, item.type === "loop" && result.port === "body");
}

function runNode(deps: FlowEngineDeps, run: RunRow, def: FlowDefinition, item: FlowNode, row: NodeRow, nodes: Map<string, NodeRow>, fired: FlowEdge[]): void {
  const round = roundOf(row);
  const ctx = context(run, nodes, item.type === "loop" ? round : row.iteration);
  setNode(deps, run, row, { state: "running", started_at: timestamp(deps) });
  const ok = (port: string | null, value: unknown): NodeOutcome => ({ kind: "done", port, output: value });
  const pinned = decode<Record<string, unknown>>(run.pinned_json);
  let result: NodeOutcome;
  if (Object.hasOwn(pinned, item.id)) {
    const ports = FLOW_NODE_PORTS(item);
    const port = readPath(pinned[item.id], "port");
    result = { kind: "done", port: typeof port === "string" && ports.includes(port) ? port : ports[0] ?? null,
      output: pinned[item.id], pinned: true };
  } else switch (item.type) {
    case "trigger": result = ok("out", ctx.trigger.input); break;
    case "condition": {
      result = ok("else", null);
      for (const rule of item.rules) {
        const value = evaluate(rule.when, ctx);
        if (value === "unknown") { result = { kind: "failed", error: "condition could not be evaluated" }; break; }
        if (value === "true") { result = ok(rule.port, null); break; }
      }
      break;
    }
    case "join": {
      const quorum = typeof item.policy === "object" ? item.policy.quorum : 1;
      result = fired.length < quorum ? { kind: "failed", error: "join quorum not reached" } : ok("out", item.merge === "list"
        ? fired.map((edge) => output(nodes.get(edge.from.node))) : Object.fromEntries(fired.map((edge) => [edge.from.node, output(nodes.get(edge.from.node))])));
      break;
    }
    case "loop": {
      const until = item.until && evaluate(item.until, ctx) === "true";
      result = until || round > item.maxIterations ? ok("done", { exhausted: !until }) : ok("body", { iteration: round });
      break;
    }
    case "output": result = ok(null, Object.fromEntries(item.from.map((path) => [path, readPath(ctx, path) ?? null]))); break;
    default: {
      const missing = new Set<string>();
      try {
        const trace = tracesFor(deps.raw), execute = deps.raw.transaction(() => executeWork(deps, run, def, item, row, ctx, fired, missing));
        result = trace ? trace.withinNode(run.project_id, { ...row, run_id: run.id }, execute) : execute();
      }
      catch (error) {
        if (!(error instanceof CommandError)) throw error;
        result = { kind: "failed", error: error.message };
      }
      if (missing.size) {
        row.input_json = boundedJson({ round, missing: [...missing].map((path) => publicApprovalText(path).slice(0, 200)).slice(0, 20) });
      }
    }
  }
  if (result.kind === "waiting" && item.type !== "approval" && !(item.type === "action" && item.action === "bundle.publish") && item.timeoutMinutes)
    arm(deps, run, row, "node-timeout", future(deps, item.timeoutMinutes * minute));
  finish(deps, run, def, item, row, result);
}

const busyRuns = new WeakMap<Database, Set<string>>();
export function advanceRun(deps: FlowEngineDeps, projectId: string, runId: string): void {
  const busy = busyRuns.get(deps.raw) ?? new Set<string>();
  busyRuns.set(deps.raw, busy);
  const key = `${projectId}/${runId}`;
  if (busy.has(key)) return;
  busy.add(key);
  try { deps.hub.transaction(() => {
    const run = getRun(deps.raw, projectId, runId);
    if (!run || isTerminalFlowRunState(run.state) || run.state === "paused") return;
    const def = definitionOf(run.definition_json);
    if (run.state === "queued") {
      if (def.settings.concurrency !== "allow" && otherRunning(deps.raw, projectId, run.flow_id, run.id)) return;
      setRun(deps, run, "running");
      if (def.settings.maxDurationMinutes) arm(deps, run, runTimer("duration"), "run-timeout", future(deps, def.settings.maxDurationMinutes * minute));
    }
    const initialRevision = run.revision;
    const nodes = latestNodes(deps.raw, run);
    for (const item of def.nodes) if (!nodes.has(item.id)) nodes.set(item.id, addNode(deps, run, item.id));
    let steps = 0;
    let changed = true;
    let stalledReason: string | undefined;
    while (changed && !isTerminalFlowRunState(run.state) && steps < 1000) {
      changed = false;
      for (const item of def.nodes) {
        if (steps >= 1000 || isTerminalFlowRunState(run.state)) break;
        const row = nodes.get(item.id)!;
        const incoming = def.edges.filter((edge) => edge.to.node === item.id && !edge.loopBack);
        if (row.state === "pending") {
          const decisions = incoming.map((edge) => edgeDecision(deps.raw, run, edge, nodes));
          if (decisions.includes(undefined)) continue;
          if (item.type === "trigger" || roundOf(row) > 1 || decisions.includes(1)) setNode(deps, run, row, { state: "ready" });
          else { setNode(deps, run, row, { state: "skipped", ended_at: timestamp(deps) }); decideEdges(deps, run, def, row); }
        } else if (row.state === "ready") {
          runNode(deps, run, def, item, row, nodes, incoming.filter((edge) => edgeDecision(deps.raw, run, edge, nodes) === 1));
        } else if (row.state === "waiting") {
          const result = syncWork(deps, run, def, item, row);
          if (!result) continue;
          finish(deps, run, def, item, row, result);
          if (result.kind === "stalled") { stalledReason = result.reason; continue; }
        } else if (item.type === "loop" && row.state === "succeeded" && row.port === "body") {
          const back = def.edges.filter((edge) => edge.loopBack && edge.to.node === item.id);
          const decisions = back.map((edge) => edgeDecision(deps.raw, run, edge, nodes));
          const body = loopBody(def, item.id);
          if (decisions.includes(undefined) || body.some((id) => active(nodes.get(id)!))) continue;
          if (decisions.includes(1)) {
            const next = addNode(deps, run, item.id, row.iteration + 1, 1, roundOf(row) + 1);
            next.state = "ready";
            setNode(deps, run, next, { state: "ready" });
            const until = item.until && evaluate(item.until, context(run, nodes, roundOf(next))) === "true";
            if (!until && roundOf(next) <= item.maxIterations) for (const id of body)
              nodes.set(id, addNode(deps, run, id, nodes.get(id)!.iteration + 1));
            else {
              nodes.set(item.id, next);
              finish(deps, run, def, item, next, { kind: "done", port: "done", output: { exhausted: !until } });
            }
            nodes.set(item.id, next);
          } else {
            const exits = outgoing(def, item.id, "done");
            if (!exits.some((edge) => edgeDecision(deps.raw, run, edge, nodes) === undefined)) continue;
            for (const edge of exits) deps.raw.prepare("INSERT INTO flow_edge_state VALUES(?,?,?,?,0)").run(projectId, runId, edge.id, row.iteration);
          }
        } else continue;
        steps++; changed = true;
      }
    }
    if (isTerminalFlowRunState(run.state)) return;
    if (stalledReason) { setRun(deps, run, "stalled", stalledReason); return; }
    if (run.state === "stalled" && run.state_reason === bundleStallReason) setRun(deps, run, "running");
    const pendingRetry = deps.raw.prepare("SELECT 1 FROM flow_timers WHERE project_id=? AND run_id=? AND kind='retry-backoff' AND done=0 LIMIT 1").get(projectId, runId);
    if (steps >= 1000 && changed) { failRun(deps, run, def, "engine step limit"); return; }
    if (run.state === "stalled" && run.revision !== initialRevision) setRun(deps, run, "running");
    if (!pendingRetry && [...nodes.values()].every((row) => !active(row))) {
      const failed = [...nodes.values()].find((row) => row.state === "failed");
      if (failed) { failRun(deps, run, def, failed.error ?? "node failed", failed.node_id); return; }
      if (run.state === "stalled") setRun(deps, run, "running");
      setRun(deps, run, "succeeded"); clearTimers(deps, run); return;
    }
    if (run.state !== "stalled") setRun(deps, run, "waiting");
    if (def.settings.stallAfterMinutes && run.revision !== initialRevision)
      arm(deps, run, runTimer("stall"), "run-timeout", future(deps, def.settings.stallAfterMinutes * minute));
  }); } finally { busy.delete(key); }
}

export function retryNode(deps: FlowEngineDeps, run: RunRow, nodeId: string): void {
  const nodes = latestNodes(deps.raw, run);
  const row = nodes.get(nodeId);
  if (!row || !["failed", "succeeded"].includes(row.state) || !["failed", "paused", "running", "waiting"].includes(run.state))
    throw new CommandError("conflict", "node cannot be retried", "refresh");
  const def = definitionOf(run.definition_json);
  const reset = forward(def, [nodeId]);
  for (const id of reset) {
    const iteration = nodes.get(id)!.iteration;
    const uncertain = deps.raw.prepare(`SELECT 1 FROM flow_tasks f JOIN attempts a ON a.project_id=f.project_id AND a.task_id=f.task_id
      WHERE f.project_id=? AND f.run_id=? AND f.node_id=? AND f.iteration=? AND a.state IN ('unknown','lease-expired','reconciling') LIMIT 1`)
      .get(run.project_id, run.id, id, iteration);
    if (uncertain) throw new CommandError("conflict", "attempt outcome is unknown; reconcile before retrying", "reconcile");
  }
  const wasFailed = run.state === "failed";
  setRun(deps, run, "running");
  for (const id of reset) {
    const old = nodes.get(id)!;
    closeNodeWork(deps, run, old);
    if (active(old)) setNode(deps, run, old, { state: "cancelled", ended_at: timestamp(deps) });
    addNode(deps, run, id, old.iteration + 1, id === nodeId && def.nodes.some((item) => item.id === id && item.type === "loop") ? roundOf(old) : 1);
  }
  if (wasFailed && def.settings.maxDurationMinutes) arm(deps, run, runTimer("duration"), "run-timeout", future(deps, def.settings.maxDurationMinutes * minute));
  advanceProject(deps, run.project_id);
}

export function advanceProject(deps: FlowEngineDeps, projectId: string): void {
  deps.hub.transaction(() => {
    const select = deps.raw.prepare(`SELECT id,revision FROM flow_runs WHERE project_id=? AND state NOT IN ('succeeded','failed','cancelled','paused')
      ORDER BY CASE state WHEN 'queued' THEN 1 ELSE 0 END,depth DESC,created_at,rowid`);
    let runs = select.all(projectId) as { id: string; revision: number }[];
    for (let pass = 0; runs.length && pass < 1000; pass++) {
      for (const row of runs) advanceRun(deps, projectId, row.id);
      const next = select.all(projectId) as typeof runs;
      if (next.length === runs.length && next.every((row, index) => row.id === runs[index]?.id && row.revision === runs[index]?.revision)) break;
      runs = next;
    }
  });
}
export function fireFlowTimers(deps: FlowEngineDeps, projectId?: string): void {
  deps.hub.transaction(() => {
    const due = deps.raw.prepare(`SELECT t.* FROM flow_timers t JOIN flow_runs r ON r.project_id=t.project_id AND r.id=t.run_id
      WHERE t.done=0 AND t.due_at<=? AND (? IS NULL OR t.project_id=?) AND r.state NOT IN ('succeeded','failed','cancelled','paused','queued')
      ORDER BY t.due_at,CASE t.kind WHEN 'wait' THEN 0 WHEN 'run-timeout' THEN 2 ELSE 1 END,t.project_id,t.run_id,t.node_id`)
      .all(timestamp(deps), projectId ?? null, projectId ?? null) as TimerRow[];
    for (const timer of due) {
      const run = getRun(deps.raw, timer.project_id, timer.run_id)!;
      if (isTerminalFlowRunState(run.state) || (run.state === "stalled" && run.state_reason === bundleStallReason)) continue;
      const changed = deps.raw.prepare("UPDATE flow_timers SET done=1 WHERE project_id=? AND run_id=? AND node_id=? AND iteration=? AND kind=? AND due_at=? AND done=0")
        .run(timer.project_id, timer.run_id, timer.node_id, timer.iteration, timer.kind, timer.due_at);
      if (!changed.changes) continue;
      const def = definitionOf(run.definition_json);
      if (timer.kind === "run-timeout") {
        if (timer.node_id === "duration") {
          for (const row of latestNodes(deps.raw, run).values()) if (active(row)) {
            closeNodeWork(deps, run, row); setNode(deps, run, row, { state: "cancelled", ended_at: timestamp(deps) });
          }
          failRun(deps, run, def, "run timeout");
          clearTimers(deps, run);
        } else setRun(deps, run, "stalled", "no node progress");
      } else {
        const row = latestNodes(deps.raw, run).get(timer.node_id);
        if (!row || row.iteration !== timer.iteration) continue;
        const item = def.nodes.find((entry) => entry.id === row.node_id)!;
        if (timer.kind === "retry-backoff" && row.state === "failed") {
          const tasks = deps.raw.prepare(`SELECT task_id FROM flow_tasks WHERE project_id=? AND run_id=? AND node_id=? AND iteration=?`)
            .all(run.project_id, run.id, row.node_id, row.iteration) as { task_id: string }[];
          const live = tasks.flatMap(({ task_id }) => liveAttemptOfTask(deps.raw, run.project_id, task_id) ?? []);
          if (live.some((attempt) => attempt.outcome === "unknown" || ["unknown", "lease-expired", "reconciling"].includes(attempt.state))) {
            failRun(deps, run, def, "attempt outcome is unknown; reconcile before retrying", item.id);
          } else if (live.length) {
            arm(deps, run, row, "retry-backoff", future(deps, 5000));
            if (deps.dispatcher) for (const attempt of live) queueMicrotask(() => {
              if (deps.raw.open && getAttempt(deps.raw, run.project_id, attempt.id)?.revision === attempt.revision)
                void deps.dispatcher!.stopAttempt(run.project_id, attempt.id).catch(() => {});
            });
          } else addNode(deps, run, row.node_id, row.iteration, row.attempt_no + 1, roundOf(row));
        }
        else if (row.state === "waiting") {
          if (timer.kind === "wait") finish(deps, run, def, item, row, { kind: "done", port: "out", output: null });
          if (timer.kind === "node-timeout") {
            closeNodeWork(deps, run, row);
            finish(deps, run, def, item, row, { kind: "failed", error: "timeout", retryable: true });
          }
          if (timer.kind === "approval-timeout" && row.approval_id) {
            closeApproval(deps, run, row.approval_id, "expired");
            const result = syncWork(deps, run, def, item, row);
            if (result) finish(deps, run, def, item, row, result);
          }
        }
        if (run.state === "stalled") setRun(deps, run, "running");
        if (def.settings.stallAfterMinutes && !isTerminalFlowRunState(run.state))
          arm(deps, run, runTimer("stall"), "run-timeout", future(deps, def.settings.stallAfterMinutes * minute));
      }
      advanceProject(deps, run.project_id);
    }
  });
}
export function recoverFlows(deps: FlowEngineDeps): void {
  deps.hub.transaction(() => {
    const projects = deps.raw.prepare("SELECT DISTINCT project_id FROM flow_runs WHERE state NOT IN ('succeeded','failed','cancelled') ORDER BY project_id").all() as { project_id: string }[];
    for (const row of projects) advanceProject(deps, row.project_id);
    fireFlowTimers(deps);
  });
}
export function registerFlowEngine(deps: FlowEngineDeps): void {
  registerWorkflowLifecycle(deps.raw, (projectId) => advanceProject(deps, projectId));
}
export function startFlowTimers(deps: FlowEngineDeps, timers?: Pick<import("../dispatch/dispatcher.js").Timers, "setInterval" | "clearInterval">): () => void {
  const tick = () => { try { fireFlowTimers(deps); } catch { console.error("Flow timer sweep failed"); } };
  if (timers) { const handle = timers.setInterval(tick, 5000); return () => timers.clearInterval(handle); }
  const handle = setInterval(tick, 5000).unref();
  return () => clearInterval(handle);
}
