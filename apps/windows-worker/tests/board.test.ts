import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
    assert.equal(card().column, "done");
    assert.equal(card().progress.verified, 1);
    run.review.acceptance[0].status = "unverified";
    x.store.updateRun(run);
    assert.equal(card().column, "review");
    run.tasks = [];
    run.review = null;
    x.store.updateRun(run);
    assert.equal(card().reason, "Có phản hồi, chưa có task");
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
      conversationId: randomUUID(),
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
