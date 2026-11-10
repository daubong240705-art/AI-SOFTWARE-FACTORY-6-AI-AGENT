import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, packs } from "./scenario-m3-fixture.mjs";
import { createFakeRuntime } from "../dist/dispatch/fake-runtime.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { registryEntry } from "../dist/org/registry.js";
import { createWorkflowHandlers } from "../dist/workflow/commands.js";
import { registerWorkflowEngine, sweepWorkflows } from "../dist/workflow/engine.js";
import { workflowInstanceView } from "../dist/workflow/service.js";
import { createScheduleHandlers } from "../dist/schedule/commands.js";
import { tickSchedules } from "../dist/schedule/scheduler.js";
import { createMonitorHandlers } from "../dist/automation/monitorCommands.js";
import { createRuleHandlers } from "../dist/automation/ruleCommands.js";
import { tickRules } from "../dist/automation/rules.js";
import { tickNotifications } from "../dist/notify/tick.js";
import { createStandingApprovalHandlers } from "../dist/standing/commands.js";
import { budgetsSetHandler, recordUsage } from "../dist/policy/budget.js";
import { setAutonomyHandler } from "../dist/policy/autonomy.js";
import { getApprovalView } from "../dist/approvals/service.js";

export const scenario = { timeout: 4900 };
export const oneStage = (key, title = key) => ({ key, revision: 1, title, parameters: [], phases: ["reporting"],
  stages: [{ key: key === "daily-report" ? "report" : "review", title, phase: "reporting",
    requiredCapabilities: ["docs.requirements"], inputs: [], outputs: [] }], edges: [], joins: [], gates: [] });

