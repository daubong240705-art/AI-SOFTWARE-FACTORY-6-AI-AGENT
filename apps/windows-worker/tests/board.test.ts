import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { Store } from "../electron/storage/database";
import { RunController } from "../electron/controller/runs";
import { projectBoard } from "../electron/controller/board";
import { defaultSettings } from "../shared/defaults";
import { createBoardItemSchema, updateBoardItemSchema } from "../shared/board";
import type { Run } from "../shared/runs";
import type { TeamTask } from "../shared/team";
import { stripWorkSchema } from "./legacy-board-fixture";

function setup() {
  const parent = resolve(".cache");
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, "board-test-"));
  const store = new Store(directory),
    project = store.addProject(directory);
  const settings = defaultSettings();
  settings.gatewayUrl = "https://unused.example/v1";
  settings.agents.forEach((a) => {
    a.model = "fixture-model";
  });
  store.save(settings, undefined);
  const controller = new RunController(store, directory, () => undefined);
  const create = (
    title: string,
    planningState: "backlog" | "ready" = "backlog",
  ) =>
    store.board.create({
      projectId: project.id,
      title,
      body: "Yêu cầu",
      priority: 0,
      suggestedRole: null,
      planningState,
    });
  const close = () => {
    (controller as unknown as { active?: unknown }).active = undefined;
    store.close();
    assert.ok(directory.startsWith(join(parent, "board-test-")));
    rmSync(directory, { recursive: true, force: true });
  };
  return { directory, store, project, settings, controller, create, close };
}
function fixture(x: ReturnType<typeof setup>, patch: Partial<Run> = {}): Run {
  return {
    id: randomUUID(),
    projectId: x.project.id,
    projectName: "Project",
    workspace: x.directory,
    prompt: "Công việc",
    role: "lead",
    model: "fixture-model",
    mode: "team",
    tasks: [],
    profiles: [],
    currentTaskId: null,
    fixRound: 0,
    review: null,
    state: "completed",
    settings: x.settings,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    sessionId: null,
    summary: "Done",
    error: "",
    changes: [],
    commands: [],
    permissions: [],
    requests: 0,
    baselineComplete: true,
    toolsCompleted: 0,
    runtimeVersion: "fixture",
    inputTokens: 0,
    outputTokens: 0,
    ...patch,
  };
}
function task(id: string, patch: Partial<TeamTask> = {}): TeamTask {
  return {
    id,
    role: "be",
    title: id,
    instructions: "Work",
    allowedPaths: ["src"],
    acceptance: ["Done"],
    dependsOn: [],
    state: "completed",
    model: "fixture",
    kind: "work",
    round: 0,
    sessionId: null,
    startedAt: null,
    endedAt: null,
    summary: "",
    error: "",
    changes: [],
    commandIds: [],
    ...patch,
  };
}

test("backlog versions, move order, archive and reopen preserve data and reject runtime mutation", () => {
  const x = setup();
  try {
    const a = x.create("A"),
      b = x.create("B");
    const moved = x.store.board.move({
      id: b.id,
      version: b.version,
      planningState: "backlog",
      beforeId: a.id,
    });
    assert.deepEqual(
      x.store.board.summaries(x.project.id).map((i) => i.title),
      ["B", "A"],
    );
    assert.throws(
      () =>
        x.store.board.update({
          id: a.id,
          version: a.version,
          patch: { title: "stale" },
        }),
      /Thẻ đã thay đổi/,
    );
    const edited = x.store.board.update({
      id: moved.id,
      version: moved.version,
      patch: { title: "Đã sửa", priority: 2, body: "Giữ nội dung" },
    });
    const archived = x.store.board.archive({
      id: edited.id,
      version: edited.version,
      archived: true,
    });
    assert.ok(archived.archivedAt);
    const restored = x.store.board.archive({
      id: archived.id,
      version: archived.version,
      archived: false,
    });
    assert.equal(restored.archivedAt, null);
    const other = new Store(x.directory);
    assert.equal(other.board.item(b.id).body, "Giữ nội dung");
    other.close();
    assert.throws(() => x.store.removeProject(x.project.id), /Kanban/);
    assert.equal(
      updateBoardItemSchema.safeParse({
        id: b.id,
        version: restored.version,
        patch: { state: "completed" },
      }).success,
      false,
    );
    assert.equal(
      createBoardItemSchema.safeParse({
        projectId: randomUUID(),
        title: "A",
        body: "",
        priority: 9,
        suggestedRole: null,
        planningState: "done",
      }).success,
      false,
    );
  } finally {
    x.close();
  }
});

