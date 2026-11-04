export type FailureCode =
  | "cancelled"
  | "permission-denied"
  | "scope-violation"
  | "workspace-changed"
  | "incomplete-snapshot"
  | "budget-exhausted"
  | "deadline-exceeded"
  | "provider-auth"
  | "rate-limit"
  | "transient"
  | "invalid-output"
  | "tool-test-failure"
  | "configuration"
  | "evidence-unverified"
  | "needs-context"
  | "interrupted"
  | "runtime";
export type ExecutionFailure = {
  code: FailureCode;
  message: string;
  retry: "manual" | "none";
};
export type ExecutionMetrics = {
  version: 1;
  requests: number;
  inputTokens: number | null;
  outputTokens: number | null;
  usageSteps: number;
  usageSource: "opencode" | null;
  durationMs: number | null;
  commands: { passed: number; failed: number; incomplete: number };
  cost: null;
};
export const failureLabels: Record<FailureCode, string> = {
  cancelled: "Đã dừng",
  "permission-denied": "Quyền bị từ chối",
  "scope-violation": "Vượt phạm vi",
  "workspace-changed": "Source thay đổi đồng thời",
  "incomplete-snapshot": "Snapshot chưa đủ",
  "budget-exhausted": "Hết request",
  "deadline-exceeded": "Hết thời gian",
  "provider-auth": "Lỗi xác thực",
  "rate-limit": "Giới hạn gateway",
  transient: "Lỗi kết nối/gateway",
  "invalid-output": "Phản hồi không hợp lệ",
  "tool-test-failure": "Lệnh/kiểm thử lỗi",
  configuration: "Cần cấu hình",
  "evidence-unverified": "Chưa đủ bằng chứng",
  "needs-context": "Cần bổ sung",
  interrupted: "Bị gián đoạn",
  runtime: "Lỗi runtime",
};
