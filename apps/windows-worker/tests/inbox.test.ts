import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { Store } from "../electron/storage/database";
import { defaultSettings } from "../shared/defaults";
import { normalizeRun, type Run } from "../shared/runs";
import { runIssue, attentionTitle } from "../shared/attention";

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "asf-inbox-"));
  const data = join(directory, "data");
  const store = new Store(data);
  const projects = ["First", "Second"].map((name) => {
    const path = join(directory, name);
    mkdirSync(path);
    return store.addProject(path);
  });
  function run(index = 0, patch: Partial<Run> = {}) {
    const project = projects[index];
    const conversation = store.conversations.create(project.id);
    const r = normalizeRun({
      id: randomUUID(),
      projectId: project.id,
      projectName: project.name,
      workspace: project.path,
      conversationId: conversation.id,
      prompt: "Need attention",
      role: "lead",
      model: "fixture",
      mode: "direct",
      state: "failed",
      settings: defaultSettings(),
      createdAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:01:00.000Z",
      error: "Failed",
      permissions: [],
      tasks: [],
      changes: [],
      commands: [],
      ...patch,
    } as Run);
    store.createRun(r);
    store.updateRun(r);
    return r;
  }
  return {
    directory,
    data,
    store,
    projects,
    run,
    cleanup: () => {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("cross-project inbox is bounded, paginated without duplicate timestamps, redacted and durable independently of actionable state", () => {
  const x = setup();
  try {
    for (let i = 0; i < 54; i++)
      x.run(i % 2, { prompt: `Secret secret-key ${i}`, error: "secret-key" });
    const page = x.store.inbox.list({ unreadOnly: false }, ["secret-key"]);
    assert.equal(page.items.length, 50);
    assert.ok(page.hasMore && page.next);
    assert.equal(new Set(page.items.map((i) => i.projectId)).size, 2);
    assert.ok(
      page.items.every((i) => !JSON.stringify(i).includes("secret-key")),
    );
    const rest = x.store.inbox.list({ unreadOnly: false, before: page.next! });
    assert.equal(rest.items.length, 4);
    assert.equal(rest.hasMore, false);
    assert.equal(
      new Set([...page.items, ...rest.items].map((i) => i.key)).size,
      54,
    );
    const item = page.items[0];
    x.store.inbox.seen({ key: item.key, token: item.token });
    assert.equal(x.store.run(item.runId!).state, "failed");
    assert.equal(
      x.store.inbox
        .list({ unreadOnly: true })
        .items.some((i) => i.key === item.key),
      false,
    );
    const reopened = new Store(x.data);
    try {
      assert.equal(
        reopened.inbox
          .list({ unreadOnly: false })
          .items.find((i) => i.key === item.key)?.unread,
        false,
      );
    } finally {
      reopened.close();
    }
    assert.throws(
      () => x.store.inbox.seen({ key: item.key, token: "0".repeat(64) }),
      /thay đổi/,
    );
  } finally {
    x.cleanup();
  }
});

test("permission changes invalidate seen tokens without exposing permission payload or approving tools", () => {
  const x = setup();
  try {
    const r = x.run(0, {
      state: "blocked",
      endedAt: null,
      permissions: [
        { id: "one", permission: "shell", patterns: ["secret-command"] },
      ],
    });
    const item = x.store.inbox.list({ unreadOnly: true }).items[0];
    assert.equal(item.kind, "permission");
    assert.match(item.token, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(item).includes("secret-command"), false);
    x.store.inbox.seen({ key: item.key, token: item.token });
    assert.equal(x.store.run(r.id).permissions.length, 1);
    r.permissions.push({ id: "two", permission: "edit", patterns: ["other"] });
    x.store.updateRun(r);
    assert.throws(
      () => x.store.inbox.seen({ key: item.key, token: item.token }),
      /thay đổi/,
    );
    assert.equal(x.store.inbox.list({ unreadOnly: true }).items.length, 1);
    r.permissions = [];
    r.state = "completed";
    r.endedAt = new Date().toISOString();
    x.store.updateRun(r);
    assert.equal(x.store.inbox.list({ unreadOnly: false }).items.length, 0);
  } finally {
    x.cleanup();
  }
});

test("held queue and pending questions come from real storage and disappear only when resolved", () => {
  const x = setup();
  try {
    const r = x.run(1, {
      state: "needs_input",
      failure: { code: "needs-context", message: "Need choice", retry: "none" },
      questionRequest: {
        version: 1,
        kind: "questions",
        summary: "Choose scope",
        questions: [
          { id: "q1", title: "Which scope?", required: true, options: [] },
        ],
      },
    });
    const q = x.store.queue.add({
      projectId: x.projects[0].id,
      conversationId: x.store.conversations.create(x.projects[0].id).id,
      prompt: "Held request",
      role: "lead",
      mode: "team",
      settings: defaultSettings(),
      afterRunId: r.id,
      state: "held",
      reason: "Waiting for user",
    });
    const items = x.store.inbox.list({ unreadOnly: false }).items;
    assert.deepEqual(
      new Set(items.map((i) => i.kind)),
      new Set(["question", "queue"]),
    );
    const item = items.find((i) => i.kind === "question")!;
    x.store.inbox.seen({ key: item.key, token: item.token });
    assert.equal(x.store.questions.list(r.conversationId!)[0].state, "pending");
    x.store.questions.supersede(r.conversationId!);
    x.store.queue.remove(q.id);
    assert.equal(x.store.inbox.list({ unreadOnly: false }).items.length, 0);
  } finally {
    x.cleanup();
  }
});

test("retry lineage hides superseded failures and reports need an explicit acceptance policy", () => {
  const x = setup();
  try {
    const r = x.run();
    const next = x.run(0, {
      retryOf: r.id,
      attemptRoot: r.id,
      state: "completed",
    });
    assert.equal(x.store.inbox.list({ unreadOnly: false }).items.length, 0);
    const item = x.store.board.create({
      projectId: next.projectId,
      title: "Result",
      body: "",
      criteria: [],
      suggestedRole: null,
      planningState: "backlog",
      priority: 0,
    });
    const ctx = x.store.board.workChat({
      projectId: item.projectId,
      itemId: item.id,
    });
    const reportRun = x.run(0, {
      state: "completed",
      conversationId: ctx.conversationId,
      workContext: x.store.board.chatSnapshot(
        item.projectId,
        item.id,
        item.revision,
        ctx.conversationId,
      ),
    });
    assert.equal(x.store.inbox.list({ unreadOnly: false }).items.length, 0);
    x.store.reports.setPolicy({
      projectId: item.projectId,
      itemId: item.id,
      required: true,
      version: 0,
    });
    assert.equal(
      x.store.inbox.list({ unreadOnly: false }).items[0]?.kind,
      "report",
    );
    assert.equal(
      x.store.inbox.list({ unreadOnly: false }).items[0]?.runId,
      reportRun.id,
    );
    x.store.board.update({
      id: item.id,
      version: x.store.board.item(item.id).version,
      patch: { title: "New requirement" },
    });
    assert.equal(x.store.inbox.list({ unreadOnly: false }).items.length, 0);
  } finally {
    x.cleanup();
  }
});

test("schema 11 migration backs up, preserves settings/runs and reopens schema 12", () => {
  const x = setup();
  try {
    const r = x.run();
    const db = new Database(join(x.data, "worker.sqlite"));
    db.exec(
      "DROP TABLE inbox_dismissals; DROP TABLE schedule_deliveries; DROP TABLE schedules; DROP TABLE schedule_control; DROP TABLE chat_images; DROP TABLE inbox_seen; PRAGMA user_version=11",
    );
    db.close();
    const reopened = new Store(x.data);
    try {
      assert.ok(
        existsSync(join(x.data, "worker.schema11.pre-inbox.backup.sqlite")),
      );
      assert.equal(reopened.run(r.id).prompt, r.prompt);
      assert.deepEqual(reopened.settings(), x.store.settings());
      assert.equal(reopened.inbox.list({ unreadOnly: true }).items.length, 1);
    } finally {
      reopened.close();
    }
  } finally {
    x.cleanup();
  }
});

test("current work, revision and archive suppress obsolete alerts without deleting run history", () => {
  const x = setup();
  try {
    const item = x.store.board.create({
      projectId: x.projects[0].id,
      title: "Readable work title",
      body: "",
      criteria: [],
      suggestedRole: null,
      planningState: "ready",
      priority: 0,
    });
    const context = x.store.board.workChat({
      projectId: item.projectId,
      itemId: item.id,
    });
    const work = x.store.board.chatSnapshot(
      item.projectId,
      item.id,
      item.revision,
      context.conversationId,
    );
    const first = x.run(0, {
      prompt: "# internal prompt\nDo many things",
      workContext: work,
      conversationId: context.conversationId,
    });
    x.store.board.attachChat(randomUUID(), work, {
      runId: first.id,
      followUpId: null,
    });
    let alert = x.store.inbox.list({ unreadOnly: false }).items[0];
    assert.equal(alert.title, item.title);
    assert.equal(alert.code, item.code);
    assert.equal(alert.itemId, item.id);
    const next = x.run(0, {
      workContext: work,
      conversationId: context.conversationId,
      state: "completed",
    });
    x.store.board.attachChat(randomUUID(), work, {
      runId: next.id,
      followUpId: null,
    });
    assert.equal(x.store.inbox.count(), 0);
    const failed = x.run(0, {
      workContext: work,
      conversationId: context.conversationId,
    });
    x.store.board.attachChat(randomUUID(), work, {
      runId: failed.id,
      followUpId: null,
    });
    assert.equal(x.store.inbox.count(), 1);
    const current = x.store.board.item(item.id);
    x.store.board.update({
      id: item.id,
      version: current.version,
      patch: { body: "New requirement" },
    });
    assert.equal(x.store.inbox.count(), 0);
    const revised = x.store.board.item(item.id);
    const newer = x.run(0, {
      workContext: x.store.board.chatSnapshot(
        item.projectId,
        item.id,
        revised.revision,
        context.conversationId,
      ),
    });
    assert.equal(x.store.inbox.count(), 1);
    x.store.board.archive({
      id: item.id,
      version: revised.version,
      archived: true,
    });
    assert.equal(x.store.inbox.count(), 0);
    assert.equal(x.store.run(first.id).state, "failed");
    assert.equal(x.store.run(newer.id).state, "failed");
  } finally {
    x.cleanup();
  }
});

test("closed alerts are durable, reversible and token scoped; seen never closes or repairs work", () => {
  const x = setup();
  try {
    const run = x.run(0, {
      failure: {
        code: "budget-exhausted",
        message: "No request left",
        retry: "none",
      },
    });
    const item = x.store.inbox.list({ unreadOnly: false }).items[0];
    assert.equal(item.problem, "Hết request");
    assert.match(item.nextAction, /Chia nhỏ/);
    x.store.inbox.seen({ key: item.key, token: item.token });
    assert.equal(x.store.inbox.count(), 1);
    x.store.inbox.dismiss({
      key: item.key,
      token: item.token,
      dismissed: true,
    });
    assert.equal(x.store.inbox.count(), 0);
    assert.equal(x.store.inbox.list({ unreadOnly: false }).items.length, 0);
    const reopened = new Store(x.data);
    try {
      const closed = reopened.inbox.list({ unreadOnly: false, scope: "closed" })
        .items[0];
      assert.ok(closed.dismissed);
      assert.equal(closed.unread, false);
      assert.equal(reopened.run(run.id).state, "failed");
      reopened.inbox.dismiss({
        key: closed.key,
        token: closed.token,
        dismissed: false,
      });
      assert.equal(reopened.inbox.count(), 1);
    } finally {
      reopened.close();
    }
    x.store.inbox.dismiss({
      key: item.key,
      token: item.token,
      dismissed: true,
    });
    run.failure = {
      code: "provider-auth",
      message: "Credential invalid",
      retry: "none",
    };
    x.store.updateRun(run);
    assert.equal(x.store.inbox.count(), 1);
    assert.equal(
      x.store.inbox.list({ unreadOnly: false, scope: "closed" }).items.length,
      0,
    );
    assert.throws(
      () =>
        x.store.inbox.dismiss({
          key: item.key,
          token: item.token,
          dismissed: true,
        }),
      /thay đổi/,
    );
    const permission = x.run(1, {
      state: "blocked",
      permissions: [{ id: "p", permission: "edit", patterns: ["file"] }],
    });
    const pending = x.store.inbox
      .list({ unreadOnly: false })
      .items.find((i) => i.runId === permission.id)!;
    assert.equal(pending.canDismiss, false);
    assert.throws(
      () =>
        x.store.inbox.dismiss({
          key: pending.key,
          token: pending.token,
          dismissed: true,
        }),
      /Chỉ đóng/,
    );
  } finally {
    x.cleanup();
  }
});

test("filters use persisted project and workflow category; legacy context-only chat is not work to resolve", () => {
  const x = setup();
  try {
    const first = x.run(0);
    x.run(1, {
      state: "needs_input",
      failure: {
        code: "needs-context",
        message: "Tell me more",
        retry: "none",
      },
    });
    x.run(1, {
      state: "failed",
      failure: {
        code: "needs-context",
        message: "Tell me more",
        retry: "none",
      },
    });
    const question = x.run(1, {
      state: "needs_input",
      failure: { code: "needs-context", message: "Need scope", retry: "none" },
      questionRequest: {
        version: 1,
        kind: "questions",
        summary: "Scope decision",
        questions: [
          { id: "q1", title: "Which scope?", required: true, options: [] },
        ],
      },
    });
    assert.equal(x.store.inbox.count(), 2);
    assert.deepEqual(
      x.store.inbox
        .list({ unreadOnly: false, projectId: x.projects[0].id })
        .items.map((i) => i.runId),
      [first.id],
    );
    const decisions = x.store.inbox.list({
      unreadOnly: false,
      category: "decision",
    }).items;
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].runId, question.id);
    assert.equal(
      x.store.inbox.list({ unreadOnly: false, category: "blocked" }).items
        .length,
      1,
    );
    assert.throws(
      () =>
        x.store.inbox.dismiss({
          key: decisions[0].key,
          token: decisions[0].token,
          dismissed: true,
        }),
      /Chỉ đóng/,
    );
  } finally {
    x.cleanup();
  }
});

