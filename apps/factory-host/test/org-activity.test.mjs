import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { API_VERSION, LIVE_ATTEMPT_STATES, TERMINAL_ATTEMPT_STATES } from "@factory/contracts";
import { pack, migrationsDir } from "./org-fixture.mjs";
import { createApiServer, createRoutes } from "../dist/api/index.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createAttempt, appendAttemptEvent, ensureLocalNode, LOCAL_NODE_ID, PLACED_ATTEMPT_STATES } from "../dist/dispatch/index.js";
import { EventHub } from "../dist/events/hub.js";
import { createBootstrapGate, createSessionStore } from "../dist/identity/index.js";
import { orgActivity } from "../dist/org/activity.js";
import { ensureEngagement, getPrimaryEngagement, listSeats } from "../dist/org/service.js";
import { teamViews } from "../dist/org/views.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { openStorage } from "../dist/storage/database.js";
import { tasksCreateHandler } from "../dist/work/service.js";

const NOW = "2026-11-12T08:00:00.000Z";
const WINDOW = 30 * 60 * 1000;
const ago = (ms) => new Date(Date.parse(NOW) - ms).toISOString();

function fixture(t, { empty = false, multiTeam = true } = {}) {
  const storage = openStorage(":memory:");
  storage.migrate({ migrationsDir, backupDir: null });
  t.after(() => storage.close());
  const raw = storage.raw;
  let time = Date.parse(NOW);
  const clock = () => new Date(time);
  const hub = new EventHub(raw, { clock });
  const pipeline = createCommandPipeline({ storage, hub, clock, handlers: {
    "projects.create": createProjectsCreateHandler({ pack, multiTeam }), "tasks.create": tasksCreateHandler,
  } });
  const execute = (type, payload, projectId) => {
    const result = pipeline.execute({ apiVersion: API_VERSION, commandId: randomUUID(), projectId, type, payload });
    assert.equal(result.status, 200, JSON.stringify(result.body));
  };
  const project = (name = "Activity project") => {
    const id = randomUUID();
    execute("projects.create", { name, workspace: { kind: "directory", root: `/workspace/${id}` } }, id);
    return id;
  };
  const projectId = empty ? null : project();
  const teamId = empty ? null : getPrimaryEngagement(raw, projectId).teamId;
  const seats = empty ? [] : listSeats(raw, teamId);
  const seat = seats.find((item) => !item.isLead);
  if (!empty) ensureLocalNode(raw, { slots: 32, now: NOW });
  const addSeat = (name, { team = teamId, isLead = false, slots = 1, role = "Builder" } = {}) => {
    const id = randomUUID();
    raw.prepare(`INSERT INTO seats (id,team_id,revision,name,role,profile_id,profile_revision,runtime,slots,node_policy,is_lead)
      VALUES (?,?,1,?,?,?,1,'fake',?,'elastic',?)`).run(id, team, name, role, randomUUID(), slots, Number(isLead));
    return id;
  };
  const addTeam = (name, lifecycle = "active") => {
    const id = randomUUID();
    raw.prepare("INSERT INTO teams (id,revision,name,charter,lifecycle) VALUES (?,1,?,'Team charter',?)").run(id, name, lifecycle);
    return id;
  };
  let code = 0;
  const task = ({ seatId = seat.id, scope = projectId, state = "active", title = "Activity task", ...rest } = {}) => {
    const id = randomUUID();
    const team = seatId === null ? teamId : raw.prepare("SELECT team_id FROM seats WHERE id = ?").get(seatId).team_id;
    const { engagementId } = ensureEngagement(raw, { projectId: scope, teamId: team }, { clock, newId: randomUUID });
    execute("tasks.create", { taskId: id, code: `ACT-${String(++code).padStart(3, "0")}`, title, goal: "Deliver work",
      brief: "Work brief", parentTaskId: null, engagementId, ownerSeatId: seatId, requiredCapabilities: [],
      acceptance: [], inputs: [], dependsOn: [], placement: "portable", sideEffect: "none", requiresGo: true, ...rest }, scope);
    raw.prepare("UPDATE tasks SET state = ? WHERE project_id = ? AND id = ?").run(state, scope, id);
    return id;
  };
  const attempt = (state, { seatId = seat.id, scope = projectId, taskId = task({ seatId, scope }),
    id = randomUUID(), startedAt = null, endedAt = NOW } = {}) => {
    createAttempt(raw, { projectId: scope, id, taskId, seatId, runtime: "fake", provider: "fake", model: "fake-model", effort: "medium", now: NOW });
    const placed = PLACED_ATTEMPT_STATES.has(state);
    raw.prepare(`UPDATE attempts SET state=?,outcome=?,node_id=?,lease_id=?,lease_expires_at=?,started_at=?,ended_at=?
      WHERE project_id=? AND id=?`).run(state, state === "unknown" ? "unknown" : "known", state === "queued" ? null : LOCAL_NODE_ID,
      placed ? randomUUID() : null, placed ? "2026-11-12T09:00:00.000Z" : null, startedAt,
      TERMINAL_ATTEMPT_STATES.has(state) ? endedAt : null, scope, id);
    return { projectId: scope, id, taskId, seatId };
  };
  const event = (attempt, kind, body, at = NOW) => appendAttemptEvent(raw, {
    projectId: attempt.projectId, attemptId: attempt.id, kind, body, at,
  });
  const approval = (taskId, { scope = projectId, kind = "question", state = "pending", requestedAt = ago(1000) } = {}) => {
    const id = randomUUID();
    raw.prepare(`INSERT INTO approvals (project_id,id,revision,kind,task_id,subject,summary,options_json,
      impact_if_waiting,context_digest,approver,requested_at,expires_at,state)
      VALUES (?,?,1,?,?,'Approval','Private approval summary',?,'Waiting',?,'operator',?,?,?)`)
      .run(scope, id, kind, taskId, JSON.stringify([{ id: "yes" }, { id: "no" }]), "a".repeat(64), requestedAt, "2026-11-13T08:00:00.000Z", state);
    return id;
  };
  const read = () => orgActivity(raw, clock());
  const view = (id = seat.id) => read().teams.flatMap((team) => team.seats).find((item) => item.id === id);
  const rowCounts = () => ({ ...raw.prepare(`SELECT (SELECT COUNT(*) FROM attempts) AS attempts,
    (SELECT COUNT(*) FROM tasks) AS tasks, (SELECT COUNT(*) FROM approvals) AS approvals`).get(),
    changes: raw.prepare("SELECT total_changes() AS count").get().count });
  return { storage, raw, clock, hub, pipeline, projectId, project, teamId, seats, seat, addSeat, addTeam,
    task, attempt, event, approval, read, view, rowCounts, advance: (ms) => { time += ms; } };
}

