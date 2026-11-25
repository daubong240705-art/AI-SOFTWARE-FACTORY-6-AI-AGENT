import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import type { AgentConfigInput } from "@factory/contracts";
import { approvalsDecideHandler, getApprovalView } from "../src/approvals/service.js";
import { createCollaborationMcp, withCollaborationApprovalEffects } from "../src/collab/service.js";
import { sweepWakeups } from "../src/collab/wakeups.js";
import { createCommandPipeline } from "../src/commands/pipeline.js";
import { listAttempts, transitionAttempt } from "../src/dispatch/attempts.js";
import { startTask } from "../src/dispatch/advance.js";
import { createDispatchHandlers } from "../src/dispatch/commands.js";
import { createDispatcher } from "../src/dispatch/dispatcher.js";
import { ensureLocalNode, LOCAL_NODE_ID } from "../src/dispatch/node.js";
import { RuntimeRegistry, type RuntimeEvent } from "../src/dispatch/runtime.js";
import { moveTask } from "../src/dispatch/tasks.js";
import { EventHub } from "../src/events/hub.js";
import { createFlowHandlers, registerFlowEngine } from "../src/flow/index.js";
import { getRun, latestNodes } from "../src/flow/store.js";
import { createMcpHandler } from "../src/mcp/rpc.js";
import { createToolPolicy } from "../src/mcp/policy.js";
import { createAgentHandlers } from "../src/org/agent-commands.js";
import { currentAgentConfig } from "../src/org/agents.js";
import type { TokenGrant } from "../src/proxy/tokens.js";
import { openStorage } from "../src/storage/database.js";
import { getTask, tasksCreateHandler } from "../src/work/service.js";
import { idFactory, MIGRATIONS_DIR } from "./helpers.js";

type Script = (grant: TokenGrant) => AsyncIterable<RuntimeEvent>;
type Reply = { isError: boolean; data: Record<string, unknown> };