test("submit to Lead is atomic and idempotent; runtime cards cannot be edited or moved", () => {
  const x = setup();
  try {
    const item = x.create("Triển khai API", "ready");
    const result = x.controller.submitBoard({
      id: item.id,
      version: item.version,
    });
    assert.ok(result.runId);
    assert.equal(result.queued, false);
    const again = x.controller.submitBoard({
      id: item.id,
      version: item.version,
    });
    assert.equal(again.runId, result.runId);
    assert.equal(x.store.runs().length, 1);
    assert.equal(x.store.run(result.runId!).mode, "team");
    const linked = x.store.board.item(item.id);
    assert.throws(
      () =>
        x.store.board.update({
          id: item.id,
          version: linked.version,
          patch: { planningState: "backlog" },
        }),
      /thực thi/,
    );
    assert.throws(
      () =>
        x.store.board.move({
          id: item.id,
          version: linked.version,
          planningState: "backlog",
        }),
      /thực thi/,
    );
    assert.throws(
      () =>
        x.store.board.archive({
          id: item.id,
          version: linked.version,
          archived: true,
        }),
      /liên kết/,
    );
    const snapshot = x.controller.monitor({
      projectId: x.project.id,
      board: {},
    });
    assert.equal(snapshot.unchanged, false);
    if (!snapshot.unchanged) {
      assert.equal(snapshot.snapshot.board!.cards.length, 1);
      assert.equal(snapshot.snapshot.board!.cards[0].key, `item:${item.id}`);
    }
  } finally {
    x.close();
  }
});

test("failed submission rolls back conversation, run insertion, card link and in-memory execution", () => {
  const x = setup();
  try {
    const item = x.create("Failure", "ready");
    const db = new Database(join(x.directory, "worker.sqlite"));
    db.exec(
      "CREATE TRIGGER fail_board BEFORE INSERT ON board_links BEGIN SELECT RAISE(ABORT, 'synthetic link failure'); END;",
    );
    assert.throws(
      () => x.controller.submitBoard({ id: item.id, version: item.version }),
      /synthetic link failure/,
    );
    assert.equal(x.controller.view().activeId, null);
    assert.equal(x.store.runs().length, 0);
    assert.equal(x.store.board.link(item.id), null);
    assert.equal(x.store.conversations.list().length, 0);
    assert.equal(x.store.board.item(item.id).version, item.version);
    db.exec("DROP TRIGGER fail_board");
    db.close();
  } finally {
    x.close();
  }
});

test("busy run queues card; claim links to real run atomically; deleting queue releases card", () => {
  const x = setup();
  try {
    const first = x.create("First", "ready"),
      second = x.create("Second", "ready"),
      third = x.create("Third", "ready");
    const active = x.controller.submitBoard({
      id: first.id,
      version: first.version,
    });
    const queued = x.controller.submitBoard({
      id: second.id,
      version: second.version,
    });
    const removed = x.controller.submitBoard({
      id: third.id,
      version: third.version,
    });
    assert.ok(queued.followUpId);
    assert.ok(removed.followUpId);
    assert.equal(x.store.runs().length, 1);
    assert.throws(
      () => x.store.queue.edit(queued.followUpId!, "overwrite"),
      /Kanban/,
    );
    x.store.queue.remove(removed.followUpId!);
    assert.equal(x.store.board.link(third.id), null);
    assert.equal(x.store.board.item(third.id).planningState, "ready");
    const previous = x.store.run(active.runId!);
    previous.state = "completed";
    x.store.updateRun(previous);
    (x.controller as unknown as { active?: unknown }).active = undefined;
    const run = x.controller.resume(queued.followUpId!);
    assert.equal(x.store.board.link(second.id)!.runId, run.id);
    assert.equal(x.store.board.link(second.id)!.followUpId, null);
    assert.equal(x.store.queue.list().length, 0);
  } finally {
    x.close();
  }
});