function api(t, f) {
  const host = "127.0.0.1:8787";
  const sessions = createSessionStore({ clock: f.clock });
  const app = createApiServer({ origins: [`http://${host}`], clock: f.clock, sessions,
    gate: createBootstrapGate({ clock: f.clock }),
    register: createRoutes({ storage: f.storage, hub: f.hub, pipeline: f.pipeline, clock: f.clock }),
  });
  t.after(() => app.close());
  const session = sessions.create();
  return { app, get: (url = "/org/activity", authenticated = true) => app.inject({ url,
    headers: { host, ...(authenticated ? { cookie: `factory_session=${session.id}` } : {}) },
  }) };
}

test("empty migrated database returns no nodes or teams and does not initialize anything", (t) => {
  const f = fixture(t, { empty: true });
  const before = f.rowCounts();
  assert.deepEqual(f.read(), { generatedAt: NOW, nodes: [], teams: [] });
  assert.deepEqual(f.rowCounts(), before);
});

test("nodes expose the stored local-node capacity, identity and heartbeat only", (t) => {
  const f = fixture(t);
  f.raw.prepare("UPDATE nodes SET slots_used = 2 WHERE id = ?").run(LOCAL_NODE_ID);
  assert.deepEqual(f.read().nodes, [{ id: LOCAL_NODE_ID, name: "local", platform: process.platform === "win32" ? "windows" : "linux",
    trust: "server-sandboxed", state: "online", slots: { total: 32, used: 2 }, lastHeartbeatAt: NOW }]);
  f.raw.prepare("UPDATE nodes SET state = 'offline', last_heartbeat_at = NULL WHERE id = ?").run(LOCAL_NODE_ID);
  assert.equal(f.read().nodes[0].state, "offline");
  assert.equal(f.read().nodes[0].lastHeartbeatAt, null);
});

