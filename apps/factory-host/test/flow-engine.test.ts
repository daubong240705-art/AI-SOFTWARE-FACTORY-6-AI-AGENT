import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { FLOW_RUN_TRANSITIONS, isTerminalFlowRunState, type FlowDefinition } from "@factory/contracts";
import { approvalsDecideHandler, getApprovalView } from "../src/approvals/service.js";
import { createCommandPipeline } from "../src/commands/pipeline.js";
import { appendAttemptEvent, listAttempts, transitionAttempt } from "../src/dispatch/attempts.js";
import { createDispatchHandlers } from "../src/dispatch/commands.js";
import { createDispatcher } from "../src/dispatch/dispatcher.js";
import { ensureLocalNode, LOCAL_NODE_ID } from "../src/dispatch/node.js";
import { RuntimeRegistry } from "../src/dispatch/runtime.js";
import { moveTask } from "../src/dispatch/tasks.js";
import { EventHub } from "../src/events/hub.js";
import { createFlowHandlers, fireFlowTimers, recoverFlows, registerFlowEngine, startFlowTimers } from "../src/flow/index.js";
import { getRun, latestNodes, nodeHistory } from "../src/flow/store.js";
import { activeAgents } from "../src/flow/work.js";
import { loadPack } from "../src/org/pack.js";
import { registryEntry } from "../src/org/registry.js";
import { createProjectsCreateHandler } from "../src/projects/service.js";
import { getTask } from "../src/work/service.js";
import { idFactory, migratedStorage } from "./helpers.js";

const edge = (from: string, to: string, port = "out", loopBack = false) => ({ id: `${from}-${port}-${to}`, from: { node: from, port }, to: { node: to }, loopBack });
const trigger = { id: "start", title: "Start", type: "trigger", trigger: { kind: "manual" } } as const;
const output = (id: string, ...from: string[]) => ({ id, title: id, type: "output", target: "artifact", from });
const definition = (nodes: unknown[], edges: unknown[], key = "fixture", extra: Record<string, unknown> = {}) =>
  ({ schema: 2, key, title: key, nodes: [trigger, ...nodes], edges, ...extra });