function fixture(t: TestContext) {
  const storage = openStorage(":memory:");
  const { raw } = storage;
  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort())
    raw.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  const newId = idFactory();
  const clock = () => new Date();
  const hub = new EventHub(raw, { clock, newId });
  const projectId = newId();
  const scripts = new Map<string, Script>();
  const scriptErrors: unknown[] = [];
  function grantFor(taskId: string, attemptId: string, epoch: number): TokenGrant {
    return { projectId, taskId, attemptId, epoch, allowedModels: [], expiresAt: Date.now() + 3600000 };
  }
  const registry = new RuntimeRegistry([{ kind: "fake", async start(context) {
    const grant = grantFor(context.task.id, context.ref.attemptId, context.ref.epoch);
    const script = scripts.get(context.seat.id);
    const events = async function* (): AsyncIterable<RuntimeEvent> {
      try {
        if (script) yield* script(grant);
        else yield { type: "completed", summary: "Finished" };
      } catch (error) { scriptErrors.push(error); throw error; }
    };
    return { events, async stop() {} };
  } }]);
  const dispatcher = createDispatcher({ storage, hub, registry, clock, newId, onInReview() {} });
  t.after(async () => { await dispatcher.stop(); storage.close(); });
  const engine = { raw, hub, clock, newId, dispatcher };
  registerFlowEngine(engine);
  const pipeline = createCommandPipeline({ storage, hub, clock, newId, handlers: { ...createAgentHandlers(),
    ...createFlowHandlers({ engine }), ...createDispatchHandlers({ dispatcher }), "approvals.decide": withCollaborationApprovalEffects(approvalsDecideHandler),
    "tasks.create": tasksCreateHandler } });
  function command(type: string, payload: unknown) {
    const { body } = pipeline.execute({ apiVersion: 1, commandId: newId(), projectId, type, payload });
    assert.ok(body.ok, JSON.stringify(body));
    return body.receipt;
  }
  command("projects.create", { name: "Collaboration", workspace: { kind: "directory", root: "/projects/collaboration" } });
  const mcp = createMcpHandler({ collaboration: createCollaborationMcp(engine), toolPolicy: createToolPolicy(raw), progress() {},
    registerOutput() { throw new Error("not configured"); }, requestDecision() { throw new Error("not configured"); } });
  async function call(grant: TokenGrant, name: string, args: unknown): Promise<Reply> {
    const response = await mcp.handle(grant, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    const { result } = response.body as { result?: { isError: boolean; content: [{ text: string }] } };
    assert.ok(result, JSON.stringify(response.body));
    try { return { isError: result.isError, data: JSON.parse(result.content[0].text) as Record<string, unknown> }; }
    catch { return { isError: result.isError, data: { reason: result.content[0].text } }; }
  }
  async function request(grant: TokenGrant, name: string, args: unknown) {
    const reply = await call(grant, name, args);
    assert.equal(reply.isError, false, JSON.stringify(reply.data));
    return reply.data;
  }
  async function refuses(grant: TokenGrant, name: string, args: unknown, reason: string) {
    const reply = await call(grant, name, args);
    assert.equal(reply.isError, true, JSON.stringify(reply.data));
    assert.equal(reply.data.reason, reason);
  }
  const agent = (name: string, delegation: AgentConfigInput["delegation"] = {}) => {
    const agentId = newId();
    command("agents.create", { agentId, config: { name, role: "Worker", tags: ["work"], runtime: { adapter: "fake" }, delegation } });
    return agentId;
  };
  function config(agentId: string, delegation: AgentConfigInput["delegation"]) {
    const { revision } = raw.prepare("SELECT revision FROM seats WHERE id=?").get(agentId) as { revision: number };
    command("agents.update", { agentId, expectedRevision: revision, config: { ...currentAgentConfig(raw, agentId)!.config, delegation } });
  }
  const task = (id: string) => getTask(raw, projectId, id)!;
  let serial = 100;
  const initial = (ownerSeatId: string) => {
    const taskId = newId();
    command("tasks.create", { taskId, code: `TSK-${serial++}`, title: "Source work", goal: "Coordinate the work", brief: "Coordinate the work",
      ownerSeatId, parentTaskId: null, engagementId: null, placement: "portable", sideEffect: "none", reviewPolicy: "automatic", requiresGo: false,
      requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [] });
    hub.transaction(() => {
      moveTask(raw, projectId, taskId, "accepted");
      moveTask(raw, projectId, taskId, "ready");
      startTask(raw, projectId, taskId, { dispatcher });
    });
    return taskId;
  };
  const attempts = (taskId: string) => listAttempts(raw, projectId, taskId);
  function runManually(taskId: string) {
    sweepWakeups(raw, hub, dispatcher, clock().toISOString());
    const attempt = attempts(taskId).at(-1)!;
    assert.equal(attempt.state, "queued");
    const ref = { projectId, id: attempt.id };
    const now = clock().toISOString();
    ensureLocalNode(raw, { slots: 8, now });
    transitionAttempt(raw, ref, "leased", { now, nodeId: LOCAL_NODE_ID, leaseId: newId(), leaseExpiresAt: new Date(Date.now()+3600000).toISOString() });
    transitionAttempt(raw, ref, "preparing", { now });
    transitionAttempt(raw, ref, "running", { now });
    return grantFor(taskId, attempt.id, attempt.epoch);
  }
  function finish(taskId: string) {
    const current = attempts(taskId).at(-1);
    if (current?.state === "running") {
      const ref = { projectId, id: current.id };
      const now = clock().toISOString();
      transitionAttempt(raw, ref, "submitting", { now });
      transitionAttempt(raw, ref, "succeeded", { now, endedAt: now });
    }
    if (task(taskId).state === "active") moveTask(raw, projectId, taskId, "in-review");
    command("tasks.transition", { taskId, to: "done", expectedRevision: task(taskId).revision });
  }
  function decide(approvalId: string, optionId: string) {
    const approval = getApprovalView(raw, projectId, approvalId)!;
    return command("approvals.decide", { approvalId, optionId, contextDigest: approval.context.digest, expectedRevision: approval.revision, comment: "Try the alternate approach" });
  }
  async function until(predicate: () => boolean) {
    for (let count = 0; count < 200 && !predicate() && !scriptErrors.length; count++) await delay(10);
    if (scriptErrors.length) throw scriptErrors[0];
    assert.ok(predicate(), "condition did not become true");
  }
  return { raw, hub, clock, newId, projectId, command, agent, config, task, initial, attempts, runManually, finish,
    decide, dispatcher, scripts, until, request, refuses };
}

const assignment = (target: string, title: string, extras = {}) => ({ target, title, goal: "Complete the assigned work", estimateTokens: 100, ...extras });

