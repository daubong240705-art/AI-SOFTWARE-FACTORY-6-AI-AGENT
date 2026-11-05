import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextScheduleOccurrence,
  previewSchedule,
  planScheduleTick,
  scheduleDraftSchema,
  scheduleGraceMs,
  type ScheduleDraft,
} from "../shared/schedules";
import { createBoardItemSchema } from "../shared/board";

const id = "11111111-1111-4111-8111-111111111111";
const draft: ScheduleDraft = {
  projectId: id,
  name: "Review mỗi sáng",
  timing: {
    kind: "daily",
    time: "09:00",
    timeZone: "Asia/Ho_Chi_Minh",
    weekdays: [1, 2, 3, 4, 5],
  },
  action: {
    kind: "create_work_item",
    title: "Rà soát thay đổi",
    body: "Xem các thay đổi gần nhất của dự án.",
    criteria: ["Ghi nhận vấn đề cần xử lý"],
  },
  missedPolicy: "skip",
};
test("schedule preview stays passive, scoped and bounded with the exact backlog payload", () => {
  const preview = previewSchedule(draft, "2026-11-05T01:00:00.000Z");
  assert.deepEqual(preview.occurrences, [
    "2026-11-05T02:00:00.000Z",
    "2026-11-06T02:00:00.000Z",
    "2026-11-09T02:00:00.000Z",
    "2026-11-10T02:00:00.000Z",
    "2026-11-11T02:00:00.000Z",
  ]);
  assert.deepEqual(createBoardItemSchema.parse(preview.workItem), {
    projectId: id,
    title: draft.action.title,
    body: draft.action.body,
    criteria: draft.action.criteria,
    priority: 0,
    suggestedRole: null,
    planningState: "backlog",
  });
  assert.equal(
    nextScheduleOccurrence(draft.timing, "2026-11-05T02:00:00.000Z"),
    "2026-11-06T02:00:00.000Z",
  );
});

test("once schedules expire, ISO timestamps normalize strictly and no arbitrary action or override is accepted", () => {
  const once: ScheduleDraft = {
    ...draft,
    timing: { kind: "once", at: "2026-11-05T02:00:00.000Z" },
  };
  assert.equal(
    previewSchedule(once, "2026-11-05T01:00:00.000Z").occurrences.length,
    1,
  );
  assert.deepEqual(
    previewSchedule(once, "2026-11-05T02:00:00.000Z").occurrences,
    [],
  );
  for (const invalid of [
    { ...draft, missedPolicy: "catch-up" },
    { ...draft, autoRun: true },
    { ...draft, action: { kind: "shell", command: "echo unsafe" } },
    { ...draft, action: { ...draft.action, model: "override" } },
    { ...draft, timing: { ...draft.timing, timeZone: "Invalid/Zone" } },
    { ...draft, timing: { ...draft.timing, time: "24:00" } },
    { ...draft, timing: { ...draft.timing, weekdays: [1, 1] } },
    { ...draft, timing: { ...draft.timing, weekdays: [] } },
    { ...draft, timing: { ...draft.timing, weekdays: [0] } },
    { ...draft, timing: { kind: "once", at: "2026-02-30T02:00:00.000Z" } },
    { ...draft, timing: { kind: "once", at: "2026-11-05T09:00:00+07:00" } },
    { ...draft, action: { ...draft.action, title: "x".repeat(161) } },
  ])
    assert.equal(scheduleDraftSchema.safeParse(invalid).success, false);
});

test("local scheduling handles year boundaries and non-hour timezone offsets independently of host timezone", () => {
  assert.equal(
    nextScheduleOccurrence(
      {
        kind: "daily",
        time: "00:15",
        timeZone: "Asia/Kathmandu",
        weekdays: [5],
      },
      "2026-12-31T18:00:00.000Z",
    ),
    "2026-12-31T18:30:00.000Z",
  );
  assert.equal(
    nextScheduleOccurrence(
      {
        kind: "daily",
        time: "00:15",
        timeZone: "Asia/Kathmandu",
        weekdays: [5],
      },
      "2026-12-31T18:30:00.000Z",
    ),
    "2027-01-07T18:30:00.000Z",
  );
});

test("DST skips nonexistent minutes and never runs twice in a repeated local minute", () => {
  const timing = {
    kind: "daily" as const,
    time: "02:30",
    timeZone: "America/New_York",
    weekdays: [7],
  };
  assert.equal(
    nextScheduleOccurrence(timing, "2026-03-01T07:30:00.000Z"),
    "2026-03-15T06:30:00.000Z",
  );
  const fold = { ...timing, time: "01:30" };
  assert.equal(
    nextScheduleOccurrence(fold, "2026-11-01T04:00:00.000Z"),
    "2026-11-01T05:30:00.000Z",
  );
  assert.equal(
    nextScheduleOccurrence(fold, "2026-11-01T05:30:00.000Z"),
    "2026-11-08T06:30:00.000Z",
  );
});

test("ticks have stable occurrence keys, respect grace boundary and coalesce downtime into one missed receipt", () => {
  const input = {
    id,
    version: 3,
    timing: draft.timing,
    nextAt: "2026-11-05T02:00:00.000Z",
    now: "2026-11-05T01:59:59.999Z",
  };
  assert.deepEqual(planScheduleTick(input), {
    key: `${id}:3:${input.nextAt}`,
    state: "waiting",
    nextAt: input.nextAt,
  });
  const due = planScheduleTick({ ...input, now: input.nextAt });
  assert.equal(due.state, "due");
  assert.equal(due.nextAt, "2026-11-06T02:00:00.000Z");
  const boundary = new Date(Date.parse(input.nextAt) + scheduleGraceMs);
  assert.equal(
    planScheduleTick({ ...input, now: boundary.toISOString() }).state,
    "due",
  );
  assert.equal(
    planScheduleTick({
      ...input,
      now: new Date(boundary.getTime() + 1).toISOString(),
    }).state,
    "missed",
  );
  const missed = planScheduleTick({
    ...input,
    now: "2026-12-01T04:00:00.000Z",
  });
  assert.equal(missed.state, "missed");
  assert.equal(missed.nextAt, "2026-12-02T02:00:00.000Z");
  assert.equal(missed.key, due.key);
  assert.notEqual(planScheduleTick({ ...input, version: 4 }).key, due.key);
  assert.throws(() => planScheduleTick({ ...input, version: 0 }));
  assert.throws(() =>
    planScheduleTick({ ...input, nextAt: "2026-11-05T02:01:00.000Z" }),
  );
  assert.throws(() => planScheduleTick({ ...input, now: "invalid" }));
  const once = planScheduleTick({
    ...input,
    timing: { kind: "once", at: input.nextAt },
    now: input.nextAt,
  });
  assert.equal(once.nextAt, null);
});