for (const state of ["leased", "preparing", "running", "submitting", "stopping", "waiting-input", "lease-expired", "unknown", "reconciling", "queued"]) {
  test(`live attempt ${state} appears once and derives its seat status`, (t) => {
    const f = fixture(t);
    const a = f.attempt(state);
    const view = f.view();
    const expected = state === "waiting-input" ? "waiting" : ["lease-expired", "unknown", "reconciling"].includes(state)
      ? "problem" : state === "queued" ? "idle" : "working";
    assert.equal(view.status, expected);
    assert.deepEqual(view.runs, [{ projectId: f.projectId, projectName: "Activity project", taskId: a.taskId,
      code: "ACT-001", title: "Activity task", attemptId: a.id, attemptState: state,
      nodeId: state === "queued" ? null : LOCAL_NODE_ID, startedAt: null, progress: null }]);
    assert.equal(view.lastFinished, null);
  });
}

test("latest parked attempt of an active task waits without appearing as a live run", (t) => {
  const f = fixture(t);
  const parked = f.attempt("parked");
  assert.equal(f.view().status, "waiting");
  assert.deepEqual(f.view().runs, []);
  assert.equal(f.view().lastFinished, null);
  f.attempt("running", { taskId: parked.taskId });
  assert.equal(f.view().status, "working");
});

test("a parked attempt on a finished task does not leave the seat waiting", (t) => {
  const f = fixture(t);
  const a = f.attempt("parked");
  f.raw.prepare("UPDATE tasks SET state = 'cancelled' WHERE id = ?").run(a.taskId);
  assert.equal(f.view().status, "idle");
});

for (const [label, states, needs, expected] of [
  ["approval over problem and working", ["running", "unknown", "failed"], true, "waiting"],
  ["waiting-input over problem and working", ["running", "unknown", "waiting-input"], false, "waiting"],
  ["parked over working", ["running", "parked"], false, "waiting"],
  ...["lease-expired", "unknown", "reconciling", "failed"].map((state) => [`${state} over working`, ["running", state], false, "problem"]),
  ["working over queued and done", ["running", "succeeded"], false, "working"],
  ["queued over done", ["succeeded"], false, "queued"],
]) {
  test(`status precedence: ${label}`, (t) => {
    const f = fixture(t);
    for (const state of states) f.attempt(state);
    const taskId = f.task({ state: "ready" });
    if (needs) f.approval(taskId);
    assert.equal(f.view().status, expected);
    assert.equal(f.view().queued, 1);
  });
}

for (const outcome of ["succeeded", "failed"]) {
  for (const [age, expected] of [[0, outcome === "succeeded" ? "done" : "problem"],
    [WINDOW, outcome === "succeeded" ? "done" : "problem"], [WINDOW + 1, "idle"], [-1, "idle"]]) {
    test(`${outcome} ended ${age}ms ago respects the 30-minute window`, (t) => {
      const f = fixture(t);
      f.attempt(outcome, { endedAt: ago(age) });
      assert.equal(f.view().status, expected);
      assert.deepEqual(f.view().lastFinished, { code: "ACT-001", outcome, at: ago(age) });
    });
  }
}

test("injected clock ages a completed seat from done to idle", (t) => {
  const f = fixture(t);
  f.attempt("succeeded");
  f.advance(WINDOW);
  assert.equal(f.view().status, "done");
  f.advance(1);
  assert.equal(f.view().status, "idle");
  assert.equal(f.read().generatedAt, new Date(Date.parse(NOW) + WINDOW + 1).toISOString());
});