function startOrchestrator(fx: ReturnType<typeof fixture>, lead: string, worker: string, maxTasks: number, budgetTokens: number) {
  const flowId = fx.newId();
  const runId = fx.newId();
  fx.command("flows.create", { flowId, definition: { schema: 2, key: "collaboration", title: "Collaboration",
    nodes: [{ id: "start", type: "trigger", title: "Start", trigger: { kind: "manual" } },
      { id: "coordinate", type: "orchestrate", title: "Coordinate", goal: "Divide the work", lead: { agent: lead },
        allowed: [{ agent: worker }], maxTasks, maxDepth: 2, budgetTokens }],
    edges: [{ id: "start-coordinate", from: { node: "start", port: "out" }, to: { node: "coordinate" } }] } });
  fx.command("flows.publish", { flowId, expectedRevision: 1 });
  fx.command("flow-runs.start", { flowId, runId, version: "published" });
  const run = () => getRun(fx.raw, fx.projectId, runId)!;
  const node = () => latestNodes(fx.raw, run()).get("coordinate")!;
  return { run, node };
}

test("directory follows all assignment scopes and reflects active attempt load", async (t) => {
  const fx = fixture(t);
  const leader = fx.agent("Leader");
  const managed = fx.agent("Managed");
  const teammate = fx.agent("Teammate");
  const other = fx.agent("Other");
  fx.command("relations.set", { expectedRevision: 0, relations: [{ from: leader, to: managed, kind: "manages" }] });
  fx.command("teams.create", { teamId: fx.newId(), name: "A team", memberIds: [leader, teammate] });
  const grant = fx.runManually(fx.initial(leader));
  const directory = async () => (await fx.request(grant, "agent.directory", {})).agents as { id: string; status: string }[];
  assert.deepEqual(await directory(), []);
  fx.config(leader, { canAssign: "relations" });
  assert.deepEqual((await directory()).map(({ id }) => id), [managed]);
  fx.config(leader, { canAssign: "team" });
  assert.deepEqual(new Set((await directory()).map(({ id }) => id)), new Set([leader, teammate]));
  fx.config(leader, { canAssign: "project" });
  assert.deepEqual(new Set((await directory()).map(({ id }) => id)), new Set([leader, managed, teammate, other]));
  assert.equal((await directory()).find(({ id }) => id === leader)?.status, "busy");
});

test("assignment restrictions, duplicates, and dependency cycles are enforced by MCP", async (t) => {
  const fx = fixture(t);
  const lead = fx.agent("Lead");
  const worker = fx.agent("Worker", { canAssign: "project", maxDepth: 2 });
  const other = fx.agent("Other worker");
  const grant = fx.runManually(fx.initial(lead));
  await fx.refuses(grant, "task.create", assignment(worker, "Build widgets"), "not_allowed");
  fx.config(lead, { canAssign: "project", maxDepth: 0 });
  await fx.refuses(grant, "task.create", assignment(worker, "Build widgets"), "max_depth");
  fx.config(lead, { canAssign: "project", maxDepth: 2, maxOpenSubtasks: 2 });
  await fx.refuses(grant, "task.create", assignment(worker, "Build widgets", { estimateTokens: 2_000_000 }), "budget:day");
  const first = (await fx.request(grant, "task.create", assignment(worker, "Build widgets"))).taskId as string;
  assert.equal(fx.task(first).state, "ready");
  assert.equal(fx.task(first).parentTaskId, grant.taskId);
  assert.deepEqual(await fx.request(grant, "task.create", assignment(worker, "BUILD widgets!")), { taskId: first, duplicate_of: first });
  const second = (await fx.request(grant, "task.create", assignment(other, "Build widgets", { force: true, parent: false }))).taskId as string;
  assert.equal(fx.task(second).parentTaskId, null);
  await fx.refuses(grant, "task.create", assignment(other, "Write a manual"), "max_open_subtasks");
  await fx.request(grant, "task.depend", { taskId: second, dependsOn: first });
  await fx.refuses(grant, "task.depend", { taskId: first, dependsOn: second }, "dependency_cycle");
  const delegated = fx.runManually(first);
  await fx.refuses(delegated, "task.create", assignment(lead, "Bounce it back"), "delegation_cycle");
  fx.command("agents.set-status", { agentId: other, expectedRevision: 1, status: "paused" });
  fx.finish(first);
  sweepWakeups(fx.raw, fx.hub, fx.dispatcher, fx.clock().toISOString());
  assert.equal(fx.attempts(second).length, 0);
  fx.command("agents.set-status", { agentId: other, expectedRevision: 2, status: "active" });
  sweepWakeups(fx.raw, fx.hub, fx.dispatcher, fx.clock().toISOString());
  assert.equal(fx.attempts(second).length, 1);
});