test("queue claim rollback keeps the original link and suppresses rolled-back runtime startup", () => {
  const x = setup();
  try {
    const chat = x.store.conversations.create(x.project.id);
    x.controller.enqueue(x.project.id, chat.id, "held", "lead", "team");
    const item = x.create("Queued", "ready"),
      result = x.controller.submitBoard({ id: item.id, version: item.version });
    const db = new Database(join(x.directory, "worker.sqlite"));
    db.exec(
      "CREATE TRIGGER fail_claim BEFORE UPDATE ON board_links WHEN NEW.run_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'synthetic claim failure'); END;",
    );
    assert.throws(
      () => x.controller.resume(result.followUpId!),
      /synthetic claim failure/,
    );
    assert.equal(x.controller.view().activeId, null);
    assert.equal(x.store.runs().length, 0);
    assert.equal(x.store.board.link(item.id)!.followUpId, result.followUpId);
    assert.ok(x.store.queue.get(result.followUpId!));
    db.exec("DROP TRIGGER fail_claim");
    db.close();
  } finally {
    x.close();
  }
});

test("runtime columns distinguish conversation, unverified work, review, stop, conflict and verified completion", () => {
  const x = setup();
  try {
    const run = fixture(x, {
      tasks: [
        task("t1"),
        task("t1-fix-1", { kind: "fix", originalTaskId: "t1" }),
      ],
    });
    x.store.createRun(run);
    x.store.updateRun(run);
    const card = () =>
      projectBoard([], [], x.store.boardRuns(x.project.id), [], {}).cards[0];
    assert.equal(card().column, "review");
    assert.equal(card().progress.tasks, 1);
    assert.equal(card().progress.verified, 0);
    run.review = {
      version: 2,
      status: "completed",
      summary: "Done",
      acceptance: [
        {
          criterionId: "t1:ac1",
          criterion: "Done",
          status: "passed",
          evidence: "immutable",
          method: "source",
          refs: [],
        },
      ],
      fixes: [],
      limitations: [],
      verification: { verified: true, issues: [] },
    };
    x.store.updateRun(run);
    assert.equal(
      card().column,
      "review",
      "review claims without stored report evidence cannot mark Done",
    );
    assert.equal(card().progress.verified, 0);
    run.review.acceptance[0].status = "unverified";
    x.store.updateRun(run);
    assert.equal(card().column, "review");
    run.tasks = [];
    run.review = null;
    x.store.updateRun(run);
    assert.equal(card().reason, "Lead đã trả lời");
    run.state = "cancelled";
    x.store.updateRun(run);
    assert.equal(
      projectBoard([], [], x.store.boardRuns(x.project.id), [], {}).cards
        .length,
      0,
    );
    assert.equal(
      projectBoard([], [], x.store.boardRuns(x.project.id), [], {
        showStopped: true,
      }).cards[0].stopped,
      true,
    );
    run.state = "interrupted";
    x.store.updateRun(run);
    assert.equal(card().column, "blocked");
  } finally {
    x.close();
  }
});