function fixture(context: TestContext) {
  const storage = migratedStorage();
  const { raw } = storage;
  const newId = idFactory();
  let time = Date.parse("2026-11-19T10:00:00Z");
  const clock = () => new Date(time);
  const hub = new EventHub(raw, { clock, newId });
  const pack = loadPack(fileURLToPath(new URL("../../../../packs/web-games", import.meta.url)));
  const dispatcher = createDispatcher({ storage, hub, clock, newId, registry: new RuntimeRegistry() });
  context.after(async () => { await dispatcher.stop(); storage.close(); });
  const engine = { raw, hub, clock, newId, dispatcher };
  registerFlowEngine(engine);
  const pipeline = createCommandPipeline({ storage, hub, clock, newId, handlers: { ...createFlowHandlers({ engine, packs: [registryEntry(pack)] }),
    ...createDispatchHandlers({ dispatcher }), "projects.create": createProjectsCreateHandler({ pack }), "approvals.decide": approvalsDecideHandler } });
  const projectId = newId();
  const request = (type: string, payload: unknown) => pipeline.execute({ apiVersion: 1, commandId: newId(), projectId, type, payload });
  const command = (type: string, payload: unknown) => {
    const result = request(type, payload);
    assert.ok(result.body.ok, JSON.stringify(result.body));
    return result.body.receipt;
  };
  command("projects.create", { name: "Flows", workspace: { kind: "git", root: "/projects/flows" } });
  const agents = activeAgents(raw, projectId);
  const agent = (id: string, index = 0, extra: Record<string, unknown> = {}) => ({ id, title: id, type: "agent", agent: { agent: agents[index]!.id },
    task: { title: `${id} {{ inputs.name }}`, instructions: "Do work", acceptance: ["Complete the work"], inputs: [] }, ...extra });
  const create = (draft: unknown) => {
    const flowId = newId(); command("flows.create", { flowId, definition: draft }); return flowId;
  };
  const start = (flowId: string, extra: Record<string, unknown> = {}) => {
    const runId = newId(); command("flow-runs.start", { flowId, runId, version: "draft", ...extra }); return runId;
  };
  const run = (runId: string) => getRun(raw, projectId, runId)!;
  const current = (runId: string, nodeId: string) => latestNodes(raw, run(runId)).get(nodeId)!;
  const history = (runId: string) => nodeHistory(raw, projectId, runId);
  const complete = (runId: string, nodeId: string) => {
    const taskId = current(runId, nodeId).task_id!;
    hub.transaction(() => moveTask(raw, projectId, taskId, "in-review"));
    command("tasks.transition", { taskId, to: "done", expectedRevision: getTask(raw, projectId, taskId)!.revision });
  };
  const fail = (runId: string, nodeId: string) => {
    const taskId = current(runId, nodeId).task_id!;
    const attempt = listAttempts(raw, projectId, taskId).at(-1)!;
    const now = clock().toISOString();
    ensureLocalNode(raw, { slots: 2, now });
    hub.transaction(() => {
      transitionAttempt(raw, { projectId, id: attempt.id }, "leased", { nodeId: LOCAL_NODE_ID, leaseId: newId(), leaseExpiresAt: now, now });
      transitionAttempt(raw, { projectId, id: attempt.id }, "preparing", { now });
      appendAttemptEvent(raw, { projectId, attemptId: attempt.id, at: now, kind: "state", body: { to: "failed", kind: "runtime" } });
      transitionAttempt(raw, { projectId, id: attempt.id }, "failed", { now, endedAt: now });
      moveTask(raw, projectId, taskId, "failed");
    });
  };
  return { raw, engine, newId, agents, projectId, request, command, agent, create, start, run, current, history, complete, fail,
    tick: (ms: number) => { time += ms; }, publish: (flowId: string, expectedRevision = 1) => command("flows.publish", { flowId, expectedRevision }) };
}

test("linear flow creates and dispatches a task for the selected agent", (context) => {
  const fx = fixture(context);
  const draft = definition([fx.agent("work"), output("done", "nodes.work.output")], [edge("start", "work"), edge("work", "done")], "linear",
    { inputs: [{ name: "name", type: "string", required: true }] });
  const flowId = fx.create(draft);
  fx.publish(flowId);
  const runId = fx.start(flowId, { version: "published", inputs: { name: "hello" }, test: true, mockAgents: true });
  const task = getTask(fx.raw, fx.projectId, fx.current(runId, "work").task_id!)!;
  assert.equal(task.ownerSeatId, fx.agents[0]!.id);
  assert.equal(task.title, "work hello");
  assert.equal(task.state, "active");
  assert.equal(listAttempts(fx.raw, fx.projectId, task.id)[0]?.runtime, "fake");
  fx.complete(runId, "work");
  assert.equal(fx.run(runId).state, "succeeded");
  assert.deepEqual(fx.history(runId).find(({ nodeId }) => nodeId === "done")?.output, { "nodes.work.output": { artifacts: [], result: null, summary: null } });
});

