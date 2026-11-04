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
    db.exec("DROP TABLE inbox_seen; PRAGMA user_version=11");
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