test("Board, overview, roster and inbox agree on pending permissions without exporting command payload", () => {
  const x = setup();
  try {
    const run = fixture(x, {
      state: "blocked",
      endedAt: null,
      tasks: [task("t1", { state: "blocked" })],
      permissions: [
        {
          id: "permission",
          permission: "bash",
          patterns: ["private-command-payload"],
          taskId: "t1",
        },
      ],
    });
    x.store.createRun(run);
    const response = x.controller.monitor({
      projectId: x.project.id,
      board: {},
      overview: true,
    });
    assert.equal(response.unchanged, false);
    if (response.unchanged) throw Error("Missing state");
    const snapshot = response.snapshot;
    const card = snapshot.board!.cards[0];
    assert.equal(card.column, "blocked");
    assert.equal(card.workState?.label, "Chờ cấp quyền");
    assert.match(card.reason, /Chờ cấp quyền/);
    assert.equal(snapshot.workState?.label, card.workState?.label);
    assert.equal(
      snapshot.overview!.runs[0].workState?.label,
      card.workState?.label,
    );
    assert.equal(
      x.store.inbox.list({ unreadOnly: false }).items[0].kind,
      "permission",
    );
    assert.ok(!JSON.stringify(snapshot).includes("private-command-payload"));
    run.permissions = [];
    run.error = "Workspace unavailable";
    x.store.updateRun(run);
    const next = x.controller.monitor({ projectId: x.project.id, board: {} });
    if (next.unchanged) throw Error("Missing update");
    assert.equal(next.snapshot.workState?.label, "Cần xử lý");
    assert.match(next.snapshot.board!.cards[0].reason, /Workspace unavailable/);
  } finally {
    x.close();
  }
});

test("project history pagination/filtering exceeds 50 runs, deduplicates retry and excludes raw settings/output", () => {
  const x = setup();
  try {
    for (let i = 0; i < 56; i++) {
      const run = fixture(x, {
        prompt: `Task ${i}`,
        tasks: [
          task(`t${i + 1}`, {
            role: i === 0 ? "fe" : "be",
            title: i === 0 ? "Đổi giao diện" : "Task",
          }),
        ],
      });
      x.store.createRun(run);
      x.store.updateRun(run);
    }
    let page = projectBoard([], [], x.store.boardRuns(x.project.id), [], {});
    assert.equal(page.total, 56);
    assert.equal(page.cards.length, 50);
    assert.equal(page.hasMore, true);
    page = projectBoard([], [], x.store.boardRuns(x.project.id), [], {
      search: "doi giao dien",
      role: "fe",
    });
    assert.equal(page.total, 1);
    const previous = x.store.run(page.cards[0].runId!);
    const next = fixture(x, {
      retryOf: previous.id,
      attemptRoot: previous.id,
      tasks: [task("t1")],
    });
    x.store.createRun(next);
    x.store.updateRun(next);
    assert.equal([...x.store.boardRuns(x.project.id)].length, 56);
    assert.equal(
      projectBoard([], [], x.store.boardRuns(x.project.id), [], {
        runId: previous.id,
      }).cards[0].runId,
      next.id,
    );
    const json = JSON.stringify(
      projectBoard([], [], x.store.boardRuns(x.project.id), [], {}),
    );
    assert.ok(!json.includes("gatewayUrl"));
    assert.ok(!json.includes("allowedPaths"));
  } finally {
    x.close();
  }
});

test("board links protect retention and preview revalidation, persist exports and follow retry", () => {
  const x = setup();
  try {
    const item = x.create("Protected", "ready"),
      old = fixture(x, { createdAt: "2020-01-01T00:00:00.000Z" });
    x.store.createRun(old);
    x.store.updateRun(old);
    const preview = x.store.retention(1, 0);
    assert.ok(preview.runIds.includes(old.id));
    x.store.board.submit({ id: item.id, version: item.version }, () => ({
      itemId: item.id,
      runId: old.id,
      followUpId: null,
      conversationId: x.store.conversations.create(x.project.id).id,
      queued: false,
      createdAt: new Date().toISOString(),
    }));
    assert.throws(() => x.store.prune(preview.token), /Kanban/);
    assert.ok(!x.store.retention(1, 0).runIds.includes(old.id));
    assert.equal(
      JSON.parse(x.store.report(old.id)).boardLinks[0].itemId,
      item.id,
    );
    const next = fixture(x, { retryOf: old.id, attemptRoot: old.id });
    x.store.createRun(next);
    x.store.updateRun(next);
    assert.equal(x.store.board.link(item.id)!.runId, next.id);
  } finally {
    x.close();
  }
});