// Compose E1a's real dispatcher, workspace, MCP output registration, reviews and HTTP reads.
// Only the fake runtime's timers are advanced explicitly. setImmediate drains I/O; no sleeps.
export function e2Fixture(t, options = {}) {
  let time = Date.parse(options.at ?? "2026-11-07T23:59:00.000Z"), serial = 0;
  const clock = () => new Date(time), pending = new Map();
  const timers = { setTimeout(fn) { const id = ++serial; pending.set(id, fn); return id; },
    clearTimeout(id) { pending.delete(id); }, setInterval() { return ++serial; }, clearInterval() {} };
  const runtime = { kind: "fake", started: [], async start(context) {
    runtime.started.push(context);
    return createFakeRuntime({ stepMs: 0, timers: {
      setTimeout(fn) { const id = ++serial; pending.set(id, { fn, attemptId: context.ref.attemptId }); return id; },
      clearTimeout: timers.clearTimeout,
    } }).start(context);
  } };
  const f = fixture(t, { clock, runtime, timers });
  const entries = Object.values(packs).map(pack => registryEntry(pack));
  if (options.definitions?.length) {
    // Data-only test definitions registered in memory; no pack files are edited.
    const pack = { ...packs.software, files: { ...packs.software.files,
      workflows: options.definitions.map(definition => ({ definition })) } };
    entries[0] = registryEntry(pack);
  }
  const deps = { raw: f.raw, hub: f.hub, clock, newId: randomUUID, ...(options.deferDispatch ? {} : { dispatcher: f.dispatcher }) };
  if (options.triggers !== false) registerWorkflowEngine(deps);
  let pipeline;
  const forwarding = { execute: (...args) => pipeline.execute(...args) };
  pipeline = createCommandPipeline({ storage: f.storage, hub: f.hub, clock, handlers: {
    ...createWorkflowHandlers({ packs: entries, engine: deps }),
    ...createScheduleHandlers({ packs: entries, pipeline: forwarding }),
    ...createMonitorHandlers(), ...createRuleHandlers({ packs: entries }),
    ...createStandingApprovalHandlers(), "autonomy.set": setAutonomyHandler, "budgets.set": budgetsSetHandler,
  } });
  const execute = (type, payload = {}, actor = "operator", commandId = randomUUID()) =>
    pipeline.execute({ apiVersion: 1, commandId, projectId: f.projectId, type, payload }, actor);
  const ok = (type, payload, actor) => { const r = execute(type, payload, actor); assert.equal(r.status, 200, `${type}: ${JSON.stringify(r.body)}`); return r; };
  const view = id => workflowInstanceView(f.raw, f.projectId, id);
  const stage = (id, key) => view(id).stages.find(s => s.key === key);
  const task = (id, key) => f.task(stage(id, key).tasks[0]?.taskId);
  const sweep = () => sweepWorkflows(deps);
  async function until(predicate, label = "scenario progress", attemptId) {
    for (let i = 0; i < 200; i++) {
      if (predicate()) return;
      for (const [id, callback] of [...pending]) {
        if (typeof callback === "function" || attemptId === null || (attemptId !== undefined && callback.attemptId !== attemptId)) continue;
        pending.delete(id); callback.fn();
      }
      await new Promise(setImmediate);
    }
    assert.fail(`No progress: ${label}`);
  }
  function create(params = {}, key = "software-delivery") {
    const id = randomUUID(); ok("workflows.create", { instanceId: id, definitionKey: key, packKey: "software-team", params }); return id;
  }
  const command = (type, id, extra = {}) => ok(`workflows.${type}`, { instanceId: id, expectedRevision: view(id).revision, ...extra });
  async function live(id, key) {
    sweep(); const current = task(id, key); assert.ok(current, `task for ${key}`);
    if (current.state === "awaiting-go") f.ok("tasks.release", { taskId: current.id, expectedRevision: current.revision });
    await until(() => f.attempts(current.id).some(a => a.state === "running" && f.context(a.id)), `live ${key}`, null);
    const attempt = f.attempts(current.id).at(-1);
    return { projectId: f.projectId, taskId: current.id, attemptId: attempt.id, epoch: attempt.epoch,
      workspacePath: f.context(attempt.id).workspace.path, allowedModels: [] };
  }
  async function review(id, key) {
    const grant = await live(id, key);
    const definition = JSON.parse(f.raw.prepare("SELECT definition_json FROM workflow_instances WHERE id=?").get(id).definition_json);
    const outputs = definition.stages.find(s => s.key === key).outputs.map(output => f.output(grant, output.kind, `${key} evidence`));
    await until(() => f.task(grant.taskId).state === "in-review", `${key} review`, grant.attemptId);
    assert.equal(f.attempts(grant.taskId).at(-1).runtime, "fake");
    assert.ok(f.raw.prepare("SELECT 1 FROM approvals WHERE task_id=? AND state='pending'").get(grant.taskId));
    return { ...grant, outputs };
  }
  function decide(taskId, optionId = "accept") {
    const row = f.raw.prepare("SELECT id FROM approvals WHERE task_id=? AND state='pending'").get(taskId);
    assert.ok(row); const a = getApprovalView(f.raw, f.projectId, row.id);
    f.ok("approvals.decide", { approvalId: a.id, expectedRevision: a.revision, contextDigest: a.context.digest, optionId, comment: "Scenario verified" });
    sweep(); return a.id;
  }
  async function finish(id, key) { const grant = await review(id, key); decide(grant.taskId); time += 1000; return grant; }
  async function complete(id) {
    for (let i = 0; i < 40 && view(id).state !== "completed"; i++) {
      sweep(); const next = view(id).stages.find(s => s.tasks.length && !["done", "skipped"].includes(s.state));
      assert.ok(next, "workflow can progress"); await finish(id, next.key);
    }
    assert.equal(view(id).state, "completed");
  }
  const schedulerDeps = { raw: f.raw, hub: f.hub, packs: entries, pipeline };
  const rows = () => f.raw.prepare("SELECT * FROM notifications WHERE project_id=? ORDER BY rowid").all(f.projectId);
  const events = () => f.raw.prepare("SELECT body_json FROM event_log WHERE project_id=? ORDER BY sequence").all(f.projectId).map(r => JSON.parse(r.body_json));
  function schedule(patch = {}) {
    const id = randomUUID(); ok("schedules.create", { scheduleId: id, name: "Daily report", kind: "cron", expr: "0 7 * * *",
      timezone: "Asia/Ho_Chi_Minh", missedPolicy: "coalesce-once", concurrency: "skip-if-running",
      action: { definitionKey: "daily-report", packKey: "software-team" }, ...patch }); return id;
  }
  const occurrences = id => f.raw.prepare("SELECT * FROM schedule_occurrences WHERE schedule_id=? ORDER BY scheduled_for").all(id);
  const level = value => ok("autonomy.set", { subject: "project", subjectRef: f.projectId, level: value,
    expectedRevision: f.raw.prepare("SELECT revision FROM autonomy_settings WHERE project_id=? AND subject='project'").get(f.projectId)?.revision ?? null });
  function usage(tokens, taskId = null) {
    const conversationId = randomUUID();
    f.raw.prepare("INSERT INTO conversations (project_id,id,revision,seat_id,title) VALUES (?,?,1,?,'Scenario usage')").run(f.projectId, conversationId, f.seat("software", "Lead").id);
    recordUsage(f.raw, { id: randomUUID(), projectId: f.projectId, taskId, attemptId: null, conversationId,
      provider: "fake", model: "fake", effort: null, usage: null, estimatedTokens: tokens, recordedAt: clock().toISOString() });
  }
  return { ...f, workOk: f.ok, workExecute: f.execute, clock, entries, deps, pipeline, execute, ok, view, stage, stageTask: task, sweep, until, create, command, live, review, decide, finish, complete,
    rows, events, schedule, occurrences, level, usage, schedulerDeps, set: at => { time = Date.parse(at); }, advance: ms => { time += ms; },
    tickSchedules: () => tickSchedules(schedulerDeps, clock()), tickRules: () => tickRules(schedulerDeps, clock()),
    notify: () => tickNotifications({ raw: f.raw, hub: f.hub, pushChannel: options.pushChannel }, clock()) };
}
