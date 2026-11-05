import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Store } from "../electron/storage/database";
import { ScheduleService } from "../electron/controller/schedules";
import type { ScheduleDraft, ScheduleRecord } from "../shared/schedules";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "asf-schedule-service-"));
  const store = new Store(directory),
    project = store.addProject(directory);
  let now = "2026-11-05T01:00:00.000Z";
  const clock = () => now;
  const service = new ScheduleService(store, clock);
  const draft: ScheduleDraft = {
    projectId: project.id,
    name: "Lịch",
    timing: {
      kind: "daily",
      time: "09:00",
      timeZone: "Asia/Ho_Chi_Minh",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    },
    action: {
      kind: "create_work_item",
      title: "Kiểm tra",
      body: "Yêu cầu",
      criteria: ["Có báo cáo"],
    },
    missedPolicy: "skip",
  };
  const ref = (record: ScheduleRecord) => ({
    projectId: project.id,
    id: record.id,
    version: record.version,
  });
  function create() {
    const preview = service.preview({ draft });
    return service.save({ draft, token: preview.token });
  }
  function enable(record: ScheduleRecord) {
    const preview = service.preview({ draft, ref: ref(record) });
    return service.toggle({
      ...ref(record),
      enabled: true,
      token: preview.token,
    });
  }
  return {
    directory,
    store,
    project,
    service,
    draft,
    ref,
    create,
    enable,
    advance: (at: string) => {
      now = at;
    },
    cleanup() {
      service.stop();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("schedule preview tickets bind config/project/version and expire without creating work", () => {
  const x = fixture();
  try {
    const preview = x.service.preview({ draft: x.draft });
    assert.equal(x.store.schedules.list().length, 0);
    assert.throws(
      () =>
        x.service.save({
          draft: { ...x.draft, name: "Changed" },
          token: preview.token,
        }),
      /xem trước/i,
    );
    const schedule = x.create();
    assert.equal(schedule.enabled, false);
    assert.throws(
      () => x.service.toggle({ ...x.ref(schedule), enabled: true }),
      /Xem trước/,
    );
    const ticket = x.service.preview({ draft: x.draft, ref: x.ref(schedule) });
    x.advance("2026-11-05T01:06:00.000Z");
    assert.throws(
      () =>
        x.service.toggle({
          ...x.ref(schedule),
          enabled: true,
          token: ticket.token,
        }),
      /hết hạn/,
    );
    const active = x.enable(schedule);
    const stale = x.service.preview({ draft: x.draft, ref: x.ref(active) });
    x.store.schedules.setEnabled(
      x.project.id,
      active.id,
      active.version,
      false,
    );
    assert.throws(
      () =>
        x.service.save({
          draft: x.draft,
          ref: x.ref(active),
          token: stale.token,
        }),
      /thay đổi/,
    );
    assert.equal(x.store.runs().length, 0);
    assert.equal(x.store.board.summaries(x.project.id).length, 0);
    x.advance("2026-11-05T01:59:00.000Z");
    const passed = x.service.preview({ draft: x.draft });
    x.advance("2026-11-05T02:00:01.000Z");
    assert.throws(
      () => x.service.save({ draft: x.draft, token: passed.token }),
      /xem trước/i,
    );
    assert.throws(() =>
      x.service.preview({
        draft: { ...x.draft, action: { kind: "shell", command: "whoami" } },
      }),
    );
  } finally {
    x.cleanup();
  }
});

test("timer processes at most ten, never overlaps, handles restart/clock jumps/pause and stop", async () => {
  const x = fixture();
  try {
    for (let i = 0; i < 12; i++) x.enable(x.create());
    x.service.start(); // Starts one tick and one timer; starting twice is a no-op.
    x.service.start();
    x.advance("2026-11-05T02:00:00.000Z");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await Promise.all([x.service.tick(), x.service.tick()]);
    assert.equal(x.store.board.summaries(x.project.id).length, 10);
    await x.service.tick();
    assert.equal(x.store.board.summaries(x.project.id).length, 12);
    x.advance("2026-11-05T01:00:00.000Z");
    await x.service.tick();
    assert.equal(x.store.board.summaries(x.project.id).length, 12);
    x.service.pause(true);
    x.advance("2026-12-01T04:00:00.000Z");
    await x.service.tick();
    assert.ok(x.service.list(x.project.id).paused);
    x.service.stop();
    const reopened = new Store(x.directory);
    const next = new ScheduleService(
      reopened,
      () => "2026-12-01T04:00:00.000Z",
    );
    try {
      assert.equal(next.list(x.project.id).paused, true);
      next.pause(false);
      next.start();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await next.tick();
      assert.equal(reopened.board.summaries(x.project.id).length, 12);
      assert.ok(
        reopened.schedules
          .list()
          .every((s) => s.nextAt === "2026-12-02T02:00:00.000Z"),
      );
      next.stop();
      const count = reopened.schedules.history(
        x.project.id,
        reopened.schedules.list()[0].id,
      ).items.length;
      await next.tick();
      assert.equal(
        reopened.schedules.history(
          x.project.id,
          reopened.schedules.list()[0].id,
        ).items.length,
        count,
      );
    } finally {
      next.stop();
      reopened.close();
    }
    assert.equal(x.store.runs().length, 0);
    assert.equal(x.store.queue.list().length, 0);
  } finally {
    x.cleanup();
  }
});

test("failed delivery rolls back and disables only its schedule; storage failure pauses all without retry", async () => {
  const x = fixture();
  const db = new Database(join(x.directory, "worker.sqlite"));
  try {
    const bad = x.enable(x.create()),
      good = x.enable(x.create());
    db.exec(
      `CREATE TRIGGER reject_scheduled_card BEFORE INSERT ON board_items WHEN NEW.title='Kiểm tra' AND (SELECT COUNT(*) FROM schedule_deliveries WHERE state='failed')=0 BEGIN SELECT RAISE(ABORT,'fixture'); END;`,
    );
    x.advance("2026-11-05T02:00:00.000Z");
    x.service.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const schedules = x.store.schedules.list();
    assert.equal(schedules.filter((s) => s.enabled).length, 1);
    assert.equal(x.store.board.summaries(x.project.id).length, 1);
    const failed = [bad, good].find(
      (s) => !x.store.schedules.get(x.project.id, s.id).enabled,
    )!;
    assert.equal(
      x.store.schedules.history(x.project.id, failed.id).items[0].state,
      "failed",
    );
    db.exec(
      "DROP TRIGGER reject_scheduled_card; CREATE TRIGGER reject_receipt BEFORE INSERT ON schedule_deliveries BEGIN SELECT RAISE(ABORT,'disk fixture'); END;",
    );
    x.advance("2026-11-06T02:00:00.000Z");
    await x.service.tick();
    assert.equal(x.service.list(x.project.id).paused, true);
    assert.match(x.service.list(x.project.id).error, /tạm dừng/);
    await x.service.tick();
    assert.equal(x.store.board.summaries(x.project.id).length, 1);
  } finally {
    db.close();
    x.cleanup();
  }
});

test("receipt quota stops delivery, pagination handles equal due times, retention preserves cards and recent receipts", async () => {
  const x = fixture();
  const db = new Database(join(x.directory, "worker.sqlite"));
  try {
    const active = x.enable(x.create());
    const insert = db.prepare(
      "INSERT INTO schedule_deliveries VALUES(?,?,?,?,?,'missed',NULL,'',?)",
    );
    for (let i = 0; i < 999; i++)
      insert.run(
        `${active.id}:fixture-${i}`,
        active.id,
        1,
        "2026-10-01T02:00:00.000Z",
        "2026-10-01T02:00:00.000Z",
        JSON.stringify(x.draft),
      );
    x.advance("2026-11-05T02:00:00.000Z");
    x.service.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(x.store.schedules.get(x.project.id, active.id).enabled, false);
    assert.equal(
      x.store.schedules.history(x.project.id, active.id).items[0].state,
      "failed",
    );
    assert.equal(x.store.board.summaries(x.project.id).length, 0);
    assert.throws(
      () => x.enable(x.store.schedules.get(x.project.id, active.id)),
      /đầy/,
    );
    const keys = new Set<string>();
    let before: number | undefined;
    do {
      const page = x.store.schedules.history(x.project.id, active.id, before);
      page.items.forEach((item) => {
        assert.ok(!keys.has(item.occurrenceKey));
        keys.add(item.occurrenceKey);
      });
      before = page.nextBefore ?? undefined;
    } while (before);
    assert.equal(keys.size, 1000);
    x.store.schedules.prune("2027-01-05T00:00:00.000Z");
    assert.equal(
      x.store.schedules.history(x.project.id, active.id).items.length,
      1,
    );
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally {
    db.close();
    x.cleanup();
  }
});