test("work revisions, idempotent comments and submissions persist without rewriting old prompts or duplicating cards", () => {
  const x = setup();
  try {
    let item = x.create("Original", "ready");
    assert.equal(item.code, "W-0001");
    assert.equal(x.create("Other").code, "W-0002");
    const chat = x.store.conversations.create(x.project.id);
    const first = fixture(x, {
      createdAt: "2020-01-01T00:00:00Z",
      conversationId: chat.id,
      prompt: "Original snapshot",
    });
    x.store.createRun(first);
    x.store.updateRun(first);
    const submit = (run: Run, key: string) =>
      x.store.board.submit(
        { id: item.id, version: item.version, submissionKey: key },
        () => ({
          itemId: item.id,
          runId: run.id,
          followUpId: null,
          conversationId: chat.id,
          queued: false,
          createdAt: run.createdAt,
        }),
      );
    const key = randomUUID();
    submit(first, key);
    assert.equal(submit(first, key).runId, first.id);
    item = x.store.board.item(item.id);
    const oldVersion = item.version;
    item = x.store.board.update({
      id: item.id,
      version: item.version,
      patch: { body: "Revised", criteria: ["Acceptance"] },
    });
    assert.equal(item.revision, 2);
    assert.throws(
      () =>
        x.store.board.update({
          id: item.id,
          version: oldVersion,
          patch: { title: "Stale" },
        }),
      /thay đổi/,
    );
    let page = x.controller.monitor({ projectId: x.project.id, board: {} });
    if (!page.unchanged)
      assert.equal(
        page.snapshot.board!.cards.find((c) => c.itemId === item.id)!.column,
        "ready",
      );
    const second = fixture(x, {
      conversationId: chat.id,
      createdAt: "2020-01-02T00:00:00Z",
    });
    x.store.createRun(second);
    x.store.updateRun(second);
    submit(second, randomUUID());
    const retry = fixture(x, {
      retryOf: first.id,
      attemptRoot: first.id,
      createdAt: "2020-01-03T00:00:00Z",
    });
    x.store.createRun(retry);
    x.store.updateRun(retry);
    page = x.controller.monitor({ projectId: x.project.id, board: {} });
    if (!page.unchanged) {
      assert.equal(page.snapshot.board!.total, 2);
      assert.equal(
        page.snapshot.board!.cards.find((c) => c.itemId === item.id)!.runId,
        second.id,
      );
    }
    const ref = { projectId: x.project.id, itemId: item.id };
    const id = randomUUID();
    const comment = { ...ref, clientId: id, body: "Ghi chú tiếng Việt" };
    assert.deepEqual(
      x.store.board.addComment(comment),
      x.store.board.addComment(comment),
    );
    assert.throws(
      () => x.store.board.addComment({ ...comment, body: "Other" }),
      /nội dung khác/,
    );
    assert.throws(
      () => x.store.board.detail({ ...ref, projectId: randomUUID() }),
      /không thuộc/,
    );
    const reopened = new Store(x.directory);
    const detail = reopened.board.detail(ref);
    assert.equal(detail.comments.length, 1);
    assert.equal(detail.submissions.length, 2);
    assert.equal(
      detail.revisions.find((r) => r.revision === 1)!.body,
      "Yêu cầu",
    );
    assert.deepEqual(detail.revisions[0].criteria, ["Acceptance"]);
    assert.equal(reopened.run(first.id).prompt, "Original snapshot");
    assert.equal(JSON.parse(reopened.report(first.id)).workItem.revision, 1);
    assert.equal(reopened.board.exportItem(ref).attempts.length, 3);
    const deepLink = projectBoard(
      reopened.board.summaries(x.project.id),
      reopened.board.projectionLinks(x.project.id),
      reopened.boardRuns(x.project.id),
      [],
      { runId: first.id },
    );
    assert.equal(deepLink.total, 1);
    assert.equal(deepLink.cards[0].itemId, item.id);
    assert.equal(reopened.retention(1, 0).runIds.length, 0);
    reopened.close();
  } finally {
    x.close();
  }
});

