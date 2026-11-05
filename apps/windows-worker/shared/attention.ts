import {
  failureLabels,
  type ExecutionFailure,
  type FailureCode,
} from "./execution";
import type { Run } from "./runs";
import type { TeamTask, TeamReview } from "./team";

export type IssueTask = Pick<
  TeamTask,
  | "id"
  | "title"
  | "role"
  | "state"
  | "kind"
  | "error"
  | "failure"
  | "originalTaskId"
>;
export type IssueInput = Pick<Run, "state" | "error" | "failure"> & {
  tasks: IssueTask[];
  review?: Pick<TeamReview, "status" | "summary" | "acceptance"> | null;
};
export type RunIssue = {
  label: string;
  reason: string;
  nextAction: string;
  taskId: string | null;
  taskTitle: string | null;
  role: string | null;
  criteria: string[];
};

const remedies: Record<FailureCode, string> = {
  cancelled: "Trao đổi với Lead nếu muốn tiếp tục công việc.",
  "permission-denied":
    "Xem công cụ bị từ chối và phạm vi quyền trước khi tiếp tục.",
  "tool-loop":
    "Thu hẹp yêu cầu hoặc đổi cách thực hiện với Lead trước khi thử lại.",
  "scope-violation":
    "Đối chiếu file vượt phạm vi; thống nhất lại phạm vi với Lead.",
  "workspace-changed":
    "Đối chiếu thay đổi source và checkpoint trước khi tiếp tục.",
  "incomplete-snapshot":
    "Kiểm tra workspace và các file chưa chụp được trước khi tạo lượt mới.",
  "budget-exhausted":
    "Chia nhỏ công việc hoặc điều chỉnh giới hạn request, rồi kiểm tra để tiếp tục.",
  "deadline-exceeded":
    "Chia nhỏ công việc hoặc điều chỉnh thời gian, rồi kiểm tra để tiếp tục.",
  "provider-auth": "Kiểm tra API key và model trong Cài đặt trước khi thử lại.",
  "rate-limit":
    "Đợi gateway hết giới hạn hoặc chọn model khác trước khi thử lại.",
  transient: "Kiểm tra kết nối gateway; khi ổn định hãy kiểm tra để tiếp tục.",
  "invalid-output":
    "Xem phản hồi không hợp lệ; làm rõ yêu cầu hoặc đổi model trước khi thử lại.",
  "tool-test-failure":
    "Mở task liên quan, xem lệnh lỗi và giao Lead sửa trước khi kiểm tra lại.",
  configuration: "Kiểm tra model, runtime và công cụ của dự án trong Cài đặt.",
  "evidence-unverified":
    "Xem tiêu chí chưa đạt và bằng chứng còn thiếu; yêu cầu Lead bổ sung.",
  "integration-pending":
    "Mở kết quả để xem bản tích hợp và các thay đổi cần đưa vào source.",
  "integration-conflict":
    "Mở bản tích hợp và xử lý các file xung đột trước khi kiểm chứng lại.",
  "needs-context": "Trao đổi với Lead để bổ sung thông tin còn thiếu.",
  interrupted:
    "Kiểm tra source và checkpoint trước khi tiếp tục lượt bị gián đoạn.",
  runtime: "Mở chi tiết lỗi của task; xử lý nguyên nhân trước khi tiếp tục.",
};

/** Legacy titles may contain the complete internal prompt. Show one readable line. */
export function attentionTitle(value: string): string {
  return (
    value
      .split(/\r?\n/)
      .map((line) =>
        line
          .replace(/^\s*(?:#{1,6}\s*|[-*]\s+)/, "")
          .replace(/^\s*W-\d+\s*[·:–-]\s*/, "")
          .replace(/[*`]/g, "")
          .trim(),
      )
      .find(Boolean)
      ?.slice(0, 160) || "Công việc chưa có tên"
  );
}

function legacyCode(error: string, state: string): FailureCode {
  if (/request_limit|hết (số )?request/i.test(error)) return "budget-exhausted";
  if (/source.*(thay đổi|đồng thời)|workspace.changed/i.test(error))
    return "workspace-changed";
  if (/ngoài phạm vi|scope.violation/i.test(error)) return "scope-violation";
  if (/deadline|hết thời gian/i.test(error)) return "deadline-exceeded";
  if (/\b401\b|\b403\b|authentication|xác thực/i.test(error))
    return "provider-auth";
  if (/\b429\b|rate.?limit/i.test(error)) return "rate-limit";
  if (/snapshot.*(chưa đủ|không đầy đủ)/i.test(error))
    return "incomplete-snapshot";
  if (state === "interrupted") return "interrupted";
  if (state === "needs_input") return "needs-context";
  return "runtime";
}

export function runIssue(run: IssueInput): RunIssue | null {
  if (!["failed", "interrupted", "blocked", "needs_input"].includes(run.state))
    return null;
  // An actual failing task outranks a generic run error; a failed review is
  // distinct from workers finishing their execution.
  const latest = currentIssueTasks(run.tasks);
  const task = latest
    .reverse()
    .find((t) => ["failed", "blocked"].includes(t.state));
  const problem: ExecutionFailure | undefined = task?.failure ?? run.failure;
  const code = problem?.code ?? legacyCode(task?.error || run.error, run.state);
  const criteria =
    run.review?.acceptance
      .filter((c) => c.status !== "passed")
      .map((c) => c.criterion) ?? [];
  const reviewBlocked = run.review && run.review.status !== "completed";
  return {
    label:
      !task && reviewBlocked && code === "runtime"
        ? "Review chưa đạt"
        : (failureLabels[code] ?? failureLabels.runtime),
    reason: (
      task?.error ||
      problem?.message ||
      run.error ||
      (reviewBlocked ? run.review?.summary : "") ||
      "Lượt thực hiện đã dừng, chưa có kết quả được xác nhận."
    ).slice(0, 480),
    nextAction:
      !task && reviewBlocked && code === "runtime"
        ? remedies["evidence-unverified"]
        : (remedies[code] ?? remedies.runtime),
    taskId: task?.id ?? null,
    taskTitle: task?.title ?? null,
    role: task?.role ?? (reviewBlocked ? "lead" : null),
    criteria: criteria.slice(0, 8),
  };
}

export function currentIssueTasks<T extends IssueTask>(tasks: T[]): T[] {
  return [
    ...new Map(
      tasks.map((task) => [task.originalTaskId ?? task.id, task]),
    ).values(),
  ];
}
