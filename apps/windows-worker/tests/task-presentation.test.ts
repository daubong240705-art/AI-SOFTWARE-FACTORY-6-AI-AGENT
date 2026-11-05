import { test } from "node:test";
import assert from "node:assert/strict";
import {
  taskDescription,
  taskTitle,
  taskCriteria,
  taskResult,
} from "../shared/task-presentation";
import type { TeamTask } from "../shared/team";

function task(patch: Partial<TeamTask> = {}): TeamTask {
  return {
    id: "review-0-0",
    kind: "review",
    title: "Đánh giá",
    instructions:
      'Review yêu cầu: Internal\nDữ liệu review: {"evidence":"' +
      "x".repeat(32000) +
      '"}',
    acceptance: ["JSON hợp lệ"],
    summary: "",
    role: "lead",
    state: "failed",
    model: "fixture",
    dependsOn: [],
    allowedPaths: ["."],
    round: 0,
    sessionId: null,
    startedAt: null,
    endedAt: null,
    error: "Hết request",
    changes: [],
    commandIds: [],
    ...patch,
  };
}

test("internal prompts never become plan/review descriptions or business criteria", () => {
  const review = task();
  assert.equal(taskTitle(review), "Đánh giá kết quả");
  assert.ok(taskDescription(review).length < 200);
  assert.ok(!taskDescription(review).includes("evidence"));
  assert.ok(!taskCriteria(review).join(" ").includes("JSON"));
  assert.equal(taskTitle(task({ kind: "plan" })), "Lập kế hoạch");
  const work = task({
    kind: "work",
    instructions: "**Mục tiêu**\nCăn lại bảng và chạy build.",
    acceptance: ["Build đạt"],
  });
  assert.equal(taskDescription(work), work.instructions);
  assert.deepEqual(taskCriteria(work), ["Build đạt"]);
  assert.ok(review.instructions.includes("x".repeat(32000)));
});

test("structured summaries are readable claims while unknown/partial JSON stays technical", () => {
  const review = task({
    summary: JSON.stringify({
      version: 3,
      status: "blocked",
      summary: "Thiếu bằng chứng responsive",
      acceptance: [],
      limitations: ["Chưa thử trình duyệt khác"],
    }),
  });
  const result = taskResult(review);
  assert.match(result.text, /Thiếu bằng chứng/);
  assert.match(result.text, /Chưa thử trình duyệt khác/);
  assert.ok(!result.text.includes('"acceptance"'));
  assert.equal(result.unreadable, false);
  const unknown = taskResult(
    task({ summary: '```json\n{"evidence":["INTERNAL_PAYLOAD"' }),
  );
  assert.equal(unknown.unreadable, true);
  assert.ok(!unknown.text.includes("INTERNAL_PAYLOAD"));
  const human = taskResult(
    task({
      kind: "work",
      summary:
        "Trạng thái: done_with_concerns\nKết quả: Đã căn bảng.\nBlocker: —\nChưa xác minh: Chưa thử Safari",
    }),
  );
  assert.match(human.text, /\*\*Chưa xác minh\*\*/);
  assert.ok(!human.text.includes("done_with_concerns"));
  const plan = taskResult(
    task({
      kind: "plan",
      summary: '{"reply":"Tôi có thể giúp lập kế hoạch."}',
    }),
  );
  assert.equal(plan.text, "Tôi có thể giúp lập kế hoạch.");
  const markdown = "[Báo cáo](docs/report.md) đã được cập nhật.";
  assert.equal(
    taskResult(task({ kind: "work", summary: markdown })).text,
    markdown,
  );
});