test("lastFinished uses the most recent success or failure by finish time, excluding other terminal states", (t) => {
  const f = fixture(t);
  f.attempt("failed", { endedAt: ago(1000) });
  f.attempt("succeeded", { endedAt: ago(2000) });
  for (const state of ["stopped", "requeued", "parked"]) {
    const a = f.attempt(state);
    if (state === "parked") f.raw.prepare("UPDATE tasks SET state = 'cancelled' WHERE id = ?").run(a.taskId);
  }
  assert.deepEqual(f.view().lastFinished, { code: "ACT-001", outcome: "failed", at: ago(1000) });
  f.attempt("succeeded");
  assert.deepEqual(f.view().lastFinished, { code: "ACT-006", outcome: "succeeded", at: NOW });
  assert.equal(f.view().status, "done");
});

test("queued counts only assigned ready, accepted and awaiting-go tasks with no live attempt", (t) => {
  const f = fixture(t);
  for (const state of ["ready", "accepted", "awaiting-go"]) f.task({ state });
  for (const state of ["draft", "proposed", "active", "in-review", "done", "failed", "cancelled"]) f.task({ state });
  f.task({ state: "ready", seatId: null });
  const otherSeat = f.addSeat("Other");
  f.task({ state: "ready", seatId: otherSeat });
  for (const state of LIVE_ATTEMPT_STATES) {
    const a = f.attempt(state);
    f.raw.prepare("UPDATE tasks SET state = 'ready' WHERE id = ?").run(a.taskId);
  }
  const terminal = f.attempt("stopped");
  f.raw.prepare("UPDATE tasks SET state = 'ready' WHERE id = ?").run(terminal.taskId);
  assert.equal(f.view().queued, 4);
  assert.equal(f.view(otherSeat).queued, 1);
});

test("queued alone and an unassigned seat have queued and idle status respectively", (t) => {
  const f = fixture(t);
  assert.equal(f.view().status, "idle");
  f.task({ state: "accepted" });
  assert.equal(f.view().status, "queued");
  assert.deepEqual(f.view().needsYou, []);
});

test("pending approvals belong to task owners and live attempt seats, without duplicates or private text", (t) => {
  const f = fixture(t);
  const otherSeat = f.addSeat("Other");
  const owned = f.task({ seatId: otherSeat });
  f.attempt("running", { taskId: owned });
  const approvalId = f.approval(owned);
  const direct = f.task({ state: "awaiting-go" });
  const directApproval = f.approval(direct, { kind: "start-gate" });
  const review = f.task({ state: "in-review" });
  const reviewApproval = f.approval(review, { kind: "review" });
  f.approval(direct, { state: "requested" });
  f.approval(direct, { state: "expired" });
  f.approval(f.task({ seatId: null }));
  assert.deepEqual(f.view().needsYou.map((need) => need.approvalId).sort(), [approvalId, directApproval, reviewApproval].sort());
  assert.deepEqual(f.view(otherSeat).needsYou, [{ approvalId, kind: "question", taskId: owned, code: "ACT-001" }]);
  assert.equal(f.view().status, "waiting");
  assert.equal(JSON.stringify(f.read()).includes("Private approval summary"), false);
});

test("approvals are project scoped even when task and attempt IDs repeat", (t) => {
  const f = fixture(t);
  const a = f.attempt("running");
  const scope = f.project("Second project");
  const otherSeat = f.addSeat("Other");
  const secondTask = f.task({ scope, seatId: otherSeat });
  f.raw.prepare("UPDATE tasks SET id = ? WHERE project_id = ? AND id = ?").run(a.taskId, scope, secondTask);
  f.attempt("running", { scope, taskId: a.taskId, seatId: otherSeat, id: a.id });
  const approvalId = f.approval(a.taskId, { scope });
  assert.deepEqual(f.view().needsYou, []);
  assert.equal(f.view(otherSeat).needsYou[0].approvalId, approvalId);
  f.event(a, "progress", { message: "First project" });
  assert.equal(f.view().runs[0].progress.message, "First project");
  assert.equal(f.view(otherSeat).runs[0].progress, null);
});