test("issue projection finds latest failing task and distinguishes review from completed workers", () => {
  const base = { state: "failed" as const, error: "Runtime failed", tasks: [] };
  const failed = {
    id: "t1",
    role: "fe" as const,
    title: "Build UI",
    kind: "work" as const,
    state: "failed" as const,
    error: "npm build failed",
    failure: {
      code: "tool-test-failure" as const,
      message: "Failed build",
      retry: "manual" as const,
    },
  };
  assert.equal(runIssue({ ...base, tasks: [failed] })!.taskId, "t1");
  assert.match(runIssue({ ...base, tasks: [failed] })!.nextAction, /lệnh lỗi/);
  const fixed = {
    ...failed,
    id: "t1-fix",
    originalTaskId: "t1",
    state: "completed" as const,
    error: "",
    failure: undefined,
  };
  const reviewed = runIssue({
    ...base,
    tasks: [failed, fixed],
    review: {
      status: "blocked",
      summary: "Missing proof",
      acceptance: [
        {
          criterion: "Build passes",
          status: "unverified",
          evidence: "Missing",
        },
      ],
    },
  })!;
  assert.equal(reviewed.taskId, null);
  assert.equal(reviewed.label, "Review chưa đạt");
  assert.deepEqual(reviewed.criteria, ["Build passes"]);
  assert.equal(runIssue({ ...base, state: "completed" }), null);
  assert.equal(
    attentionTitle("# W-0001 · **Readable**\nInternal details"),
    "Readable",
  );
});

test("schema14 backup precedes attention metadata and preserves runs, settings and read state", () => {
  const x = setup();
  try {
    const run = x.run();
    const item = x.store.inbox.list({ unreadOnly: false }).items[0];
    x.store.inbox.seen({ key: item.key, token: item.token });
    const db = new Database(join(x.data, "worker.sqlite"));
    db.exec("DROP TABLE inbox_dismissals; PRAGMA user_version=14");
    db.close();
    const reopened = new Store(x.data);
    try {
      assert.equal(reopened.run(run.id).state, "failed");
      assert.deepEqual(reopened.settings(), x.store.settings());
      assert.equal(
        reopened.inbox.list({ unreadOnly: false }).items[0].unread,
        false,
      );
      const backup = new Database(
        join(x.data, "worker.schema14.pre-attention.backup.sqlite"),
        { readonly: true },
      );
      try {
        assert.equal(backup.pragma("user_version", { simple: true }), 14);
        assert.equal(
          backup
            .prepare(
              "SELECT name FROM sqlite_master WHERE name='inbox_dismissals'",
            )
            .get(),
          undefined,
        );
      } finally {
        backup.close();
      }
    } finally {
      reopened.close();
    }
  } finally {
    x.cleanup();
  }
});
