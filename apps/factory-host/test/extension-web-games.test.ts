import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { flowDefinitionSchema, validateFlow, type FlowDefinition } from "@factory/contracts";
import { getApprovalView } from "../src/approvals/service.js";
import { conversationsCreateHandler, getConversation } from "../src/chat/service.js";
import { createCommandPipeline } from "../src/commands/pipeline.js";
import { listAttempts } from "../src/dispatch/attempts.js";
import { createDispatchHandlers } from "../src/dispatch/commands.js";
import { createDispatcher } from "../src/dispatch/dispatcher.js";
import { RuntimeRegistry } from "../src/dispatch/runtime.js";
import { moveTask } from "../src/dispatch/tasks.js";
import { EventHub } from "../src/events/hub.js";
import { createFlowHandlers, registerFlowEngine } from "../src/flow/index.js";
import { getRun, latestNodes } from "../src/flow/store.js";
import { activeAgents, saveTaskResult } from "../src/flow/work.js";
import { projectAgentsView } from "../src/org/agent-views.js";
import { loadPack } from "../src/org/pack.js";
import { registryEntry } from "../src/org/registry.js";
import { createProjectsCreateHandler } from "../src/projects/service.js";
import { getTask } from "../src/work/service.js";
import { fixedClock, idFactory, migratedStorage } from "./helpers.js";

const packDir = fileURLToPath(new URL("../../../../extensions/portal/packs/web-games/", import.meta.url));
const brief = "# Vườn đèn\nHai người đặt đèn; không đổi ID dự án.";
const qaPass = { verdict: "pass", area: "none", reasons: ["Các kiểm tra giả lập đạt."], bugs: [] };
const qaFail = { verdict: "fail", area: "rules", reasons: ["Lỗi lượt vẫn tái hiện."], bugs: ["Giữ nguyên lượt khi nước đi sai."] };
const ready = { verdict: "ready", notes: "Ứng viên giả lập đã được kiểm tra." };

test("a new web-games project can start a conversation with its agents roster Lead", (context) => {
  const storage = migratedStorage();
  context.after(() => storage.close());
  const { raw } = storage;
  const clock = fixedClock(), newId = idFactory(), projectId = newId();
  const hub = new EventHub(raw, { clock, newId });
  const pack = loadPack(packDir);
  const pipeline = createCommandPipeline({ storage, hub, clock, newId, handlers: {
    "projects.create": createProjectsCreateHandler({ pack, packs: [registryEntry(pack)], startEmpty: true }),
    "conversations.create": conversationsCreateHandler,
  } });
  const create = pipeline.execute({ apiVersion: 1, commandId: newId(), projectId, type: "projects.create",
    payload: { name: "Vuon Den", teamTemplate: "web-games", workspace: { kind: "directory", root: "/projects/vuon-den" } } });
  assert.ok(create.body.ok);
  const lead = projectAgentsView(raw, projectId)?.agents.find(agent => agent.isLead && agent.status === "active");
  assert.equal(lead?.role, "Game Lead");
  const conversationId = newId();
  const result = pipeline.execute({ apiVersion: 1, commandId: newId(), projectId, type: "conversations.create",
    payload: { conversationId, agentId: lead.id, title: "Lead", workItemId: null } });
  assert.ok(result.body.ok);
  assert.equal(getConversation(raw, projectId, conversationId)?.agentId, lead.id);
});

function readFlow(key: string): FlowDefinition {
  return flowDefinitionSchema.parse(JSON.parse(readFileSync(join(packDir, "flows", `${key}.json`), "utf8")));
}

