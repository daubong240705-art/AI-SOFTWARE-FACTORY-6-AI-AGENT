import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { validateFlow } from "@factory/contracts";
import { approvalsDecideHandler, getApprovalView } from "../src/approvals/service.js";
import { createContentStore } from "../src/artifacts/content-store.js";
import { DEFAULT_DOCUMENT_CONFIG } from "../src/artifacts/limits.js";
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
import { loadPack } from "../src/org/pack.js";
import { registryEntry } from "../src/org/registry.js";
import { createProjectsCreateHandler } from "../src/projects/service.js";
import { getTask } from "../src/work/service.js";
import { fixedClock, idFactory, migratedStorage, tempDir } from "./helpers.js";

const packs = {
  "architecture-team": ["api-design", "architecture-review"],
  "design-team": ["ux-design"],
  "research-team": ["research-report"],
  "software-team": ["bug-fix", "software-delivery"],
};
type PackKey = keyof typeof packs;
const corePack = (key: PackKey) => loadPack(fileURLToPath(new URL(`../../../../packs/${key}/`, import.meta.url)));
const brief = "# Improve the account preferences journey\nKeep existing settings compatible.";
const pass = { verdict: "pass", notes: "Mock checks passed." };
const fail = { verdict: "fail", notes: "Mock check found a blocking discrepancy." };
const backend = "Backend developer";
const frontend = "Frontend developer";
const archReviewer = "Independent architecture reviewer";

test("all core packs load role-bound, left-to-right Workflow v2 definitions", () => {
  for (const [key, expected] of Object.entries(packs)) {
    const pack = corePack(key as PackKey);
    assert.equal(pack.manifest.key, key);
    const roles = new Set(pack.manifest.seats.map(({ role }) => role));
    const flows = pack.files.flows ?? [];
    assert.deepEqual(flows.map(({ definition }) => definition.key).sort(), expected);
    if (key === "software-team") assert.deepEqual(pack.files.workflows.map(({ definition }) => definition.key), ["software-delivery-classic"]);
    for (const { definition } of flows) {
      assert.deepEqual(validateFlow(definition, { agentIds: new Set() }), [], definition.key);
      for (const node of definition.nodes) {
        assert.ok(definition.layout[node.id], `${definition.key}/${node.id}: missing layout`);
        assert.notEqual(node.type, "parallel");
        const selectors = node.type === "agent" ? [node.agent, ...(typeof node.review === "object" ? [node.review.agent] : [])]
          : node.type === "orchestrate" ? [node.lead, ...node.allowed]
          : node.type === "approval" && typeof node.approver === "object" ? [node.approver.agent] : [];
        for (const selector of selectors)
          assert.ok("role" in selector && roles.has(selector.role), `${definition.key}/${node.id}: selector must match a pack role`);
      }
      for (const edge of definition.edges) {
        if (!edge.loopBack) assert.ok(definition.layout[edge.to.node]!.x > definition.layout[edge.from.node]!.x, edge.id);
      }
    }
  }
});

