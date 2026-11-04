import assert from "node:assert/strict";
import test from "node:test";
import { roles } from "../shared/defaults";
import type { AgentExecution, MonitorSnapshot } from "../shared/monitor";
import type { MonitorState } from "../src/lib/monitor-store";
import { officeTarget, selectOffice } from "../src/features/office/state";

function fixture(): MonitorState {
  const snapshot: MonitorSnapshot = {
    epoch: "epoch",
    revision: 1,
    projectId: "project",
    observedAt: "now",
    activeRun: {
      id: "run",
      projectId: "project",
      projectName: "Project",
      state: "running",
    },
    runId: "run",
    runState: "running",
    conversationId: null,
    agents: roles.map((role) => ({
      role,
      enabled: true,
      configuredModel: "configured",
      availability: "available",
      executions: [],
      waiting: [],
      lastFinished: null,
    })),
    progress: {
      currentTasks: 3,
      executedTasks: 1,
      verifiedTasks: 0,
      applicableCriteria: 3,
      passedCriteria: 0,
      unverifiedCriteria: 3,
    },
  };
  return { snapshot, stale: false, error: "", receivedAt: 1 };
}
function execution(
  id: string,
  activity: AgentExecution["activity"],
): AgentExecution {
  return {
    executionId: id,
    runId: "run",
    taskId: id,
    logicalTaskKey: id,
    attemptKey: id,
    title: id,
    model: `model-${id}`,
    activity,
    observedFrom: "runtime",
    startedAt: null,
    activityAt: null,
  };
}

