import type { Role } from "./contracts";
import type { Run, RunDetail } from "./runs";
import { isActive, runLabels } from "./runs";
import { activityLabels } from "./monitor";

export type InspectorSelection = {
  projectId: string;
  runId: string;
  taskId?: string | null;
  executionId?: string;
};
export const taskLabels = {
  queued: "Chờ",
  running: "Đang làm",
  blocked: "Cần xử lý",
  completed: "Đã thực thi",
  failed: "Lỗi",
  cancelled: "Đã dừng",
  skipped: "Bỏ qua",
};
export function inspectSelection(
  detail: RunDetail,
  selection: InspectorSelection,
) {
  const { run } = detail;
  if (run.projectId !== selection.projectId || run.id !== selection.runId)
    throw new Error("Lựa chọn không thuộc dự án/lượt chạy đang xem.");
  const task = selection.taskId
    ? run.tasks.find((t) => t.id === selection.taskId)
    : undefined;
  if (selection.taskId && !task)
    throw new Error("Task không còn trong lượt chạy này.");
  const execution = task?.observation ?? (!task ? run.observation : undefined);
  if (
    selection.executionId &&
    execution?.executionId !== selection.executionId &&
    selection.executionId !== `${run.id}:${task?.id ?? "direct"}:preparing`
  )
    throw new Error("Execution đã thay đổi. Chọn lại agent để xem.");
  const logicalId = task?.originalTaskId ?? task?.id;
  const latest =
    task &&
    run.tasks.filter((t) => (t.originalTaskId ?? t.id) === logicalId).at(-1);
  const dependencies =
    task?.dependsOn.map((id) => {
      const current = run.tasks
        .filter((t) => (t.originalTaskId ?? t.id) === id)
        .at(-1);
      return { id, attemptId: current?.id, state: current?.state };
    }) ?? [];
  return {
    task,
    dependencies,
    supersededBy: latest && latest.id !== task?.id ? latest.id : null,
  };
}
export function runCapabilities(run: Run, activeId: string | null) {
  const active = activeId === run.id && isActive(run.state);
  return {
    stop: active && run.state !== "cancelling",
    permission: active && run.state !== "cancelling",
    retry:
      !activeId &&
      !isActive(run.state) &&
      run.state !== "completed" &&
      !run.integration &&
      run.failure?.code !== "integration-pending",
    recovery:
      !activeId &&
      !run.integration &&
      run.failure?.code !== "integration-pending" &&
      ["failed", "cancelled", "needs_input", "interrupted"].includes(run.state),
  };
}
const milestones: Record<string, string> = {
  RUN_QUEUED: "Đã nhận yêu cầu",
  RUN_STARTED: "Bắt đầu lượt chạy",
  TASK_STARTED: "Nhận việc",
  TASK_FINISHED: "Kết thúc task",
  TASK_SKIPPED: "Bỏ qua task",
  PLAN_ACCEPTED: "Lead đã phân công",
  LEAD_REPLIED: "Lead đã trả lời",
  LEAD_REVIEW: "Lead đã review",
  RECOVERY_STARTED: "Bắt đầu attempt phục hồi",
  INTEGRATION_CREATED: "Đã tạo workspace tích hợp",
  INTEGRATION_APPLYING: "Đang tích hợp",
  INTEGRATION_BLOCKED: "Tích hợp cần xử lý",
  INTEGRATION_VERIFIED: "Đã xác minh tích hợp",
  INTEGRATION_PENDING: "Chờ tích hợp",
  PERMISSION_REQUESTED: "Chờ cấp quyền",
  PERMISSION_RESOLVED: "Đã xử lý quyền",
  RUN_CANCELLING: "Đang dừng lượt chạy",
  STOP_FAILED: "Chưa dừng được tiến trình",
  TOOL_FAILED: "Công cụ thất bại",
};
export type TimelineEntry = {
  sequence: number;
  at: string;
  title: string;
  taskId: string | null;
  role: Role | null;
  legacy: boolean;
  count: number;
  executionId?: string;
};
export function compactTimeline(
  detail: RunDetail,
  filter: { taskId?: string; role?: Role } = {},
): TimelineEntry[] {
  const rows: TimelineEntry[] = [];
  const seen = new Set<number>();
  for (const event of [...detail.events].sort(
    (a, b) => a.sequence - b.sequence,
  )) {
    if (seen.has(event.sequence)) continue;
    seen.add(event.sequence);
    const owner = event.metadata?.taskId ?? null;
    const task = detail.run.tasks.find((t) => t.id === owner);
    // Legacy text is never parsed to invent an execution/task owner.
    const role =
      task?.role ?? (event.metadata && !owner ? detail.run.role : null);
    if (
      (filter.taskId && owner !== filter.taskId) ||
      (filter.role && role !== filter.role)
    )
      continue;
    let title = milestones[event.type];
    if (event.type.startsWith("RUN_")) {
      const state = event.type.slice(4).toLowerCase() as keyof typeof runLabels;
      title ??= runLabels[state];
    }
    if (event.type === "TASK_FINISHED" && task)
      title = `${title} · ${taskLabels[task.state]}`;
    const activity = event.metadata?.activity;
    const groupable = event.type === "TOOL_STARTED";
    if (!title && groupable && activity) title = activityLabels[activity];
    if (!title) continue;
    const previous = rows.at(-1);
    if (
      groupable &&
      previous &&
      previous.title === title &&
      previous.taskId === owner &&
      previous.executionId === event.metadata?.executionId &&
      Date.parse(event.at) >= Date.parse(previous.at) &&
      Date.parse(event.at) - Date.parse(previous.at) <= 10000
    ) {
      previous.count++;
      previous.at = event.at;
      continue;
    }
    rows.push({
      sequence: event.sequence,
      at: event.at,
      title,
      taskId: owner,
      role,
      legacy: !event.metadata,
      count: 1,
      executionId: event.metadata?.executionId,
    });
  }
  return rows;
}
