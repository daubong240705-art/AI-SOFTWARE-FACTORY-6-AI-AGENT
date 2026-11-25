import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { flowInsightsResponseSchema, improvementProposalResponseSchema, improvementProposalsResponseSchema, projectInsightsResponseSchema } from "@factory/contracts";
import { createApiServer } from "../src/api/server.js";
import { approvalsDecideHandler, getApprovalView } from "../src/approvals/service.js";
import { createCommandPipeline } from "../src/commands/pipeline.js";
import { appendAttemptEvent, listAttempts, transitionAttempt } from "../src/dispatch/attempts.js";
import { createDispatcher } from "../src/dispatch/dispatcher.js";
import { ensureLocalNode, LOCAL_NODE_ID } from "../src/dispatch/node.js";
import { RuntimeRegistry } from "../src/dispatch/runtime.js";
import { moveTask } from "../src/dispatch/tasks.js";
import { createFlowHandlers, fireFlowTimers, registerFlowEngine } from "../src/flow/index.js";
import { definitionOf, getFlow, getRun, getVersion, latestNodes } from "../src/flow/store.js";
import { activeAgents } from "../src/flow/selector.js";
import { saveTaskResult } from "../src/flow/work.js";
import { createBootstrapGate, createSessionStore } from "../src/identity/index.js";
import { createInsightsHandlers } from "../src/insights/commands.js";
import { insightsWindow, readFlowInsights, readProjectAgents } from "../src/insights/read.js";
import { InsightsTraceRecorder } from "../src/insights/record.js";
import { agentFindings, flowFindings } from "../src/insights/rules.js";
import { registerInsightsRoutes } from "../src/insights/routes.js";
import { readProposal } from "../src/insights/store.js";
import { createAgentHandlers } from "../src/org/agent-commands.js";
import { currentAgentConfig, getAgent } from "../src/org/agents.js";
import { loadPack } from "../src/org/pack.js";
import { recordUsage } from "../src/policy/budget.js";
import { createProjectsCreateHandler } from "../src/projects/service.js";
import { getProposal as getSetupProposal } from "../src/setup/store.js";
import { TraceEventHub } from "../src/trace/recorder.js";
import { idFactory, migratedStorage } from "./helpers.js";

const edge = (from: string, to: string, port = "out", loopBack = false) => ({ id: `${from}-${port}-${to}`, from: { node: from, port }, to: { node: to }, loopBack });
const trigger = { id: "start", title: "Start", type: "trigger", trigger: { kind: "manual" } };
const output = (id: string, from: string) => ({ id, title: id, type: "output", target: "artifact", from: [from] });

