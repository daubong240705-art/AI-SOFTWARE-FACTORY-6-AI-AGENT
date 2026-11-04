import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { Event } from "@opencode-ai/sdk/v2/client";
import { Store } from "../electron/storage/database";
import { RunController } from "../electron/controller/runs";
import { VisibleText } from "../electron/runtime/visible-text";
import { defaultSettings } from "../shared/defaults";

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "asf-ww4b-"));
  const store = new Store(directory);
  const project = store.addProject(directory);
  const chat = store.conversations.create(project.id);
  const settings = defaultSettings();
  settings.gatewayUrl = "https://unused.example/v1";
  settings.agents.find((a) => a.role === "be")!.model = "test-model";
  store.save(settings, undefined);
  const controller = new RunController(store, directory, () => undefined);
  return { directory, store, project, chat, settings, controller };
}
test("follow-ups persist edits/order, claim atomically and relink successors", () => {
  const x = setup();
  try {
    const a = x.controller.enqueue(
      x.project.id,
      x.chat.id,
      "First",
      "be",
      "direct",
    );
    const b = x.controller.enqueue(
      x.project.id,
      x.chat.id,
      "Second",
      "be",
      "direct",
    );
    x.store.queue.edit(a.id, "Edited first");
    assert.throws(
      () =>
        x.store.queue.claim(a.id, () => {
          throw new Error("start failed");
        }),
      /start failed/,
    );
    assert.equal(x.store.queue.get(a.id).prompt, "Edited first");
    x.store.queue.save({ ...x.store.queue.get(b.id), state: "waiting" });
    assert.equal(
      x.store.queue.claim(a.id, () => ({ id: "new-run", value: 42 })),
      42,
    );
    assert.equal(x.store.queue.get(b.id).afterRunId, "new-run");
    x.store.close();
    const reopened = new Store(x.directory);
    try {
      assert.equal(reopened.queue.list()[0].id, b.id);
      reopened.queue.remove(b.id);
      assert.equal(reopened.queue.list().length, 0);
      assert.throws(() => reopened.queue.edit(b.id, "gone"));
    } finally {
      reopened.close();
    }
  } finally {
    if (x.store) {
      try {
        x.store.close();
      } catch {}
    }
    rmSync(x.directory, { recursive: true, force: true });
  }
});
test("cancel holds queued work, manual resume keeps the global lock, retry preserves old attempt", async () => {
  const x = setup();
  try {
    const run = x.controller.start(
      x.project.id,
      "Original",
      "be",
      "direct",
      x.chat.id,
    );
    const queued = x.controller.enqueue(
      x.project.id,
      x.chat.id,
      "Next",
      "be",
      "direct",
    );
    assert.equal(queued.state, "waiting");
    assert.throws(() => x.controller.resume(queued.id), /đang chạy/);
    await x.controller.stop(run.id);
    assert.equal(x.store.queue.get(queued.id).state, "held");
    assert.equal(x.controller.view().activeId, null);
    const attempt = x.controller.retry(run.id);
    const later = x.controller.enqueue(
      x.project.id,
      x.chat.id,
      "Keep queue order",
      "be",
      "direct",
    );
    assert.equal(
      later.state,
      "held",
      "New input must not bypass a held earlier request",
    );
    x.store.queue.remove(later.id);
    assert.notEqual(attempt.id, run.id);
    assert.equal(attempt.retryOf, run.id);
    assert.equal(attempt.attemptRoot, run.id);
    await x.controller.stop(attempt.id);
    const next = x.controller.resume(queued.id);
    assert.equal(x.store.queue.list().length, 0);
    assert.ok(next.context?.runIds.includes(attempt.id));
    await x.controller.stop(next.id);
    assert.equal(x.store.run(run.id).state, "cancelled");
    assert.equal(x.store.conversations.get(x.chat.id).messages.length, 6);
    assert.equal(
      x.store.conversations.get(x.chat.id).messages[3].retryOf,
      run.id,
    );
  } finally {
    await x.controller.shutdown();
    x.store.close();
    rmSync(x.directory, { recursive: true, force: true });
  }
});
test("reopen holds work; changed settings or removed project never silently start", async () => {
  const x = setup();
  try {
    const item = x.controller.enqueue(
      x.project.id,
      x.chat.id,
      "Next",
      "be",
      "direct",
    );
    x.store.queue.save({ ...item, state: "waiting", afterRunId: "old" });
    const reopened = new RunController(x.store, x.directory, () => undefined);
    assert.equal(x.store.queue.get(item.id).state, "held");
    assert.equal(reopened.view().activeId, null);
    x.store.save(
      { ...x.settings, maxRequests: x.settings.maxRequests + 1 },
      undefined,
    );
    assert.throws(() => reopened.resume(item.id), /Cấu hình đã thay đổi/);
    assert.equal(x.store.queue.list().length, 1);
    x.store.save(x.settings, undefined);
    x.store.removeProject(x.project.id);
    assert.throws(() => reopened.resume(item.id), /Không tìm thấy dự án/);
    assert.equal(x.store.queue.list().length, 1);
  } finally {
    x.store.close();
    rmSync(x.directory, { recursive: true, force: true });
  }
});
test("schema4 migration keeps drafts and backs up before creating durable queue", () => {
  const x = setup();
  x.store.conversations.draft(x.chat.id, "draft");
  x.store.close();
  try {
    const db = new Database(join(x.directory, "worker.sqlite"));
    db.exec(
      "DROP TABLE chat_requests; DROP TABLE work_comments; DROP TABLE work_attempts; DROP TABLE work_submissions; DROP TABLE work_revisions; DROP TABLE work_counters; DROP TABLE board_links; DROP TABLE board_items; DROP TABLE command_artifacts; DROP TABLE file_recoveries; DROP TABLE workspace_evidence; DROP TABLE workspace_blobs; DROP TABLE follow_ups; PRAGMA user_version=4",
    );
    db.close();
    const reopened = new Store(x.directory);
    try {
      assert.equal(
        reopened.conversations.get(x.chat.id).conversation.draft,
        "draft",
      );
      assert.ok(existsSync(join(x.directory, "worker.schema4.backup.sqlite")));
      const backup = new Database(
        join(x.directory, "worker.schema4.backup.sqlite"),
        { readonly: true },
      );
      try {
        assert.equal(
          (
            backup
              .prepare("SELECT draft FROM conversations WHERE id=?")
              .get(x.chat.id) as { draft: string }
          ).draft,
          "draft",
        );
        assert.equal(backup.pragma("user_version", { simple: true }), 4);
      } finally {
        backup.close();
      }
      assert.deepEqual(reopened.queue.list(), []);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(x.directory, { recursive: true, force: true });
  }
});
test("visible text filters user/synthetic/reasoning and reconciles delta snapshots without duplication", () => {
  const stream = new VisibleText();
  const event = (type: string, properties: unknown) =>
    ({ id: crypto.randomUUID(), type, properties }) as Event;
  const part = (
    id: string,
    messageID: string,
    type: string,
    text: string,
    extra = {},
  ) =>
    event("message.part.updated", {
      sessionID: "s",
      time: 0,
      part: { id, messageID, sessionID: "s", type, text, ...extra },
    });
  stream.consume(
    event("message.updated", {
      sessionID: "s",
      info: { id: "u", role: "user" },
    }),
  );
  assert.equal(
    stream.consume(part("prompt", "u", "text", "private prompt")),
    "",
  );
  stream.consume(part("a", "assistant", "text", "Hello"));
  assert.equal(
    stream.consume(
      event("message.updated", {
        sessionID: "s",
        info: { id: "assistant", role: "assistant" },
      }),
    ),
    "Hello",
  );
  assert.equal(
    stream.consume(part("r", "assistant", "reasoning", "hidden")),
    undefined,
  );
  assert.equal(
    stream.consume(
      event("message.part.delta", {
        sessionID: "s",
        messageID: "assistant",
        partID: "r",
        field: "text",
        delta: "hidden",
      }),
    ),
    undefined,
  );
  assert.equal(
    stream.consume(
      part("synthetic", "assistant", "text", "system", { synthetic: true }),
    ),
    undefined,
  );
  assert.equal(
    stream.consume(
      event("message.part.delta", {
        sessionID: "s",
        messageID: "assistant",
        partID: "a",
        field: "text",
        delta: " world",
      }),
    ),
    "Hello world",
  );
  assert.equal(
    stream.consume(part("a", "assistant", "text", "Hello world")),
    "Hello world",
  );
});