function mockRun(context: TestContext, packKey: PackKey, definitionKey: string, withUpload = false) {
  const pack = corePack(packKey);
  const storage = migratedStorage();
  const { raw } = storage;
  const newId = idFactory();
  const clock = fixedClock();
  const hub = new EventHub(raw, { clock, newId });
  const dispatcher = createDispatcher({ storage, hub, clock, newId, registry: new RuntimeRegistry() });
  context.after(async () => { await dispatcher.stop(); storage.close(); });
  const files = withUpload ? tempDir() : undefined;
  if (files) context.after(files.cleanup);
  const store = files && createContentStore({ dir: files.dir });
  const engine = { raw, hub, clock, newId, dispatcher,
    ...(store && { upload: { store, config: DEFAULT_DOCUMENT_CONFIG, afterRegister: () => {} } }),
  };
  registerFlowEngine(engine);
  const pipeline = createCommandPipeline({ storage, hub, clock, newId, handlers: {
    ...createFlowHandlers({ engine, packs: [registryEntry(pack)] }), ...createDispatchHandlers({ dispatcher }),
    "projects.create": createProjectsCreateHandler({ pack }),
    "approvals.decide": approvalsDecideHandler,
  } });
  const projectId = newId();
  const flowId = newId();
  const runId = newId();
  const command = (type: string, payload: unknown) => {
    const { body } = pipeline.execute({ apiVersion: 1, commandId: newId(), projectId, type, payload });
    assert.ok(body.ok, JSON.stringify(body));
  };
  command("projects.create", { name: "Account preferences", workspace: { kind: "git", root: "/projects/preferences" } });
  command("flows.import-v1", { packKey, definitionKey, flowId });
  command("flows.publish", { flowId, expectedRevision: 1 });
  command("flow-runs.start", { flowId, runId, version: "published", test: true, mockAgents: true, inputs: { brief } });
  const run = () => getRun(raw, projectId, runId)!;
  const row = (nodeId: string) => latestNodes(raw, run()).get(nodeId)!;
  const approvals = () => raw.prepare("SELECT id FROM approvals WHERE project_id=?").all(projectId);
  const finish = (taskId: string, role: string, result?: unknown) => {
    const task = getTask(raw, projectId, taskId)!;
    assert.equal(activeAgents(raw, projectId).find(({ id }) => id === task.ownerSeatId)?.role, role);
    const attempt = listAttempts(raw, projectId, taskId).at(-1)!;
    assert.equal(attempt.runtime, "fake");
    hub.transaction(() => {
      if (result !== undefined) saveTaskResult(raw, projectId, taskId, attempt.id, result);
      moveTask(raw, projectId, taskId, "in-review");
    });
    command("tasks.transition", { taskId, to: "done", expectedRevision: getTask(raw, projectId, taskId)!.revision });
  };
  return {
    row,
    complete(nodeId: string, role: string, result?: unknown) {
      assert.deepEqual(approvals(), [], `${nodeId}: approval came before required work`);
      assert.equal(row(nodeId).state, "waiting", nodeId);
      const taskId = row(nodeId).task_id;
      assert.ok(taskId, nodeId);
      finish(taskId, role, result);
    },
    review(nodeId: string, role: string, verdict = "accepted") {
      const child = raw.prepare("SELECT id FROM tasks WHERE project_id=? AND parent_task_id=?")
        .get(projectId, row(nodeId).task_id) as { id: string } | undefined;
      assert.ok(child, `${nodeId}: no reviewer task`);
      finish(child.id, role, { verdict });
    },
    expectFirstApproval() {
      assert.equal(run().state, "waiting");
      assert.equal(row("approve").state, "waiting");
      const approvalId = row("approve").approval_id;
      assert.ok(approvalId);
      assert.equal(getApprovalView(raw, projectId, approvalId)?.state, "pending");
      assert.deepEqual(approvals(), [{ id: approvalId }]);
      assert.equal(row("delivered").started_at, null);
    },
    expectNoApproval(terminalNode: string) {
      assert.deepEqual(approvals(), []);
      assert.equal(row(terminalNode).state, "succeeded");
      assert.equal(row("approve").started_at, null);
      assert.equal(row("delivered").started_at, null);
    },
    approveAndReadReport() {
      const approval = getApprovalView(raw, projectId, row("approve").approval_id!)!;
      command("approvals.decide", { approvalId: approval.id, expectedRevision: approval.revision,
        contextDigest: approval.context.digest, optionId: "approve", comment: "Mock operator sign-off" });
      assert.equal(run().state, "succeeded");
      const saved = raw.prepare("SELECT artifact_id, version, content_hash FROM artifact_versions WHERE project_id=? AND title=?")
        .get(projectId, "Research report") as { artifact_id: string; version: number; content_hash: string } | undefined;
      assert.ok(saved);
      assert.deepEqual(JSON.parse(row("delivered").output_json!), {
        "nodes.save-report.artifacts": [{ artifactId: saved.artifact_id, version: saved.version }],
      });
      return store?.get(saved.content_hash)?.toString("utf8");
    },
  };
}