test("parallel agent branches join; a real rejection skips only the dead path", (context) => {
  const fx = fixture(context);
  const branches = ["alpha", "beta", "gamma"];
  const runId = fx.start(fx.create(definition([fx.agent("lead"), ...branches.map((name, index) => fx.agent(name, index + 1)),
    { id: "join", type: "join", title: "Join", policy: "all" }, { id: "gate", type: "approval", title: "Gate", approver: "operator", prompt: "Review branches" },
    output("ship", "nodes.join.output"), output("reject", "nodes.gate.output")], [edge("start", "lead"),
    ...branches.flatMap((name) => [edge("lead", name), edge(name, "join")]), edge("join", "gate"), edge("gate", "ship", "approved"), edge("gate", "reject", "rejected")])));
  fx.complete(runId, "lead");
  for (const name of branches) assert.equal(fx.current(runId, name).state, "waiting");
  for (const name of branches) fx.complete(runId, name);
  const joined = JSON.parse(fx.current(runId, "join").output_json!) as Record<string, unknown>;
  assert.deepEqual(Object.keys(joined), branches);
  const approval = getApprovalView(fx.raw, fx.projectId, fx.current(runId, "gate").approval_id!)!;
  fx.command("approvals.decide", { approvalId: approval.id, expectedRevision: approval.revision, contextDigest: approval.context.digest, optionId: "reject", comment: "No" });
  assert.equal(fx.current(runId, "gate").port, "rejected");
  assert.equal(fx.current(runId, "ship").state, "skipped");
  assert.equal(fx.current(runId, "reject").state, "succeeded");
  assert.equal(fx.run(runId).state, "succeeded");
});

test("condition reads pinned structured output and fails on an unknown verdict", (context) => {
  const fx = fixture(context);
  const flow = fx.create(definition([fx.agent("qa"), { id: "check", title: "Check", type: "condition",
    rules: [{ when: { path: "nodes.qa.output.verdict", op: "eq", value: "pass" }, port: "pass" }] }, output("ship", "nodes.qa.output")],
  [edge("start", "qa"), edge("qa", "check"), edge("check", "ship", "pass")]));
  const passes = fx.start(flow, { pinned: { qa: { verdict: "pass" } } });
  assert.equal(fx.current(passes, "qa").pinned, 1);
  assert.equal(fx.current(passes, "qa").task_id, null);
  assert.equal(fx.run(passes).state, "succeeded");
  const unknown = fx.start(flow, { pinned: { qa: {} } });
  assert.equal(fx.run(unknown).state, "failed");
  assert.equal(fx.current(unknown, "check").error, "condition could not be evaluated");
});

test("loopBack keeps each body iteration and exits at the limit", (context) => {
  const fx = fixture(context);
  const runId = fx.start(fx.create(definition([{ id: "loop", title: "Loop", type: "loop", maxIterations: 3 }, fx.agent("body"),
    output("done", "nodes.loop.output.exhausted")], [edge("start", "loop"), edge("loop", "body", "body"), edge("body", "loop", "out", true), edge("loop", "done", "done")])),
  { pinned: { body: { work: true } } });
  assert.deepEqual(fx.history(runId).filter(({ nodeId }) => nodeId === "body").map(({ iteration, state }) => [iteration, state]),
    [[1, "succeeded"], [2, "succeeded"], [3, "succeeded"]]);
  assert.equal(fx.current(runId, "loop").port, "done");
  assert.equal(fx.run(runId).state, "succeeded");
});

test("converted game-build bypasses skipped design and takes the QA pass branch", (context) => {
  const fx = fixture(context);
  const flowId = fx.newId();
  fx.command("flows.import-v1", { flowId, packKey: "web-games", definitionKey: "game-build" });
  const row = fx.raw.prepare("SELECT draft_json,source FROM flows WHERE project_id=? AND id=?").get(fx.projectId, flowId) as { draft_json: string; source: string };
  assert.equal(row.source, "pack:web-games");
  const draft = JSON.parse(row.draft_json) as FlowDefinition;
  const pinned = Object.fromEntries(draft.nodes.filter(({ type }) => type === "agent" || type === "approval").map(({ id }) => [id, { verdict: "accepted" }]));
  const runId = fx.start(flowId, { mockAgents: true, inputs: { runDesign: false }, pinned });
  assert.equal(fx.current(runId, "design").state, "skipped");
  for (const name of ["rules", "art", "client"]) assert.equal(fx.current(runId, name).state, "succeeded", name);
  assert.equal(fx.current(runId, "qa-verdict").port, "else");
  assert.equal(fx.run(runId).state, "succeeded");
});