function fixture(context: TestContext) {
  const storage = migratedStorage();
  const { raw } = storage;
  const newId = idFactory();
  let time = Date.parse("2026-11-19T10:00:00Z");
  const clock = () => new Date(time);
  const tick = (ms: number) => { time += ms; };
  const hub = new TraceEventHub(raw, new InsightsTraceRecorder(raw, clock), { clock, newId });
  const dispatcher = createDispatcher({ storage, hub, clock, newId, registry: new RuntimeRegistry() });
  context.after(async () => { await dispatcher.stop(); storage.close(); });
  const engine = { raw, hub, clock, newId, dispatcher };
  registerFlowEngine(engine);
  ensureLocalNode(raw, { slots: 2, now: clock().toISOString() });
  const pack = loadPack(fileURLToPath(new URL("../../../../packs/software-team", import.meta.url)));
  let kicks = 0;
  const pipeline: ReturnType<typeof createCommandPipeline> = createCommandPipeline({ storage, hub, clock, newId, handlers: {
    ...createFlowHandlers({ engine }), ...createAgentHandlers(),
    ...createInsightsHandlers({ kickSetup: () => { kicks++; }, executeChild: (...args) => pipeline.execute(...args) }),
    "projects.create": createProjectsCreateHandler({ pack }), "approvals.decide": approvalsDecideHandler,
  } });
  const projectId = newId();
  const command = (type: string, payload: unknown, status = 200) => {
    const result = pipeline.execute({ apiVersion: 1, commandId: newId(), projectId, type, payload });
    assert.equal(result.status, status, JSON.stringify(result.body));
    return result.body;
  };
  command("projects.create", { name: "Insights", workspace: { kind: "git", root: "/projects/insights" } });
  const agentId = activeAgents(raw, projectId)[0]!.id;
  const worker = (id: string, extra = {}) => ({ id, title: id, type: "agent", agent: { agent: agentId },
    task: { title: id, instructions: "Do work", acceptance: ["Complete the work"], inputs: [] }, ...extra });
  const create = (key: string, nodes: unknown[], edges: unknown[]) => {
    const flowId = newId();
    command("flows.create", { flowId, definition: { schema: 2, key, title: key, nodes: [trigger, ...nodes], edges } });
    return flowId;
  };
  const start = (flowId: string, version: "draft" | "published", pinned = {}) => {
    const runId = newId();
    command("flow-runs.start", { runId, flowId, version, test: true, mockAgents: true, pinned });
    return runId;
  };
  const current = (runId: string, nodeId: string) => latestNodes(raw, getRun(raw, projectId, runId)!).get(nodeId)!;
  const finish = (runId: string, nodeId: string, outcome: "failed" | "succeeded", tokens: "reported" | "estimated" | "missing" = "missing",
    taskId = current(runId, nodeId).task_id!, verdict?: "accepted" | "changes-requested") => {
    const attempt = listAttempts(raw, projectId, taskId).at(-1)!;
    const ref = { projectId, id: attempt.id };
    tick(11 * 60_000);
    const now = clock().toISOString();
    hub.transaction(() => {
      transitionAttempt(raw, ref, "leased", { nodeId: LOCAL_NODE_ID, leaseId: newId(), leaseExpiresAt: now, now });
      transitionAttempt(raw, ref, "preparing", { now });
      transitionAttempt(raw, ref, "running", { startedAt: now, now });
      tick(1000);
      const ended = clock().toISOString();
      if (tokens !== "missing") recordUsage(raw, { projectId, id: newId(), taskId, attemptId: attempt.id, conversationId: null,
        provider: attempt.provider, model: attempt.model, effort: attempt.effort, recordedAt: ended,
        estimatedTokens: tokens === "estimated" ? 11 : null,
        usage: tokens === "reported" ? { inputTokens: 10, cachedInputTokens: 2, outputTokens: 3, reasoningOutputTokens: 0 } : null });
      if (outcome === "failed") appendAttemptEvent(raw, { projectId, attemptId: attempt.id, at: ended, kind: "state", body: { to: "failed", kind: "timeout" } });
      else transitionAttempt(raw, ref, "submitting", { now: ended });
      if (verdict) saveTaskResult(raw, projectId, taskId, attempt.id, { verdict });
      transitionAttempt(raw, ref, outcome, { now: ended });
      if (outcome === "succeeded") moveTask(raw, projectId, taskId, "in-review");
      moveTask(raw, projectId, taskId, outcome === "failed" ? "failed" : "done");
    });
  };
  const window = () => insightsWindow(projectId, 30, clock());
  const read = (flowId: string) => readFlowInsights(raw, window(), getFlow(raw, projectId, flowId)!);
  const proposal = (id: string) => readProposal(raw, projectId, id)!;
  return { raw, hub, projectId, agentId, command, create, start, current, finish, worker, newId, tick, engine, window, read, proposal, kicks: () => kicks };
}