function implement(run: ReturnType<typeof mockRun>) {
  run.complete("requirements", "Business analyst");
  run.complete("plan", "Product manager");
  run.complete("backend", backend);
  run.review("backend", frontend);
  run.complete("frontend", frontend);
  run.review("frontend", backend);
}

for (const outcome of ["direct", "repaired", "exhausted"] as const) {
  test(`software delivery routes ${outcome} QA evidence`, (context) => {
    const run = mockRun(context, "software-team", "software-delivery");
    implement(run);
    run.complete("test", "Tester", outcome === "direct" ? pass : fail);
    const rounds = outcome === "exhausted" ? 3 : outcome === "repaired" ? 1 : 0;
    for (let round = 1; round <= rounds; round++) {
      run.complete("repair-backend", backend);
      run.review("repair-backend", frontend);
      run.complete("repair-frontend", frontend);
      run.review("repair-frontend", backend);
      assert.equal(run.row("verify").iteration, round);
      run.complete("verify", "Tester", outcome === "exhausted" ? fail : pass);
    }
    if (outcome === "exhausted") run.expectNoApproval("blocked");
    else run.expectFirstApproval();
  });
}

test("bug fix verifies the peer-reviewed regression repair before approval", (context) => {
  const run = mockRun(context, "software-team", "bug-fix");
  run.complete("reproduce", "Tester", { verdict: "reproduced", area: "frontend", notes: "Mock regression failed as expected." });
  run.complete("fix-ui", frontend);
  run.review("fix-ui", backend);
  run.complete("verify", "Tester", pass);
  run.expectFirstApproval();
});

test("bug fix does not start a repair without reproduction", (context) => {
  const run = mockRun(context, "software-team", "bug-fix");
  run.complete("reproduce", "Tester", { verdict: "not-reproduced", area: "unknown", notes: "Mock repro did not fail." });
  run.expectNoApproval("blocked-repro");
});

test("a requested peer change takes the error edge, not operator approval", (context) => {
  const run = mockRun(context, "software-team", "bug-fix");
  run.complete("reproduce", "Tester", { verdict: "reproduced", area: "backend", notes: "Mock regression failed as expected." });
  run.complete("fix-backend", backend);
  run.review("fix-backend", frontend, "changes-requested");
  run.expectNoApproval("fix-backend-error");
});

test("research report holds saving until the fact-checked draft is approved", (context) => {
  const run = mockRun(context, "research-team", "research-report", true);
  run.complete("plan", "Evidence researcher");
  run.complete("sources", "Evidence researcher");
  run.review("sources", "Independent evidence reviewer");
  run.complete("compare", "Comparative research analyst");
  for (const [notes, verdict] of [["Draft", fail], ["Corrected", pass]] as const) {
    run.complete("report", "Comparative research analyst", { markdown: `# ${notes} evidence summary` });
    run.complete("fact-check", "Independent evidence reviewer", verdict);
  }
  assert.equal(run.row("report").iteration, 2);
  run.expectFirstApproval();
  assert.equal(run.row("save-report").started_at, null);
  assert.equal(run.approveAndReadReport(), "# Corrected evidence summary");
});

test("architecture review takes a reviewed ADR to operator approval", (context) => {
  const run = mockRun(context, "architecture-team", "architecture-review");
  run.complete("current-state", "System architect");
  run.complete("options", "System architect");
  run.review("options", archReviewer);
  run.complete("adr", "System architect");
  run.complete("review", archReviewer, pass);
  run.expectFirstApproval();
});

test("API design requires model and contract review before operator approval", (context) => {
  const run = mockRun(context, "architecture-team", "api-design");
  run.complete("model", "Data model designer");
  run.review("model", archReviewer);
  run.complete("contract", "API contract designer");
  run.complete("review", archReviewer, pass);
  run.expectFirstApproval();
});

test("UX design requires an accessibility review before operator approval", (context) => {
  const run = mockRun(context, "design-team", "ux-design");
  run.complete("journey", "User experience designer");
  run.review("journey", "Interface specification designer");
  run.complete("spec", "Interface specification designer");
  run.complete("accessibility", "Independent design reviewer", pass);
  run.expectFirstApproval();
});