test("materializing a legacy retry lineage is explicit, project scoped and idempotent", () => {
  const x = setup();
  try {
    const first = fixture(x),
      retry = fixture(x, { retryOf: first.id, attemptRoot: first.id });
    x.store.createRun(first);
    x.store.updateRun(first);
    x.store.createRun(retry);
    x.store.updateRun(retry);
    assert.equal(x.store.board.summaries(x.project.id).length, 0);
    assert.throws(
      () =>
        x.store.board.materialize({ projectId: randomUUID(), runId: first.id }),
      /không thuộc/,
    );
    const item = x.store.board.materialize({
      projectId: x.project.id,
      runId: first.id,
    });
    assert.equal(
      x.store.board.materialize({ projectId: x.project.id, runId: retry.id })
        .id,
      item.id,
    );
    assert.equal(
      x.store.board.detail({ projectId: x.project.id, itemId: item.id })
        .revisions[0].origin,
      "legacy",
    );
    const page = x.controller.monitor({ projectId: x.project.id, board: {} });
    if (!page.unchanged) assert.equal(page.snapshot.board!.total, 1);
  } finally {
    x.close();
  }
});

test("schema7 upgrade backs up populated planning, archived, linked retry and held queue records", () => {
  const x = setup();
  let reopened: Store | undefined;
  const planning = x.create("Planning"),
    archived = x.create("Archived");
  x.store.board.archive({
    id: archived.id,
    version: archived.version,
    archived: true,
  });
  const linked = x.create("Linked", "ready"),
    queued = x.create("Queued", "ready");
  const chat = x.store.conversations.create(x.project.id);
  const first = fixture(x, { conversationId: chat.id }),
    retry = fixture(x, {
      conversationId: chat.id,
      retryOf: first.id,
      attemptRoot: first.id,
    });
  x.store.createRun(first);
  x.store.updateRun(first);
  x.store.board.submit({ id: linked.id, version: linked.version }, () => ({
    itemId: linked.id,
    runId: first.id,
    followUpId: null,
    conversationId: chat.id,
    queued: false,
    createdAt: first.createdAt,
  }));
  x.store.createRun(retry);
  x.store.updateRun(retry);
  const follow = x.store.queue.add({
    projectId: x.project.id,
    conversationId: chat.id,
    prompt: "Snapshot held",
    role: "lead",
    mode: "team",
    settings: x.settings,
    afterRunId: null,
    state: "held",
    reason: "Manual",
  });
  x.store.board.submit({ id: queued.id, version: queued.version }, () => ({
    itemId: queued.id,
    runId: null,
    followUpId: follow.id,
    conversationId: chat.id,
    queued: true,
    createdAt: follow.createdAt,
  }));
  x.store.close();
  try {
    const db = new Database(join(x.directory, "worker.sqlite"));
    stripWorkSchema(db);
    db.pragma("user_version=7");
    db.close();
    reopened = new Store(x.directory);
    assert.ok(
      existsSync(
        join(x.directory, "worker.schema7.pre-work-items.backup.sqlite"),
      ),
    );
    const backup = new Database(
      join(x.directory, "worker.schema7.pre-work-items.backup.sqlite"),
      { readonly: true },
    );
    assert.equal(backup.pragma("user_version", { simple: true }), 7);
    assert.equal(
      (
        backup.prepare("SELECT count(*) AS n FROM board_items").get() as {
          n: number;
        }
      ).n,
      4,
    );
    backup.close();
    assert.equal(reopened.board.item(planning.id).id, planning.id);
    assert.ok(reopened.board.item(archived.id).archivedAt);
    const detail = reopened.board.detail({
      projectId: x.project.id,
      itemId: linked.id,
    });
    assert.equal(detail.submissions[0].currentRunId, retry.id);
    assert.equal(detail.submissions[0].attempts.length, 2);
    assert.equal(reopened.queue.get(follow.id).state, "held");
    assert.equal(reopened.queue.get(follow.id).boardItemId, queued.id);
    assert.throws(() => reopened!.queue.edit(follow.id, "Replace"), /Kanban/);
    const snapshot = reopened.board.detail({
      projectId: x.project.id,
      itemId: queued.id,
    });
    assert.equal(snapshot.submissions[0].followUpId, follow.id);
    reopened.queue.remove(follow.id);
    assert.equal(
      reopened.board.detail({ projectId: x.project.id, itemId: queued.id })
        .submissions[0].state,
      "removed",
    );
    assert.equal(
      reopened.board.create({
        projectId: x.project.id,
        title: "Next",
        body: "",
        priority: 0,
        suggestedRole: null,
        planningState: "backlog",
      }).code,
      "W-0005",
    );
  } finally {
    reopened?.close();
    rmSync(x.directory, { recursive: true, force: true });
  }
});