test("the Web Games pack has six valid, role-bound Workflow v2 definitions", () => {
  const pack = loadPack(packDir);
  assert.equal(pack.manifest.key, "web-games");
  const roles = new Set(pack.manifest.seats.map(({ role }) => role));
  assert.equal(roles.size, 8);
  const keys = readdirSync(join(packDir, "flows")).filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -5)).sort();
  assert.deepEqual(keys, ["game-bugfix", "game-change", "game-new", "game-playtest", "game-publish", "game-rollback"]);
  for (const key of keys) {
    const flow = readFlow(key);
    assert.equal(flow.key, key);
    assert.deepEqual(validateFlow(flow, { agentIds: new Set() }), [], key);
    for (const edge of flow.edges) {
      if (!edge.loopBack) assert.ok(flow.layout[edge.to.node]!.x > flow.layout[edge.from.node]!.x, `${key}/${edge.id}: edge must run left to right`);
    }
    for (const node of flow.nodes) {
      assert.ok(flow.layout[node.id], `${key}/${node.id}: no layout`);
      const selectors = node.type === "agent" ? [node.agent, ...(typeof node.review === "object" ? [node.review.agent] : [])]
        : node.type === "orchestrate" ? [node.lead, ...node.allowed]
        : node.type === "approval" && typeof node.approver === "object" ? [node.approver.agent] : [];
      for (const selector of selectors)
        assert.ok("role" in selector && roles.has(selector.role), `${key}/${node.id}: invalid pack role`);
    }
  }
});

function mockRun(context: TestContext, key: string, inputs: Record<string, string>) {
  const pack = loadPack(packDir);
  const flow = readFlow(key);
  const storage = migratedStorage();
  const { raw } = storage;
  const newId = idFactory();
  const clock = fixedClock();
  const hub = new EventHub(raw, { clock, newId });
  const dispatcher = createDispatcher({ storage, hub, clock, newId, registry: new RuntimeRegistry() });
  context.after(async () => { await dispatcher.stop(); storage.close(); });
  const engine = { raw, hub, clock, newId, dispatcher };
  registerFlowEngine(engine);
  const pipeline = createCommandPipeline({ storage, hub, clock, newId, handlers: {
    ...createFlowHandlers({ engine, packs: [registryEntry(pack)] }), ...createDispatchHandlers({ dispatcher }),
    "projects.create": createProjectsCreateHandler({ pack }),
  } });
  const projectId = newId();
  const command = (type: string, payload: unknown) => {
    const { body } = pipeline.execute({ apiVersion: 1, commandId: newId(), projectId, type, payload });
    assert.ok(body.ok, JSON.stringify(body));
  };
  command("projects.create", { name: "Vuon Den", workspace: { kind: "git", root: "/projects/vuon-den" } });
  const flowId = newId();
  const runId = newId();
  command("flows.create", { flowId, definition: flow });
  command("flow-runs.start", { flowId, runId, version: "draft", test: true, mockAgents: true, inputs: { ...inputs, portalIntegrationId: newId() } });
  const run = () => getRun(raw, projectId, runId)!;
  const row = (nodeId: string) => latestNodes(raw, run()).get(nodeId)!;
  function complete(nodeId: string, role: string, result?: unknown) {
    assert.equal(row(nodeId).state, "waiting", nodeId);
    const taskId = row(nodeId).task_id;
    assert.ok(taskId, nodeId);
    finish(taskId, role, result);
  }
  function finish(taskId: string, role: string, result: unknown) {
    const task = getTask(raw, projectId, taskId)!;
    assert.equal(activeAgents(raw, projectId).find(({ id }) => id === task.ownerSeatId)?.role, role);
    const attempt = listAttempts(raw, projectId, taskId).at(-1)!;
    assert.equal(attempt.runtime, "fake");
    hub.transaction(() => {
      if (result !== undefined) saveTaskResult(raw, projectId, taskId, attempt.id, result);
      moveTask(raw, projectId, taskId, "in-review");
    });
    command("tasks.transition", { taskId, to: "done", expectedRevision: getTask(raw, projectId, taskId)!.revision });
  }
  return {
    row,
    complete,
    review(nodeId: string, role: string, inspectBrief?: (brief: string) => void) {
      const parent = row(nodeId).task_id;
      const child = raw.prepare("SELECT id FROM tasks WHERE project_id=? AND parent_task_id=?").get(projectId, parent) as { id: string } | undefined;
      assert.ok(child, `${nodeId}: no reviewer task`);
      inspectBrief?.(getTask(raw, projectId, child.id)!.brief);
      finish(child.id, role, { verdict: "accepted", notes: "Đã phản biện." });
    },
    expectFirstApproval(nodeId: string) {
      assert.equal(run().state, "waiting");
      assert.equal(row(nodeId).state, "waiting");
      const approvalId = row(nodeId).approval_id;
      assert.ok(approvalId);
      const approval = getApprovalView(raw, projectId, approvalId);
      assert.ok(approval);
      assert.equal(approval.state, "pending");
      const approvals = raw.prepare("SELECT id FROM approvals WHERE project_id=?").all(projectId);
      assert.deepEqual(approvals, [{ id: approvalId }]);
      assert.equal(row("publish").started_at, null);
    },
  };
}