test("approvals are capped at five and ordered stably", (t) => {
  const f = fixture(t);
  const ids = [];
  for (let i = 0; i < 7; i++) ids.push(f.approval(f.task(), { requestedAt: ago(10_000 - i * 1000) }));
  assert.deepEqual(f.view().needsYou.map((need) => need.approvalId), ids.slice(0, 5));
  assert.deepEqual(f.read(), f.read());
});

test("multiple live runs use attempt seat ownership and newest progress, cut to 160 characters", (t) => {
  const f = fixture(t);
  f.raw.prepare("UPDATE seats SET slots = 2 WHERE id = ?").run(f.seat.id);
  const a = f.attempt("running", { startedAt: ago(10_000) });
  f.raw.prepare("UPDATE tasks SET owner_seat_id = NULL WHERE id = ?").run(a.taskId);
  f.event(a, "state", { to: "leased", reason: "PRIVATE STATE" }, ago(20_000));
  f.event(a, "state", { to: "running" }, ago(5000));
  f.event(a, "progress", { message: "Old progress", percent: 5 });
  const message = "Latest progress ".repeat(30);
  f.event(a, "progress", { message, percent: 60, detail: "PRIVATE DETAIL" }, ago(1000));
  for (const kind of ["output", "evidence", "question", "usage"]) f.event(a, kind, { message: `PRIVATE ${kind}` });
  const b = f.attempt("preparing", { startedAt: ago(3000) });
  const view = f.view();
  assert.equal(view.slots, 2);
  assert.deepEqual(view.runs.map((run) => run.attemptId), [b.id, a.id]);
  assert.equal(view.runs[0].startedAt, ago(3000));
  assert.equal(view.runs[0].progress, null);
  assert.equal(view.runs[1].startedAt, ago(20_000));
  assert.deepEqual(view.runs[1].progress, { message: message.slice(0, 160), percent: 60, at: ago(1000) });
  assert.equal(JSON.stringify(view).includes("PRIVATE"), false);
});

for (const percent of [undefined, null, "60", true, -1, 101, { value: 60 }, 0, 100]) {
  test(`progress percent ${JSON.stringify(percent)} is nullable and bounded`, (t) => {
    const f = fixture(t);
    const a = f.attempt("running");
    f.event(a, "progress", { message: "Working", percent });
    assert.equal(f.view().runs[0].progress.percent, typeof percent === "number" && percent >= 0 && percent <= 100 ? percent : null);
  });
}

test("malformed progress message is ignored instead of exposing its JSON", (t) => {
  const f = fixture(t);
  const a = f.attempt("running");
  f.event(a, "progress", { message: { private: "PRIVATE" }, percent: 50 });
  assert.equal(f.view().runs[0].progress, null);
});

test("display strings are bounded and sanitized without leaking paths or secret-shaped text", (t) => {
  const f = fixture(t);
  const a = f.attempt("running");
  const unsafe = "E:\\private\\work.txt /private/work.txt sk-syntheticsecret fpx_syntheticsecret";
  f.event(a, "progress", { message: unsafe });
  f.raw.prepare("UPDATE projects SET name = ? WHERE id = ?").run(`Project ${unsafe} ${"p".repeat(300)}`, f.projectId);
  f.raw.prepare("UPDATE tasks SET title = ? WHERE id = ?").run(`Task ${unsafe} ${"t".repeat(500)}`, a.taskId);
  f.raw.prepare("UPDATE nodes SET name = ? WHERE id = ?").run(`Node ${unsafe} ${"n".repeat(300)}`, LOCAL_NODE_ID);
  f.raw.prepare("UPDATE seats SET role = ? WHERE id = ?").run("r".repeat(160), f.seat.id);
  const view = f.view();
  const result = f.read();
  assert.equal(view.runs[0].projectName.length, 120);
  assert.equal(view.runs[0].title.length, 240);
  assert.equal(view.role.length, 160);
  assert.equal(result.nodes[0].name.length, 120);
  assert.deepEqual(view.runs[0].progress, { message: "[path] [path] [redacted] [redacted]", percent: null, at: NOW });
  for (const value of ["private", "work.txt", "syntheticsecret", "workspace_root", "leaseId", "provider", "body_json"])
    assert.equal(JSON.stringify(result).includes(value), false, value);
});

