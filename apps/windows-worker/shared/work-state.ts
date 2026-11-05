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
};

// Presentation only: no model guesses or parallel status table. Mutations still
// go through Controller validation. Missing report evidence never means verified.
export function workStateView(
  run: Run,
  input: {
    stale?: boolean;
    questionState?: QuestionSet["state"];
    report?: ReportView;
  } = {},
): WorkStateView {
  const report =
    input.report?.report.runId === run.id &&
    input.report.report.projectId === run.projectId
      ? input.report
      : undefined;
  const freshness = input.stale ? "stale" : (report?.freshness ?? "current");
  let label: string,
    reason = run.error || "",
    actions: AvailableAction[] = [];
  if (run.state === "cancelling") label = "Đang dừng";
  else if (input.questionState === "pending") {
    label = "Cần bạn trả lời";
    actions = [{ id: "questions", label: "Trả lời" }];
  } else if (isActive(run.state) && run.permissions.length) {
    label = "Chờ cấp quyền";
    reason = `${run.permissions.length} yêu cầu công cụ`;
    actions = [{ id: "permissions", label: "Xem yêu cầu" }];
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
    const delivered =
      run.mode === "direct"
        ? run.changes.length > 0 || run.commands.length > 0
        : run.tasks.some((task) => task.kind === "work" || task.kind === "fix");
    if (!delivered)
      label =
        run.mode === "team" || run.role === "lead"
          ? "Lead đã trả lời"
          : "Đã trả lời";
    else {
      label =
        report?.report.verification === "pass" && freshness === "current"
          ? report.policy.required && report.decision?.action !== "accept"
            ? "Chờ nghiệm thu"
            : "Hoàn thành"
          : "Có kết quả · Chưa xác minh";
      if (report?.decision?.action === "request-fix") label = "Đã yêu cầu sửa";
      if (freshness === "stale") label = "Kết quả phiên bản trước";
      actions = [{ id: "result", label: "Xem kết quả" }];
    }
  } else {
    label = run.state === "cancelled" ? "Đã dừng" : "Cần xử lý";
    actions = [{ id: "recovery", label: "Xem chi tiết" }];
  }
  return { label, reason, freshness, actions };
}
