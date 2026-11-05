import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Store } from "../electron/storage/database";
import type { ScheduleDraft } from "../shared/schedules";

const before = "2026-11-05T01:00:00.000Z";
const due = "2026-11-05T02:00:00.000Z";
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "asf-schedules-"));
  const store = new Store(directory);
  const project = store.addProject(directory);
  const draft: ScheduleDraft = {
    projectId: project.id,
    name: "Review buổi sáng",
    timing: {
      kind: "daily",
      time: "09:00",
      timeZone: "Asia/Ho_Chi_Minh",
      weekdays: [1, 2, 3, 4, 5],
    },
    action: {
      kind: "create_work_item",
      title: "Rà soát thay đổi",
      body: "Nội dung yêu cầu",
      criteria: ["Ghi nhận vấn đề"],
    },
    missedPolicy: "skip",
  };
  const raw = () => new Database(join(directory, "worker.sqlite"));
  return {
    store,
    directory,
    project,
    draft,
    raw,
    cleanup: () => {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
test("schedules persist disabled by default, scope project/version and preserve immutable delivery snapshots", () => {
  const x = setup();
  try {
    const created = x.store.schedules.create(x.draft, before);
    assert.equal(created.enabled, false);
    assert.equal(created.nextAt, null);
    assert.equal(x.store.schedules.deliverDue(created.id, due), null);
    const foreign = x.store.addProject(join(x.directory, "other"));
    assert.throws(
      () => x.store.schedules.get(foreign.id, created.id),
      /thuộc dự án/,
    );
    assert.throws(
      () => x.store.schedules.deliveries(foreign.id, created.id),
      /thuộc dự án/,
    );
    assert.throws(
      () =>
        x.store.schedules.update(created.id, 1, {
          ...x.draft,
          projectId: foreign.id,
        }),
      /thuộc dự án/,
    );
    const enabled = x.store.schedules.setEnabled(
      x.project.id,
      created.id,
      1,
      true,
      before,
    );
    assert.equal(enabled.nextAt, due);
    assert.throws(
      () => x.store.schedules.setEnabled(x.project.id, created.id, 1, false),
      /thay đổi/,
    );
    assert.equal(x.store.schedules.deliverDue(created.id, before), null);
    const result = x.store.schedules.deliverDue(created.id, due)!;
    assert.equal(result.state, "created");
    assert.equal(result.workItem?.planningState, "backlog");
    assert.equal(result.workItem?.projectId, x.project.id);
    assert.deepEqual(result.workItem?.criteria, x.draft.action.criteria);
    assert.equal(x.store.schedules.deliverDue(created.id, due), null);
    assert.equal(x.store.board.summaries(x.project.id).length, 1);
    assert.equal(x.store.runs().length, 0);
    assert.equal(x.store.queue.list().length, 0);
    const current = x.store.schedules.get(x.project.id, created.id);
    x.store.schedules.update(
      created.id,
      current.version,
      {
        ...x.draft,
        name: "Tên mới",
        action: { ...x.draft.action, title: "Yêu cầu mới" },
      },
      due,
    );
    const history = x.store.schedules.deliveries(x.project.id, created.id);
    assert.equal(history.length, 1);
    assert.equal(history[0].config.action.title, x.draft.action.title);
    assert.equal(history[0].workItemId, result.workItem!.id);
    const reopened = new Store(x.directory);
    try {
      assert.equal(
        reopened.schedules.get(x.project.id, created.id).name,
        "Tên mới",
      );
      assert.deepEqual(
        reopened.schedules.deliveries(x.project.id, created.id),
        history,
      );
      assert.equal(reopened.schedules.deliverDue(created.id, due), null);
    } finally {
      reopened.close();
    }
    const db = x.raw();
    try {
      assert.throws(
        () =>
          db.prepare("UPDATE schedule_deliveries SET reason='changed'").run(),
        /immutable/,
      );
      assert.deepEqual(db.pragma("foreign_key_check"), []);
    } finally {
      db.close();
    }
    assert.throws(() => x.store.removeProject(x.project.id), /lịch/);
  } finally {
    x.cleanup();
  }
});

test("schedule delivery rolls back card, revision, counter and cursor on downstream database failure", () => {
  const x = setup();
  try {
    const created = x.store.schedules.create(x.draft, before);
    const enabled = x.store.schedules.setEnabled(
      x.project.id,
      created.id,
      1,
      true,
      before,
    );
    const db = x.raw();
    try {
      db.exec(
        "CREATE TRIGGER reject_delivery BEFORE INSERT ON schedule_deliveries BEGIN SELECT RAISE(ABORT,'fixture failure'); END;",
      );
      assert.throws(
        () => x.store.schedules.deliverDue(created.id, due),
        /fixture failure/,
      );
      assert.equal(x.store.board.summaries(x.project.id).length, 0);
      assert.equal(
        (
          db.prepare("SELECT COUNT(*) AS n FROM work_revisions").get() as {
            n: number;
          }
        ).n,
        0,
      );
      assert.deepEqual(
        x.store.schedules.get(x.project.id, created.id),
        enabled,
      );
      assert.deepEqual(
        x.store.schedules.deliveries(x.project.id, created.id),
        [],
      );
      db.exec("DROP TRIGGER reject_delivery");
      const result = x.store.schedules.deliverDue(created.id, due)!;
      assert.equal(result.workItem!.code, "W-0001");
      assert.equal(
        x.store.schedules.deliveries(x.project.id, created.id).length,
        1,
      );
      assert.equal(x.store.schedules.deliverDue(created.id, due), null);
    } finally {
      db.close();
    }
  } finally {
    x.cleanup();
  }
});

test("pause survives reopen and downtime creates one missed receipt without backlog flood", () => {
  const x = setup();
  try {
    const created = x.store.schedules.create(x.draft, before);
    x.store.schedules.setEnabled(x.project.id, created.id, 1, true, before);
    x.store.schedules.setPaused(true, before);
    const reopened = new Store(x.directory);
    try {
      assert.equal(reopened.schedules.isPaused(), true);
      assert.equal(reopened.schedules.deliverDue(created.id, due), null);
      reopened.schedules.setPaused(false, "2026-12-01T04:00:00.000Z");
      const result = reopened.schedules.deliverDue(
        created.id,
        "2026-12-01T04:00:00.000Z",
      )!;
      assert.equal(result.state, "missed");
      assert.equal(result.workItem, null);
      assert.equal(
        reopened.schedules.get(x.project.id, created.id).nextAt,
        "2026-12-02T02:00:00.000Z",
      );
      assert.equal(
        reopened.schedules.deliveries(x.project.id, created.id).length,
        1,
      );
      assert.equal(reopened.board.summaries(x.project.id).length, 0);
    } finally {
      reopened.close();
    }
  } finally {
    x.cleanup();
  }
});

test("once schedules disable after delivery and cannot be enabled after their time", () => {
  const x = setup();
  try {
    const created = x.store.schedules.create(
      { ...x.draft, timing: { kind: "once", at: due } },
      before,
    );
    x.store.schedules.setEnabled(x.project.id, created.id, 1, true, before);
    x.store.schedules.deliverDue(created.id, due);
    const current = x.store.schedules.get(x.project.id, created.id);
    assert.equal(current.enabled, false);
    assert.equal(current.nextAt, null);
    assert.throws(
      () =>
        x.store.schedules.setEnabled(
          x.project.id,
          created.id,
          current.version,
          true,
          due,
        ),
      /tương lai/,
    );
  } finally {
    x.cleanup();
  }
});

test("schedule quotas and strict validation reject unknown projects, executable actions and invalid timestamps without mutation", () => {
  const x = setup();
  try {
    assert.throws(
      () =>
        x.store.schedules.create(
          { ...x.draft, projectId: crypto.randomUUID() },
          before,
        ),
      /FOREIGN KEY/,
    );
    assert.throws(() =>
      x.store.schedules.create(
        { ...x.draft, action: { kind: "shell" } } as unknown as ScheduleDraft,
        before,
      ),
    );
    assert.throws(() =>
      x.store.schedules.create(x.draft, "2026-02-30T02:00:00.000Z"),
    );
    for (let i = 0; i < 20; i++) x.store.schedules.create(x.draft, before);
    assert.throws(() => x.store.schedules.create(x.draft, before), /20 lịch/);
    assert.equal(x.store.schedules.list(x.project.id).length, 20);
    assert.equal(x.store.board.summaries(x.project.id).length, 0);
  } finally {
    x.cleanup();
  }
});

test("schema13 migration creates a recoverable backup and preserves conversation drafts, models and credentials", () => {
  const x = setup();
  try {
    const conversation = x.store.conversations.create(x.project.id);
    x.store.conversations.draft(conversation.id, "Nháp được giữ");
    x.store.setModels(["fixture-model"]);
    x.store.save(x.store.settings(), Buffer.from("encrypted-fixture"));
    // save invalidates the catalog only when credentials change.
    x.store.setModels(["fixture-model"]);
    const db = x.raw();
    db.exec(
      "DROP TABLE inbox_dismissals; DROP TABLE schedule_deliveries; DROP TABLE schedules; DROP TABLE schedule_control; PRAGMA user_version=13",
    );
    db.close();
    const reopened = new Store(x.directory);
    try {
      assert.equal(
        reopened.conversations.get(conversation.id).conversation.draft,
        "Nháp được giữ",
      );
      assert.deepEqual(reopened.models(), ["fixture-model"]);
      assert.equal(reopened.encryptedKey()!.toString(), "encrypted-fixture");
      assert.deepEqual(reopened.schedules.list(), []);
      const backupPath = join(
        x.directory,
        "worker.schema13.pre-schedules.backup.sqlite",
      );
      assert.ok(existsSync(backupPath));
      const backup = new Database(backupPath, { readonly: true });
      try {
        assert.equal(backup.pragma("user_version", { simple: true }), 13);
        assert.equal(
          (
            backup
              .prepare("SELECT draft FROM conversations WHERE id=?")
              .get(conversation.id) as { draft: string }
          ).draft,
          "Nháp được giữ",
        );
        assert.equal(
          backup
            .prepare("SELECT 1 FROM sqlite_master WHERE name='schedules'")
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