for (const hiddenState of ["waiting-input", "unknown"]) {
  test(`eight-run cap still derives status from an older hidden ${hiddenState} attempt`, (t) => {
    const f = fixture(t);
    const hidden = f.attempt(hiddenState);
    const ids = Array.from({ length: 9 }, () => f.attempt("running").id);
    const view = f.view();
    assert.equal(view.runs.length, 8);
    assert.deepEqual(view.runs.map((run) => run.attemptId), ids.slice(-8).reverse());
    assert.equal(view.runs.some((run) => run.attemptId === hidden.id), false);
    assert.equal(view.status, hiddenState === "waiting-input" ? "waiting" : "problem");
  });
}

test("team counts cover every displayed seat, with recently done seats counted as idle capacity", (t) => {
  const f = fixture(t);
  const workers = f.seats.filter((seat) => !seat.isLead);
  f.attempt("running", { seatId: workers[0].id });
  f.approval(f.task({ seatId: workers[1].id }));
  f.attempt("failed", { seatId: workers[2].id });
  f.task({ seatId: workers[3].id, state: "ready" });
  f.attempt("succeeded", { seatId: workers[4].id });
  const team = f.read().teams.find((team) => team.id === f.teamId);
  assert.deepEqual(team.counts, { working: 1, waiting: 1, problem: 1, queued: 1, idle: 3 });
  assert.equal(Object.values(team.counts).reduce((sum, count) => sum + count, 0), team.seats.length);
  assert.equal(team.seats[0].isLead, true);
  assert.deepEqual(team.seats.slice(1).map((seat) => seat.name), f.seats.filter((seat) => !seat.isLead).map((seat) => seat.name));
  assert.deepEqual(team.seats.map((seat) => seat.id), teamViews(f.raw).find((team) => team.id === f.teamId).seats.map((seat) => seat.id));
});

test("every team is included in stable order with lifecycle, even without seats", (t) => {
  const f = fixture(t, { empty: true });
  const paused = f.addTeam("Z paused", "paused");
  const archived = f.addTeam("A archived", "archived");
  const result = f.read();
  assert.deepEqual(result.nodes, []);
  assert.deepEqual(result.teams, [
    { id: archived, name: "A archived", lifecycle: "archived", counts: { working: 0, waiting: 0, problem: 0, queued: 0, idle: 0 }, seats: [] },
    { id: paused, name: "Z paused", lifecycle: "paused", counts: { working: 0, waiting: 0, problem: 0, queued: 0, idle: 0 }, seats: [] },
  ]);
});

test("200-seat limit is global, stable and preserves lead-first then name order", (t) => {
  const f = fixture(t, { empty: true });
  const first = f.addTeam("First");
  const second = f.addTeam("Second");
  for (const team of [first, second]) {
    for (let i = 0; i < 104; i++) f.addSeat(`Worker ${String(i).padStart(3, "0")}`, { team });
    f.addSeat("Z lead", { team, isLead: true });
  }
  const result = f.read();
  assert.equal(result.teams.length, 2);
  assert.equal(result.teams.flatMap((team) => team.seats).length, 200);
  const expected = f.raw.prepare("SELECT id FROM seats ORDER BY team_id, is_lead DESC, name, id LIMIT 200").all().map((row) => row.id);
  assert.deepEqual(result.teams.flatMap((team) => team.seats.map((seat) => seat.id)).sort(), expected.sort());
  for (const team of result.teams) {
    assert.equal(team.seats[0].isLead, true);
    const names = team.seats.slice(1).map((seat) => seat.name);
    assert.deepEqual(names, [...names].sort());
    assert.equal(team.counts.idle, team.seats.length);
  }
  assert.deepEqual(f.read(), result);
});

