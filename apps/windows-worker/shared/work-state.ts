import { isActive, type Run } from "./runs";
import type { QuestionSet } from "./questions";
import type { ReportView } from "./reports";

export type AvailableAction = {
  id: "questions" | "permissions" | "progress" | "result" | "recovery";
  label: string;
};
export type WorkStateView = {
  label: string;
  reason: string;
  freshness: "current" | "stale" | "unknown";
  actions: AvailableAction[];
  blockers: { label: string; reason: string; action: AvailableAction }[];
};

export const workStateLabels = {
  permission: "Chờ cấp quyền",
  question: "Cần trả lời",
  report: "Chờ nghiệm thu",
  failure: "Cần xử lý",
  queue: "Hàng chờ tạm giữ",
} as const;

// Bounded projections use counts/task summaries, never whole tool output or
// configuration. Both renderer detail and main-process summaries share rules.
export type WorkStateFacts = Pick<
  Run,
  "id" | "projectId" | "state" | "role" | "mode" | "error"
> & {
  tasks: { state: string; role: Run["role"]; title: string; kind: string }[];
  permissionCount: number;
  hasWork: boolean;
  integrationState?: string | null;
};

// Presentation only: no model guesses or parallel status table. Mutations still
// go through Controller validation. Missing report evidence never means verified.
export function workStateView(
  run: Run,
  input: WorkStateInput = {},
): WorkStateView {
  return workStateFromFacts(
    {
      ...run,
      permissionCount: run.permissions.length,
      hasWork:
        run.tasks.some((task) => ["work", "fix"].includes(task.kind)) ||
        run.changes.length > 0 ||
        run.commands.length > 0,
      integrationState: run.integration?.state,
    },
    input,
  );
}

export type WorkStateInput = {
  stale?: boolean;
  questionState?: QuestionSet["state"];
  report?: ReportView;
};

export function workStateFromFacts(
  run: WorkStateFacts,
  input: WorkStateInput = {},
): WorkStateView {
  const report =
    input.report?.report.runId === run.id &&
    input.report.report.projectId === run.projectId
      ? input.report
      : undefined;
  const freshness = input.stale ? "stale" : (report?.freshness ?? "current");
  const blockers: WorkStateView["blockers"] = [];
  if (input.questionState === "pending")
    blockers.push({
      label: workStateLabels.question,
      reason: "Lead đang chờ câu trả lời nghiệp vụ.",
      action: { id: "questions", label: "Trả lời" },
    });
  if (isActive(run.state) && run.state !== "cancelling" && run.permissionCount)
    blockers.push({
      label: workStateLabels.permission,
      reason: `${run.permissionCount} yêu cầu công cụ`,
      action: { id: "permissions", label: "Xem yêu cầu" },
    });
  if (run.integrationState === "conflict")
    blockers.push({
      label: "Xung đột source",
      reason: run.error || "Cần xem xung đột trước khi tích hợp.",
      action: { id: "recovery", label: "Xem chi tiết" },
    });
  let label: string,
    reason = run.error || "",
    actions: AvailableAction[] = [];
  if (run.state === "cancelling") label = "Đang dừng";
  else if (blockers.length) {
    label = blockers[0].label;
    reason = blockers.map((blocker) => blocker.reason).join(" · ");
    actions = blockers.map((blocker) => blocker.action);
  } else if (run.state === "blocked") {
    label = workStateLabels.failure;
    reason ||= "Lượt chạy đang bị chặn. Mở chi tiết để xử lý.";
    actions = [{ id: "recovery", label: "Xem chi tiết" }];
  } else if (run.state === "needs_input") {
    label =
      input.questionState === "answered"
        ? "Đã xử lý câu hỏi"
        : input.questionState === "superseded"
          ? "Câu hỏi đã hết hiệu lực"
          : "Cần bổ sung";
    reason ||=
      input.questionState === "answered"
        ? "Xem lượt tiếp nối trong hội thoại."
        : input.questionState === "superseded"
          ? "Mở công việc hiện tại để xem yêu cầu mới nhất."
          : "Lead cần thêm ngữ cảnh để tiếp tục.";
    actions = [{ id: "recovery", label: "Xem chi tiết" }];
  } else if (isActive(run.state)) {
    const working = run.tasks.filter((task) =>
      ["running", "blocked"].includes(task.state),
    );
    label =
      run.state === "queued"
        ? "Đang chuẩn bị"
        : working.some((task) => task.kind === "review" || task.role === "test")
          ? "Đang kiểm tra"
          : "Đang làm";
    reason = working
      .map((task) => `${task.role.toUpperCase()} · ${task.title}`)
      .join(" / ");
    actions = [{ id: "progress", label: "Xem tiến độ" }];
  } else if (run.state === "completed") {
    const delivered = run.hasWork;
    if (!delivered)
      label =
        run.mode === "team" || run.role === "lead"
          ? "Lead đã trả lời"
          : "Đã trả lời";
    else {
      label =
        report?.report.verification === "pass" && freshness === "current"
          ? report.policy.required && report.decision?.action !== "accept"
            ? workStateLabels.report
            : "Hoàn thành"
          : "Có kết quả · Chưa xác minh";
      if (report?.decision?.action === "request-fix") label = "Đã yêu cầu sửa";
      if (report?.freshness === "stale") label = "Kết quả phiên bản trước";
      actions = [{ id: "result", label: "Xem kết quả" }];
    }
  } else {
    label =
      run.state === "cancelled"
        ? "Đã dừng"
        : run.state === "interrupted"
          ? "Bị gián đoạn"
          : workStateLabels.failure;
    actions = [{ id: "recovery", label: "Xem chi tiết" }];
  }
  if (input.stale)
    reason = ["Chưa đồng bộ dữ liệu", reason].filter(Boolean).join(" · ");
  return { label, reason, freshness, actions, blockers };
}