test("run analytics links retries, rejected approvals, waits and unknown cost to bounded evidence", (context) => {
  const fx = fixture(context);
  const { projectId, raw } = fx;
  const flowId = fx.create("analysis", [fx.worker("work", { retry: { max: 2, backoffSeconds: 5 }, timeoutMinutes: 60 }),
    { id: "gate", title: "Gate", type: "approval", approver: "operator", prompt: "Review" },
    output("yes", "nodes.gate.output"), output("no", "nodes.gate.output")],
  [edge("start", "work"), edge("work", "gate"), edge("gate", "yes", "approved"), edge("gate", "no", "rejected")]);
  fx.command("flows.publish", { flowId, expectedRevision: 1 });
  const published = getVersion(raw, projectId, flowId)!;
  const runIds: string[] = [];
  for (let index = 0; index < 5; index++) {
    const runId = fx.start(flowId, index === 0 ? "draft" : "published");
    runIds.push(runId);
    fx.finish(runId, "work", "failed", index === 0 ? "reported" : "missing");
    assert.equal(fx.current(runId, "work").error, "timeout failure");
    fx.tick(5000); fireFlowTimers(fx.engine);
    fx.finish(runId, "work", "failed", index === 0 ? "estimated" : "missing");
    fx.tick(5000); fireFlowTimers(fx.engine);
    fx.finish(runId, "work", "succeeded");
    const approval = getApprovalView(raw, projectId, fx.current(runId, "gate").approval_id!)!;
    fx.command("approvals.decide", { approvalId: approval.id, expectedRevision: approval.revision,
      contextDigest: approval.context.digest, optionId: "reject", comment: "No" });
    if (index === 0) {
      const first = fx.read(flowId);
      assert.equal(first.nodes.find(({ nodeId }) => nodeId === "work")?.cost.unknownCount.value, 3);
      assert.deepEqual(flowFindings(first), []);
    }
  }
  const flow = fx.read(flowId);
  const findings = flowFindings(flow);
  flowInsightsResponseSchema.parse({ ok: true, apiVersion: 1, ...fx.window(), flow, findings });
  const work = flow.nodes.find(({ nodeId }) => nodeId === "work")!;
  const gate = flow.nodes.find(({ nodeId }) => nodeId === "gate")!;
  assert.equal(flow.successRate.value, 1);
  assert.equal(flow.totalDuration.medianMs.value, 1_993_000);
  assert.deepEqual(flow.runsByVersion.map(({ version, totalRuns }) => [version, totalRuns.value]), [[1, 4], [null, 1]]);
  assert.deepEqual(new Set(flow.totalRuns.evidence), new Set(runIds));
  assert.equal(work.executions.value, 15);
  assert.equal(work.failed.value, 10);
  assert.equal(work.retries.value, 10);
  assert.equal(work.wait.medianMs.value, 0);
  assert.equal(work.wait.medianMs.samples, 15);
  assert.equal(work.run.p90Ms.value, 661_000);
  assert.equal(gate.approvals.rejected.value, 5);
  assert.equal(gate.approvals.rejectionRate.value, 1);
  assert.equal(flow.nodes.find(({ nodeId }) => nodeId === "yes")?.skipped.value, 5);
  assert.equal(work.cost.knownTokens.value, 13);
  assert.equal(work.cost.estimatedTokens.value, 11);
  assert.equal(work.cost.unknownCount.value, 15);
  assert.equal(work.executions.evidence.length, 10);
  assert.ok(work.executions.evidence.every((ref) => runIds.some((id) => ref.startsWith(`${id}:work:`))));
  for (const code of ["node-failure-rate", "node-retry-heavy", "node-timeout", "approval-rejections", "slow-node", "unknown-cost", "cost-hotspot"])
    assert.ok(findings.some((finding) => finding.code === code && finding.evidence.length));
  const agents = readProjectAgents(raw, fx.window());
  assert.equal(agents[0]?.attempts.value, 15);
  assert.equal(agents[0]?.failureRate.value, 10 / 15);
  assert.equal(agents[0]?.medianQueueWaitMs.value, 660_000);
  assert.ok(agents[0]?.busyShare.value && agents[0]?.busyShare.value > 0);
  assert.ok(agentFindings(agents).some(({ code }) => code === "queue-wait"));

  const propose = (useAi = false) => {
    const proposalId = fx.newId();
    const receipt = fx.command("insights.propose", { proposalId, flowId, days: 30, findingIds: ["node-retry-heavy:work", "node-timeout:work"], useAi });
    assert.ok(receipt.ok && receipt.receipt.effects.some(({ kind }) => kind === "improvement-proposal"));
    return proposalId;
  };
  const proposalId = propose(true);
  const stale = propose();
  const ready = fx.proposal(proposalId);
  assert.equal(ready.state, "ready");
  assert.equal(ready.source, "rules");
  assert.equal(ready.baseVersion, 1);
  assert.equal(ready.baseDraftRevision, 2);
  assert.deepEqual(ready.patch.map(({ op }) => op), ["set-retry", "set-timeout"]);
  assert.equal(fx.kicks(), 1);
  const setup = getSetupProposal(raw, projectId, ready.setupProposalId!)!;
  assert.equal(setup.flow_id, flowId);
  assert.equal(setup.mode, "flow");
  assert.match(setup.request, /Số liệu: 2 \/ 10/);
  assert.ok(ready.findings.every(({ evidence }) => evidence.length > 0));

  fx.command("insights.apply", { proposalId, expectedRevision: 1 });
  assert.equal(fx.proposal(proposalId).state, "applied");
  const draft = getFlow(raw, projectId, flowId)!;
  const updated = definitionOf(draft.draft_json).nodes.find(({ id }) => id === "work");
  assert.equal(updated?.retry?.max, 1);
  assert.equal(updated?.timeoutMinutes, 90);
  assert.equal(draft.revision, 3);
  assert.deepEqual(getVersion(raw, projectId, flowId), published);
  fx.command("insights.apply", { proposalId: stale, expectedRevision: 1 }, 409);
  fx.command("insights.discard", { proposalId: stale, expectedRevision: 2 }, 409);
  fx.command("insights.discard", { proposalId: stale, expectedRevision: 1 });
  assert.equal(fx.proposal(stale).state, "discarded");
});