test("prepared and executed SQL statements stay at eight when seats double from 10 to 20", (t) => {
  const f = fixture(t);
  const a = f.attempt("running");
  f.event(a, "progress", { message: "Working" });
  f.approval(a.taskId);
  for (let i = f.seats.length; i < 10; i++) f.addSeat(`Extra ${i}`);
  const prepare = f.raw.prepare.bind(f.raw);
  let prepared = 0;
  let executed = 0;
  const mock = t.mock.method(f.raw, "prepare", (sql) => {
    prepared += 1;
    const statement = prepare(sql);
    for (const method of ["all", "get", "run"]) {
      const original = statement[method].bind(statement);
      statement[method] = (...args) => { executed += 1; return original(...args); };
    }
    return statement;
  });
  const before = f.read();
  assert.deepEqual({ prepared, executed }, { prepared: 8, executed: 8 });
  mock.mock.restore();
  for (let i = 10; i < 20; i++) f.addSeat(`Extra ${i}`);
  prepared = 0; executed = 0;
  t.mock.method(f.raw, "prepare", mock);
  const after = f.read();
  assert.deepEqual({ prepared, executed }, { prepared: 8, executed: 8 });
  assert.equal(before.teams[0].seats.length, 10);
  assert.equal(after.teams[0].seats.length, 20);
  const oldIds = new Set(before.teams[0].seats.map((seat) => seat.id));
  assert.deepEqual(after.teams[0].seats.filter((seat) => oldIds.has(seat.id)), before.teams[0].seats);
});

test("activity reader preserves attempts, tasks and approvals without any writes", (t) => {
  const f = fixture(t);
  const a = f.attempt("running");
  f.event(a, "progress", { message: "Working", percent: 50 });
  f.approval(a.taskId);
  f.attempt("succeeded");
  f.task({ state: "ready" });
  const before = f.rowCounts();
  assert.ok(f.read().teams.length > 0);
  assert.deepEqual(f.rowCounts(), before);
});

test("GET /org/activity requires a session, returns the versioned shape and does not write", async (t) => {
  const f = fixture(t);
  const a = f.attempt("running");
  f.event(a, "progress", { message: "Working", percent: 60 });
  f.approval(a.taskId);
  const { get } = api(t, f);
  const before = f.rowCounts();
  const anonymous = await get("/org/activity", false);
  assert.equal(anonymous.statusCode, 401);
  assert.equal(anonymous.json().error.code, "needs-auth");
  const response = await get();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { apiVersion: API_VERSION, ok: true, ...f.read() });
  assert.deepEqual(Object.keys(response.json()).sort(), ["apiVersion", "generatedAt", "nodes", "ok", "teams"]);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(f.rowCounts(), before);
});

test("activity route uses the injected clock for generatedAt and status windows", async (t) => {
  const f = fixture(t);
  f.attempt("failed");
  const { get } = api(t, f);
  let result = (await get()).json();
  assert.equal(result.generatedAt, NOW);
  assert.equal(result.teams[0].seats.find((seat) => seat.id === f.seat.id).status, "problem");
  f.advance(WINDOW + 1);
  result = (await get()).json();
  assert.equal(result.generatedAt, new Date(Date.parse(NOW) + WINDOW + 1).toISOString());
  assert.equal(result.teams[0].seats.find((seat) => seat.id === f.seat.id).status, "idle");
});

for (const empty of [false, true]) {
  test(`multi-team disabled follows /teams availability (${empty ? "empty" : "populated"})`, async (t) => {
    const f = fixture(t, { empty, multiTeam: false });
    const { get } = api(t, f);
    const teams = await get("/teams");
    const activity = await get();
    assert.equal(teams.statusCode, 200);
    assert.equal(activity.statusCode, 200);
    assert.deepEqual(activity.json().teams.map((team) => team.id), teams.json().teams.map((team) => team.id));
    assert.equal(activity.json().generatedAt, NOW);
    assert.deepEqual(activity.json(), { apiVersion: API_VERSION, ok: true, ...f.read() });
  });
}