test("review verdicts and comment mentions are persisted and wake once with coalesced reasons", async (t) => {
  const fx = fixture(t);
  const lead = fx.agent("Author");
  const reviewer = fx.agent("Reviewer");
  fx.command("relations.set", { expectedRevision: 0, relations: [{ from: reviewer, to: lead, kind: "reviews" }] });
  const grant = fx.runManually(fx.initial(lead));
  const artifactId = fx.newId();
  fx.raw.prepare(`INSERT INTO artifact_versions(project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,status,abstract_l0,
    produced_by_attempt_id,visibility,created_at) VALUES(?,?,1,'document','Spec','text/plain',?,0,'draft','Spec',?,'project',?)`)
    .run(fx.projectId, artifactId, "0".repeat(64), grant.attemptId, fx.clock().toISOString());
  const review = (await fx.request(grant, "task.request-review", { reviewer, artifacts: [{ artifactId, version: 1 }] })).taskId as string;
  await fx.request(grant, "task.comment", { taskId: grant.taskId, text: "Please check the assumptions", mention: reviewer });
  await fx.request(grant, "task.comment", { taskId: grant.taskId, text: "There is also an appendix", mention: reviewer });
  const reviewerGrant = fx.runManually(review);
  const { context } = fx.raw.prepare("SELECT context FROM attempt_wakeups WHERE attempt_id=?").get(reviewerGrant.attemptId) as { context: string };
  assert.match(context, /review-requested.*comment-mention/);
  assert.match(context, /check the assumptions/);
  await fx.refuses(reviewerGrant, "task.result", { result: { verdict: "pass" } }, "invalid verdict");
  await fx.refuses(reviewerGrant, "output.register", {}, "tool is not available");
  await fx.request(reviewerGrant, "task.result", { verdict: "approved", notes: "Looks good" });
  fx.finish(review);
  sweepWakeups(fx.raw, fx.hub, fx.dispatcher, fx.clock().toISOString());
  assert.equal(fx.attempts(review).length, 1);
  const verdict = fx.raw.prepare("SELECT result_json FROM flow_task_results WHERE attempt_id=?").pluck().get(reviewerGrant.attemptId);
  assert.deepEqual(JSON.parse(String(verdict)), { verdict: "approved", notes: "Looks good" });
});

test("block parks the live attempt; operator answers resume it and approve a proposed agent", async (t) => {
  const fx = fixture(t);
  const leader = fx.agent("Lead", { canProposeAgents: true });
  let approvalId: string | undefined;
  let proposed: Record<string, unknown> | undefined;
  fx.scripts.set(leader, async function* (grant) {
    if (grant.epoch === 1) {
      proposed = await fx.request(grant, "agent.propose", { config: { name: "New analyst", role: "Analyst", runtime: { adapter: "fake" } }, reason: "Need analysis" });
      approvalId = (await fx.request(grant, "task.block", { reason: "Need clarification" })).approvalId as string;
      yield { type: "completed", summary: "Waiting for an answer" };
    } else yield { type: "completed", summary: "Resumed" };
  });
  const taskId = fx.initial(leader);
  fx.dispatcher.start();
  fx.dispatcher.kick();
  await fx.until(() => fx.attempts(taskId)[0]?.state === "parked");
  const status = () => fx.raw.prepare("SELECT status FROM seats WHERE id=?").pluck().get(proposed!.agentId);
  assert.equal(status(), "pending-approval");
  const receipt = fx.decide(proposed!.approvalId as string, "approve");
  assert.ok(receipt.effects.some(({ kind, id }) => kind === "seat" && id === proposed!.agentId));
  assert.equal(status(), "active");
  fx.decide(approvalId!, "continue");
  fx.dispatcher.kick();
  await fx.until(() => fx.attempts(taskId)[1]?.state === "succeeded");
  assert.match(String(fx.raw.prepare("SELECT context FROM attempt_wakeups WHERE attempt_id=?").pluck().get(fx.attempts(taskId)[1]!.id)),
    /approval-answered.*alternate approach/);
});