function buildNew(run: ReturnType<typeof mockRun>, inspectRulesReview?: (brief: string) => void) {
  for (const [id, owner, reviewer] of [
    ["design", "Game Designer", "Game Lead"], ["rules", "Rules Engineer", "Code Reviewer"],
    ["art", "UI Artist", "Game Designer"], ["client", "Client Engineer", "Code Reviewer"],
  ] as const) {
    run.complete(id, owner);
    run.review(id, reviewer, id === "rules" ? inspectRulesReview : undefined);
  }
}

test("game-new reaches its first Approval only after review, QA and release checks", (context) => {
  const run = mockRun(context, "game-new", { title: "Vuon Den", players: "2", brief });
  const rules = readFlow("game-new").nodes.find(node => node.id === "rules");
  assert.ok(rules?.type === "agent");
  buildNew(run, reviewBrief => {
    assert.ok(reviewBrief.includes(rules.title));
    assert.ok(reviewBrief.includes(Array.from(rules.task.instructions).slice(0, 600).join("")));
    for (const criterion of rules.task.acceptance) assert.ok(reviewBrief.includes(criterion), criterion);
    assert.match(reviewBrief, /Out of scope — handled by later steps: Vẽ tài sản và định hướng giao diện; Dựng client bằng SDK; Chơi thử và kiểm tra chất lượng; Kiểm tra bản phát hành/);
    assert.doesNotMatch(reviewBrief, /Phân loại lỗi|Sửa giao diện và điều khiển/);
    assert.match(reviewBrief, /as notes, not as changes-requested/);
  });
  run.complete("qa", "QA Engineer", qaPass);
  run.complete("release", "Release Manager", ready);
  run.expectFirstApproval("approve-publish");
});

test("game-bugfix triages an unknown area, retries verification, and waits for publish approval", (context) => {
  const run = mockRun(context, "game-bugfix", { brief, area: "unknown" });
  run.complete("reproduce", "QA Engineer", { verdict: "reproduced", notes: "Test lượt thất bại." });
  run.complete("triage", "Game Lead", { area: "rules", notes: "Lỗi nằm trong luật." });
  for (const verdict of [qaFail, qaPass]) {
    run.complete("fix-rules", "Rules Engineer");
    run.review("fix-rules", "Code Reviewer");
    run.complete("verify", "QA Engineer", verdict);
  }
  assert.equal(run.row("verify").iteration, 2);
  run.complete("release", "Release Manager", ready);
  run.expectFirstApproval("approve-publish");
});

test("game-new stops after three failed repair rounds for a continuation decision, not publish", (context) => {
  const run = mockRun(context, "game-new", { title: "Vuon Den", players: "2", brief });
  buildNew(run);
  run.complete("qa", "QA Engineer", qaFail);
  run.complete("triage", "Game Lead", { area: "rules", notes: "Sửa luật trước." });
  for (let round = 1; round <= 3; round += 1) {
    run.complete("fix-rules", "Rules Engineer");
    run.review("fix-rules", "Code Reviewer");
    run.complete("verify", "QA Engineer", qaFail);
  }
  assert.equal(run.row("verify").iteration, 3);
  assert.equal(run.row("approve-publish").started_at, null);
  run.expectFirstApproval("approve-more");
});