test("loop history supplies rework evidence and absent or invalid patches do not write a draft", (context) => {
  const fx = fixture(context);
  const flowId = fx.create("loops", [{ id: "loop", title: "Loop", type: "loop", maxIterations: 3 }, fx.worker("body"),
    output("done", "nodes.loop.output.exhausted")],
  [edge("start", "loop"), edge("loop", "body", "body"), edge("body", "loop", "out", true), edge("loop", "done", "done")]);
  for (let index = 0; index < 5; index++) fx.start(flowId, "draft", { body: { work: true } });
  const analytics = fx.read(flowId);
  const body = analytics.nodes.find(({ nodeId }) => nodeId === "body")!;
  assert.equal(body.executions.value, 15);
  assert.equal(body.reworkIterations.value, 10);
  assert.equal(body.averageIterations.value, 3);
  assert.ok(flowFindings(analytics).some(({ id }) => id === "rework-loops:body"));
  const proposalId = fx.newId();
  fx.command("insights.propose", { proposalId, flowId, days: 30, useAi: false });
  fx.command("insights.apply", { proposalId, expectedRevision: 1 }, 400);
  assert.equal(fx.proposal(proposalId).state, "ready");

  const update = (patch: unknown[]) => fx.raw.prepare("UPDATE improvement_proposals SET patch_json=? WHERE project_id=? AND id=?")
    .run(JSON.stringify(patch), fx.projectId, proposalId);
  update([{ op: "set-on-error", nodeId: "loop", onError: "port" }]);
  const failed = fx.command("insights.apply", { proposalId, expectedRevision: 1 }, 400);
  assert.ok(!failed.ok && failed.error.fields?.length);
  assert.equal(getFlow(fx.raw, fx.projectId, flowId)?.revision, 1);

  const previous = getAgent(fx.raw, fx.projectId, fx.agentId)!;
  const changeModel = { op: "change-model", agentId: fx.agentId, expectedRevision: previous.revision, model: "reviewed-model" };
  update([{ op: "set-timeout", nodeId: "body", timeoutMinutes: 30 }, { ...changeModel, expectedRevision: previous.revision + 1 }]);
  fx.command("insights.apply", { proposalId, expectedRevision: 1 }, 409);
  assert.equal(getFlow(fx.raw, fx.projectId, flowId)?.revision, 1);
  update([changeModel]);
  fx.command("insights.apply", { proposalId, expectedRevision: 1 });
  assert.equal(currentAgentConfig(fx.raw, fx.agentId)?.config.runtime.model, "reviewed-model");
  assert.equal(getFlow(fx.raw, fx.projectId, flowId)?.revision, 1);
  assert.equal(getVersion(fx.raw, fx.projectId, flowId), undefined);
});