test("a manager decision wakes the blocked agent only after a result", async (t) => {
  const fx = fixture(t);
  const manager = fx.agent("Manager");
  const worker = fx.agent("Worker");
  fx.command("relations.set", { expectedRevision: 0, relations: [{ from: manager, to: worker, kind: "manages" }] });
  let decisionTaskId: string | undefined;
  fx.scripts.set(worker, async function* (grant) {
    if (grant.epoch === 1) decisionTaskId = (await fx.request(grant, "task.block", { reason: "Need a direction" })).decisionTaskId as string;
    yield { type: "completed", summary: "Finished attempt" };
  });
  fx.scripts.set(manager, async function* (grant) {
    await fx.request(grant, "task.result", { result: { answer: "Use the local adapter" } });
    yield { type: "completed", summary: "Decision made" };
  });
  const taskId = fx.initial(worker);
  fx.dispatcher.start();
  fx.dispatcher.kick();
  await fx.until(() => Boolean(decisionTaskId && fx.task(decisionTaskId).state === "in-review" && fx.attempts(taskId)[0]?.state === "parked"));
  fx.finish(decisionTaskId!);
  fx.dispatcher.kick();
  await fx.until(() => fx.attempts(taskId)[1]?.state === "succeeded");
  assert.match(String(fx.raw.prepare("SELECT context FROM attempt_wakeups WHERE attempt_id=?").pluck().get(fx.attempts(taskId)[1]!.id)),
    /approval-answered.*Use the local adapter/);
});

test("published Orchestrate runs a scripted lead and waits for every subtask and a result", async (t) => {
  const fx = fixture(t);
  const lead = fx.agent("Coordinator", { canAssign: "project", maxDepth: 3 });
  const worker = fx.agent("Worker");
  const excluded = fx.agent("Excluded");
  const ids: string[] = [];
  let refused = false;
  fx.scripts.set(lead, async function* (grant) {
    if (grant.epoch === 1) {
      await fx.refuses(grant, "task.create", assignment(excluded, "Invalid target"), "not_allowed");
      await fx.refuses(grant, "task.create", assignment(worker, "Too expensive", { estimateTokens: 301 }), "budget:node");
      for (const title of ["Inventory available parts", "Write assembly instructions", "Check the measurements"])
        ids.push((await fx.request(grant, "task.create", assignment(worker, title))).taskId as string);
      await fx.refuses(grant, "task.create", assignment(worker, "Design the shipping box"), "max_tasks");
      refused = true;
      await fx.request(grant, "task.result", { result: { outcome: "ready" } });
    }
    yield { type: "completed", summary: "Coordination finished" };
  });
  const { run, node } = startOrchestrator(fx, lead, worker, 3, 300);
  fx.dispatcher.start();
  fx.dispatcher.kick();
  await fx.until(() => refused && ids.every((id) => fx.task(id).state === "in-review"));
  fx.finish(ids[0]!);
  fx.finish(ids[1]!);
  assert.equal(run().state, "waiting");
  fx.finish(ids[2]!);
  assert.equal(run().state, "succeeded");
  const output = node().output_json!;
  assert.deepEqual(JSON.parse(output), { result: { outcome: "ready" }, subtasks: ids.map((taskId) => ({ taskId, state: "done", artifacts: [] })) });
});

test("a failed subtask wakes a finished lead to retry within the node limits", async (t) => {
  const fx = fixture(t);
  const lead = fx.agent("Coordinator", { canAssign: "project", maxDepth: 2 });
  const worker = fx.agent("Worker");
  let failed: string | undefined;
  let retry: string | undefined;
  fx.scripts.set(lead, async function* (grant) {
    if (grant.epoch === 1) {
      failed = (await fx.request(grant, "task.create", assignment(worker, "Run a flaky check"))).taskId as string;
      await fx.request(grant, "task.result", { result: { outcome: "initial" } });
    } else {
      const context = fx.raw.prepare("SELECT context FROM attempt_wakeups WHERE attempt_id=?").pluck().get(grant.attemptId);
      assert.match(String(context), /subtask-done.*failed/);
      retry = (await fx.request(grant, "task.create", assignment(worker, "Run a flaky check"))).taskId as string;
      await fx.request(grant, "task.result", { result: { outcome: "retried" } });
    }
    yield { type: "completed", summary: "Lead finished" };
  });
  fx.scripts.set(worker, async function* (grant) {
    if (grant.taskId === failed) yield { type: "failed", kind: "runtime", message: "The check failed" };
    else yield { type: "completed", summary: "The check passed" };
  });
  const { run, node } = startOrchestrator(fx, lead, worker, 2, 200);
  fx.dispatcher.start();
  fx.dispatcher.kick();
  await fx.until(() => Boolean(retry && fx.task(retry).state === "in-review"));
  assert.equal(run().state, "waiting");
  fx.finish(retry!);
  assert.equal(run().state, "succeeded");
  assert.deepEqual(JSON.parse(node().output_json!), { result: { outcome: "retried" }, subtasks: [
    { taskId: failed, state: "failed", artifacts: [] }, { taskId: retry, state: "done", artifacts: [] },
  ] });
});