test("work pages bound revisions/comments and traverse without gaps; queue snapshots keep their original revision", () => {
  const x = setup();
  try {
    let item = x.create("Paged", "ready");
    const ref = { projectId: x.project.id, itemId: item.id };
    const chat = x.store.conversations.create(x.project.id);
    x.store.queue.add({
      projectId: x.project.id,
      conversationId: chat.id,
      prompt: "Held",
      role: "lead",
      mode: "team",
      settings: x.settings,
      afterRunId: null,
      state: "held",
      reason: "Manual",
    });
    const first = x.controller.submitBoard({
      id: item.id,
      version: item.version,
      submissionKey: randomUUID(),
    });
    for (let i = 0; i < 25; i++) {
      item = x.store.board.item(item.id);
      item = x.store.board.update({
        id: item.id,
        version: item.version,
        patch: { body: `Revision ${i}` },
      });
    }
    for (let i = 0; i < 55; i++)
      x.store.board.addComment({
        ...ref,
        clientId: randomUUID(),
        body: `Comment ${i}`,
      });
    const page = x.store.board.detail(ref);
    assert.equal(page.revisions.length, 20);
    assert.equal(page.hasEarlierRevisions, true);
    const rest = x.store.board.detail({
      ...ref,
      before: page.revisions.at(-1)!.revision,
    });
    assert.equal(rest.revisions.length, 6);
    assert.equal(rest.hasEarlierRevisions, false);
    assert.equal(
      new Set([...page.revisions, ...rest.revisions].map((r) => r.revision))
        .size,
      26,
    );
    assert.equal(page.comments.length, 50);
    assert.equal(page.hasEarlierComments, true);
    const older = x.store.board.commentPage({
      ...ref,
      before: page.comments.at(-1)!.sequence,
    });
    assert.equal(older.comments.length, 5);
    assert.equal(older.hasMore, false);
    assert.equal(
      new Set([...page.comments, ...older.comments].map((c) => c.id)).size,
      55,
    );
    assert.equal(page.submissions[0].revision, 1);
    assert.ok(x.store.queue.get(first.followUpId!).prompt.includes("Yêu cầu"));
    assert.ok(
      !x.store.queue.get(first.followUpId!).prompt.includes("Revision 24"),
    );
    assert.throws(
      () =>
        x.controller.submitBoard({
          id: item.id,
          version: item.version,
          submissionKey: randomUUID(),
        }),
      /chờ lượt/,
    );
    x.store.queue.remove(first.followUpId!);
    const key = randomUUID();
    item = x.store.board.item(item.id);
    const next = x.controller.submitBoard({
      id: item.id,
      version: item.version,
      submissionKey: key,
    });
    assert.equal(
      x.store.queue.get(next.followUpId!).conversationId,
      first.conversationId,
    );
    assert.equal(x.store.queue.get(next.followUpId!).boardItemId, item.id);
    assert.equal(x.store.board.detail(ref).submissions[0].revision, 26);
    x.store.queue.remove(next.followUpId!);
    assert.throws(
      () =>
        x.controller.submitBoard({
          id: item.id,
          version: item.version,
          submissionKey: key,
        }),
      /bỏ khỏi/,
    );
  } finally {
    x.close();
  }
});