test("review failure and reviewer usage map to the parent node run", (context) => {
  const fx = fixture(context);
  const reviewer = activeAgents(fx.raw, fx.projectId).find(({ id }) => id !== fx.agentId)!;
  const flowId = fx.create("review", [fx.worker("work", { review: { agent: { agent: reviewer.id } } }), output("done", "nodes.work.output")],
    [edge("start", "work"), edge("work", "done")]);
  const runId = fx.start(flowId, "draft");
  fx.finish(runId, "work", "succeeded");
  const review = fx.raw.prepare<[string, string], { id: string }>("SELECT id FROM tasks WHERE project_id=? AND parent_task_id=?")
    .get(fx.projectId, fx.current(runId, "work").task_id!)!;
  fx.finish(runId, "work", "succeeded", "reported", review.id, "changes-requested");
  const work = fx.read(flowId).nodes.find(({ nodeId }) => nodeId === "work")!;
  assert.equal(work.reviewFailures.value, 1);
  assert.equal(work.reviewFailureRate.value, 1);
  assert.deepEqual(work.reviewFailures.evidence, [`${runId}:work:1:1`]);
  assert.equal(work.cost.knownTokens.value, 13);
  assert.equal(work.cost.unknownCount.value, 2);
});

test("insights routes guard sessions and scope proposal reads to the project", async (context) => {
  const fx = fixture(context);
  const { clock } = fx.engine;
  const flowId = fx.create("routes", [output("done", "inputs.name")], [edge("start", "done")]);
  const proposalId = fx.newId();
  const cursor = fx.hub.currentCursor(fx.projectId)!;
  fx.command("insights.propose", { proposalId, flowId, days: 30, useAi: false });
  const events = fx.hub.readAfter(fx.projectId, cursor);
  assert.ok(events.kind === "events" && events.events.some(({ payload }) => payload.type === "entity.changed"
    && payload.entity.kind === "improvement-proposal" && payload.entity.id === proposalId));
  const sessions = createSessionStore({ clock });
  const app = createApiServer({ origins: ["http://127.0.0.1:8787"], gate: createBootstrapGate({ clock }), sessions, clock,
    register: (server, guards) => registerInsightsRoutes(server, guards, { raw: fx.raw, clock }) });
  context.after(() => app.close());
  const host = "127.0.0.1:8787";
  const cookie = `factory_session=${sessions.create().id}`;
  const project = `/projects/${fx.projectId}`;
  const paths = [`${project}/insights`, `${project}/flows/${flowId}/insights`, `${project}/improvement-proposals`,
    `${project}/improvement-proposals/${proposalId}`];
  const schemas = [projectInsightsResponseSchema, flowInsightsResponseSchema, improvementProposalsResponseSchema, improvementProposalResponseSchema];
  for (const [index, url] of paths.entries()) {
    assert.equal((await app.inject({ url, headers: { host } })).statusCode, 401);
    const response = await app.inject({ url, headers: { host, cookie } });
    assert.equal(response.statusCode, 200);
    const view = schemas[index]!.parse(response.json());
    if ("days" in view) assert.equal(view.days, 30);
  }
  for (const query of ["0", "91", "1.2", "30&days=40"])
    assert.equal((await app.inject({ url: `${paths[0]}?days=${query}`, headers: { host, cookie } })).statusCode, 400);
  const other = fx.newId();
  assert.equal((await app.inject({ url: `/projects/${other}/improvement-proposals/${proposalId}`, headers: { host, cookie } })).statusCode, 404);
});