test("a classified runtime failure retries after backoff; retry-node reopens the same run", (context) => {
  const fx = fixture(context);
  const runId = fx.start(fx.create(definition([fx.agent("work", 0, { retry: { max: 1, backoffSeconds: 5 } }),
    output("done", "nodes.work.output")], [edge("start", "work"), edge("work", "done")])));
  fx.fail(runId, "work");
  assert.equal(fx.run(runId).state, "waiting");
  fx.tick(4999); fireFlowTimers(fx.engine);
  assert.equal(fx.current(runId, "work").attempt_no, 1);
  fx.tick(1); fireFlowTimers(fx.engine);
  assert.equal(fx.current(runId, "work").attempt_no, 2);
  fx.fail(runId, "work");
  assert.equal(fx.run(runId).state, "failed");
  assert.ok(FLOW_RUN_TRANSITIONS.failed.includes("running"));
  assert.ok(isTerminalFlowRunState("failed"));
  fx.command("flow-runs.retry-node", { runId, nodeId: "work", expectedRevision: fx.run(runId).revision });
  assert.equal(fx.current(runId, "work").iteration, 2);
  fx.complete(runId, "work");
  assert.equal(fx.run(runId).state, "succeeded");
});

test("pause blocks downstream nodes; resume starts them and cancel closes work", async (context) => {
  const fx = fixture(context);
  const runId = fx.start(fx.create(definition([fx.agent("first"), fx.agent("second"), output("done", "nodes.second.output")],
    [edge("start", "first"), edge("first", "second"), edge("second", "done")])));
  fx.command("flow-runs.pause", { runId, expectedRevision: fx.run(runId).revision });
  fx.complete(runId, "first");
  assert.equal(fx.current(runId, "second").state, "pending");
  fx.command("flow-runs.resume", { runId, expectedRevision: fx.run(runId).revision });
  const taskId = fx.current(runId, "second").task_id!;
  fx.command("flow-runs.cancel", { runId, expectedRevision: fx.run(runId).revision, reason: "Stop" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(getTask(fx.raw, fx.projectId, taskId)?.state, "cancelled");
  assert.equal(listAttempts(fx.raw, fx.projectId, taskId).at(-1)?.state, "stopped");
  assert.equal(fx.run(runId).state, "cancelled");
});

test("recovery with a new engine is idempotent on a waiting task", (context) => {
  const fx = fixture(context);
  const runId = fx.start(fx.create(definition([fx.agent("work"), output("done", "nodes.work.output")], [edge("start", "work"), edge("work", "done")])));
  const taskId = fx.current(runId, "work").task_id;
  const restarted = { ...fx.engine, hub: new EventHub(fx.raw, { clock: fx.engine.clock, newId: fx.newId }) };
  recoverFlows(restarted); recoverFlows(restarted);
  assert.equal(fx.current(runId, "work").task_id, taskId);
  assert.deepEqual(fx.raw.prepare("SELECT task_id FROM flow_tasks WHERE run_id=?").all(runId), [{ task_id: taskId }]);
  fx.complete(runId, "work");
  assert.equal(fx.run(runId).state, "succeeded");
});

test("wait persists and fires through the injectable timer loop", (context) => {
  const fx = fixture(context);
  const runId = fx.start(fx.create(definition([{ id: "wait", title: "Wait", type: "wait", wait: { for: 1 } },
    output("done", "nodes.wait.output")], [edge("start", "wait"), edge("wait", "done")])));
  let tick = () => {};
  const stop = startFlowTimers(fx.engine, { setInterval(callback, ms) { assert.equal(ms, 5000); tick = callback; return 1; }, clearInterval(handle) { assert.equal(handle, 1); } });
  context.after(stop);
  fx.tick(59999); tick();
  assert.equal(fx.run(runId).state, "waiting");
  fx.tick(1); tick();
  assert.equal(fx.run(runId).state, "succeeded");
});

test("publish returns validation issues and does not duplicate an unchanged version", (context) => {
  const fx = fixture(context);
  const flowId = fx.create(definition([output("done", "nodes.start.output")], []));
  const invalid = fx.request("flows.publish", { flowId, expectedRevision: 1 });
  assert.equal(invalid.status, 400);
  assert.ok(!invalid.body.ok && invalid.body.error.fields?.some(({ path }) => path === "nodes.done"));
  fx.command("flows.save-draft", { flowId, expectedRevision: 1, definition: definition([output("done", "nodes.start.output")], [edge("start", "done")]) });
  fx.publish(flowId, 2); fx.publish(flowId, 3);
  assert.deepEqual(fx.raw.prepare("SELECT version FROM flow_versions WHERE flow_id=?").all(flowId), [{ version: 1 }]);
});

test("parent waits for its child and receives its final outputs", (context) => {
  const fx = fixture(context);
  const child = fx.create(definition([fx.agent("work"), output("done", "inputs.name")], [edge("start", "work"), edge("work", "done")], "child",
    { inputs: [{ name: "name", type: "string", required: true }] }));
  fx.publish(child);
  const runId = fx.start(fx.create(definition([{ id: "sub", title: "Subflow", type: "subflow", workflow: "child", version: 1, inputs: { name: "hello" } },
    output("done", "nodes.sub.output")], [edge("start", "sub"), edge("sub", "done")])));
  const childRun = fx.current(runId, "sub").child_run_id!;
  assert.equal(fx.run(childRun).parent_run_id, runId);
  assert.equal(fx.run(runId).state, "waiting");
  fx.complete(childRun, "work");
  assert.equal(fx.run(runId).state, "succeeded");
  assert.deepEqual(JSON.parse(fx.current(runId, "sub").output_json!), { "inputs.name": "hello" });
});

test("stall preserves waiting work and a queued run starts when the first run finishes", (context) => {
  const fx = fixture(context);
  const flowId = fx.create(definition([{ id: "wait", title: "Wait", type: "wait", wait: { for: 2 } }, output("done", "nodes.wait.output")],
    [edge("start", "wait"), edge("wait", "done")], "queue", { settings: { concurrency: "queue", stallAfterMinutes: 1 } }));
  const first = fx.start(flowId);
  const queued = fx.start(flowId);
  assert.equal(fx.run(queued).state, "queued");
  fx.tick(60_000); fireFlowTimers(fx.engine);
  assert.equal(fx.run(first).state, "stalled");
  assert.equal(fx.current(first, "wait").state, "waiting");
  fx.tick(60_000); fireFlowTimers(fx.engine);
  assert.equal(fx.run(first).state, "succeeded");
  assert.equal(fx.run(queued).state, "waiting");
});

test("a node failure starts the published error workflow immediately", (context) => {
  const fx = fixture(context);
  const errorFlow = fx.create(definition([output("done", "inputs.nodeId", "inputs.error")], [edge("start", "done")], "on-failure"));
  fx.publish(errorFlow);
  const flowId = fx.create(definition([{ id: "action", title: "Action", type: "action", action: "http.request", params: {} }],
    [edge("start", "action")], "broken", { settings: { errorWorkflow: "on-failure" } }));
  const failed = fx.start(flowId);
  const error = fx.raw.prepare("SELECT id FROM flow_runs WHERE project_id=? AND flow_id=? AND trigger='error'").get(fx.projectId, errorFlow) as { id: string };
  assert.equal(fx.run(failed).state, "failed");
  assert.equal(fx.run(error.id).state, "succeeded");
  assert.deepEqual(JSON.parse(fx.current(error.id, "done").output_json!), { "inputs.nodeId": "action", "inputs.error": "action not available yet" });
});