test("office opens only the exact role/execution or queued task from a fresh project snapshot", () => {
  const state = fixture();
  const be = state.snapshot!.agents.find((a) => a.role === "be")!;
  be.executions = [
    execution("first", "editing"),
    execution("second", "testing"),
  ];
  be.waiting = [{ taskId: "queued", title: "Queued", reason: "Chờ lượt" }];
  assert.deepEqual(
    officeTarget(state, "project", "be", { executionId: "second" }),
    {
      projectId: "project",
      runId: "run",
      taskId: "second",
      executionId: "second",
    },
  );
  assert.deepEqual(officeTarget(state, "project", "be", { taskId: "queued" }), {
    projectId: "project",
    runId: "run",
    taskId: "queued",
  });
  assert.equal(
    officeTarget(state, "project", "fe", { executionId: "second" }),
    null,
  );
  assert.equal(
    officeTarget(state, "project", "fe", { taskId: "queued" }),
    null,
  );
  assert.equal(
    officeTarget(state, "other", "be", { executionId: "second" }),
    null,
  );
  assert.equal(
    officeTarget({ ...state, stale: true }, "project", "be", {
      executionId: "second",
    }),
    null,
  );
  assert.equal(
    officeTarget({ ...state, error: "offline" }, "project", "be", {
      taskId: "queued",
    }),
    null,
  );
  be.executions.pop();
  assert.equal(
    officeTarget(state, "project", "be", { executionId: "second" }),
    null,
  );
  be.executions = [{ ...execution("direct", "running"), taskId: null }];
  assert.deepEqual(
    officeTarget(state, "project", "be", { executionId: "direct" }),
    { projectId: "project", runId: "run", taskId: null, executionId: "direct" },
  );
});
test("office preserves simultaneous identities, models, urgent permission and remaining lane", () => {
  const state = fixture(),
    be = state.snapshot!.agents.find((a) => a.role === "be")!;
  be.executions = [
    execution("first", "editing"),
    execution("second", "testing"),
  ];
  let office = selectOffice(state, "project");
  assert.equal(office.busy, 1);
  assert.equal(office.executions, 2);
  assert.equal(office.agents.find((a) => a.role === "be")!.label, "2 tác vụ");
  assert.deepEqual(
    office.agents.find((a) => a.role === "be")!.executions,
    be.executions,
  );
  be.executions[0].activity = "waiting_input";
  assert.match(
    selectOffice(state, "project").agents.find((a) => a.role === "be")!.label,
    /2 tác vụ · Chờ bạn/,
  );
  be.executions.shift();
  office = selectOffice(state, "project");
  assert.equal(office.busy, 1);
  assert.equal(
    office.agents.find((a) => a.role === "be")!.label,
    "Đang kiểm thử",
  );
  assert.equal(
    office.agents.find((a) => a.role === "be")!.executions[0].model,
    "model-second",
  );
});
test("office maps all runtime activities and does not mask live work after configuration changes", () => {
  const state = fixture(),
    agent = state.snapshot!.agents[0];
  agent.enabled = false;
  agent.availability = "disabled";
  agent.configuredModel = null;
  for (const [activity, label] of [
    ["preparing", "Đang chuẩn bị"],
    ["waiting_model", "Chờ model"],
    ["running", "Đang chạy"],
    ["reading", "Đang đọc source"],
    ["editing", "Đang sửa file"],
    ["command", "Đang chạy lệnh"],
    ["testing", "Đang kiểm thử"],
    ["reviewing", "Đang review"],
    ["waiting_input", "Chờ bạn"],
    ["stopping", "Đang dừng"],
    ["finished", "Đã kết thúc"],
    ["unknown", "Chưa rõ hoạt động"],
  ] as const) {
    agent.executions = [{ ...execution("direct", activity), taskId: null }];
    const office = selectOffice(state, "project");
    assert.equal(office.agents[0].label, label);
    assert.equal(office.agents[0].executions[0].taskId, null);
    assert.equal(office.busy, 1);
  }
  agent.executions = [
    execution("first", "waiting_input"),
    execution("second", "stopping"),
  ];
  assert.equal(
    selectOffice(state, "project").agents[0].label,
    "2 tác vụ · Đang dừng",
  );
  agent.executions = [];
  assert.equal(selectOffice(state, "project").agents[0].label, "Đã tắt");
  agent.availability = "unconfigured";
  assert.equal(selectOffice(state, "project").agents[0].label, "Chưa cấu hình");
});
test("waiting dependencies and integration stay distinct from live execution and idle", () => {
  const state = fixture(),
    agent = state.snapshot!.agents[1];
  for (const [reason, label] of [
    ["Chờ dependency", "Chờ phụ thuộc"],
    ["Dependency cần xử lý", "Vướng phụ thuộc"],
    ["Chờ tích hợp source", "Chờ tích hợp"],
    ["Chờ lượt", "Chờ lượt"],
  ]) {
    agent.waiting = [{ taskId: "queued", title: "Queued", reason }];
    const office = selectOffice(state, "project");
    assert.equal(office.busy, 0);
    assert.equal(office.waiting, 1);
    assert.equal(office.agents[1].label, label);
    assert.equal(office.agents[1].waiting[0].reason, reason);
  }
  agent.waiting.push({ taskId: "other", title: "Other", reason: "Chờ lượt" });
  assert.equal(selectOffice(state, "project").agents[1].label, "2 đang chờ");
});
test("unreliable or foreign snapshots expose no current work, progress or false idle", () => {
  const state = fixture();
  state.snapshot!.agents[0].executions = [execution("old", "editing")];
  for (const input of [
    { ...state, stale: true },
    { ...state, error: "offline" },
    { ...state, snapshot: null },
    { ...state, snapshot: { ...state.snapshot!, projectId: "other" } },
  ]) {
    const office = selectOffice(input, "project");
    assert.equal(office.reliable, false);
    assert.equal(office.busy, null);
    assert.equal(office.progress, null);
    assert.equal(office.otherProject, null);
    assert.equal(office.agents.length, 7);
    assert.ok(
      office.agents.every(
        (a) =>
          a.label === "Chưa đồng bộ" &&
          !a.executions.length &&
          !a.waiting.length,
      ),
    );
  }
});
test("verified progress is copied without treating idle or executed work as verified", () => {
  const state = fixture();
  let office = selectOffice(state, "project");
  assert.equal(office.busy, 0);
  assert.equal(office.progress!.executedTasks, 1);
  assert.equal(office.progress!.verifiedTasks, 0);
  state.snapshot!.progress.verifiedTasks = 3;
  office = selectOffice(state, "project");
  assert.equal(office.progress!.verifiedTasks, 3);
  state.snapshot!.activeRun!.projectId = "other";
  state.snapshot!.activeRun!.projectName = "Other";
  office = selectOffice(state, "project");
  assert.equal(office.otherProject, "Other");
  assert.equal(office.executions, 0);
});
