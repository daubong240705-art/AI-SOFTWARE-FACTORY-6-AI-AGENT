import { z } from "zod";
import type { EvidenceRef, FileVersion } from "./evidence";
import type { Run, CommandResult, ChangedFile } from "./runs";
import type { ChatReceipt } from "./chat";

export const reportRefSchema = z
  .object({
    projectId: z.string().uuid(),
    runId: z.string().uuid(),
  })
  .strict();
export const reportDecisionSchema = reportRefSchema
  .extend({
    requestId: z.string().uuid(),
    action: z.enum(["accept", "request-fix"]),
    comment: z.string().trim().max(6000),
  })
  .strict()
  .refine(
    (v) => v.action !== "request-fix" || !!v.comment,
    "Nhập nội dung cần sửa.",
  );
export const reportPolicySchema = z
  .object({
    projectId: z.string().uuid(),
    itemId: z.string().uuid(),
    version: z.number().int().nonnegative(),
    required: z.boolean(),
    runId: z.string().uuid().optional(),
  })
  .strict();
export const reportFileSchema = reportRefSchema
  .extend({ path: z.string().min(1).max(4096) })
  .strict();
export type ReportRef = z.infer<typeof reportRefSchema>;
export type ReportDecision = z.infer<typeof reportDecisionSchema>;
export type ReportStatus = "pass" | "fail" | "not-run" | "unknown";
export const reportStatusLabels: Record<ReportStatus, string> = {
  pass: "Đạt",
  fail: "Chưa đạt",
  "not-run": "Chưa chạy",
  unknown: "Chưa xác định",
};
export type Report = {
  version: 1;
  id: string;
  runId: string;
  projectId: string;
  capturedAt: string;
  endedAt: string;
  state: Run["state"];
  attemptRoot: string;
  retryOf: string | null;
  conversationId: string | null;
  work: {
    itemId: string;
    revision: number;
    submissionId: string | null;
    title: string;
    criteria: string[];
  } | null;
  sourceVersion: string | null;
  workspace: string;
  summary: string;
  error: string;
  verification: ReportStatus;
  commands: (CommandResult & {
    result: ReportStatus;
    artifactState: "available" | "missing" | "unknown";
    artifactIssue: string;
  })[];
  criteria: {
    criterion: string;
    result: ReportStatus;
    evidence: string;
    refs: EvidenceRef[];
  }[];
  changes: ChangedFile[];
  review: Run["review"];
  files: {
    path: string;
    before: FileVersion | null;
    after: FileVersion | null;
    issue: string;
  }[];
  tasks: {
    id: string;
    originalTaskId?: string;
    state: string;
    role: string;
    model: string;
    sessionId: string | null;
    sourceVersion: string | null;
  }[];
  metrics: {
    requests: number;
    inputTokens: number | null;
    outputTokens: number | null;
    cost: null;
  };
  provenance: {
    model: string;
    runtimeVersion: string;
    mode: string;
    origin: "stored-terminal-run";
    artifactPolicy: string;
  };
};
export type ReportView = {
  availability?: { acceptBlocked?: string; changeBlocked?: string };
  report: Report;
  artifactIssues: string[];
  checkedAt: string;
  freshness: "current" | "stale" | "unknown";
  reasons: string[];
  policy: { required: boolean; version: number };
  decision: {
    action: "accept" | "request-fix";
    comment: string;
    createdAt: string;
    receipt?: ChatReceipt;
  } | null;
  canDecide: boolean;
};

// Summary facts contain no source/output or user comments. Source freshness is
// unknown until an explicit report check; SQLite can still prove supersession.
export type ReportState = {
  report: Pick<Report, "runId" | "projectId" | "verification">;
  freshness: ReportView["freshness"];
  reasons: string[];
  policy: ReportView["policy"];
  decision: Pick<NonNullable<ReportView["decision"]>, "action"> | null;
};

export function reportStateLabel(
  report: ReportState,
  unavailable = false,
): string {
  if (report.freshness === "stale") return "Kết quả phiên bản trước";
  if (report.decision?.action === "request-fix") return "Đã yêu cầu sửa";
  if (!unavailable && report.policy.required && !report.decision)
    return "Chờ nghiệm thu";
  if (report.report.verification === "pass" && !unavailable)
    return report.freshness === "current"
      ? "Hoàn thành"
      : "Đã xác minh · Chưa đối chiếu source";
  return "Có kết quả · Chưa xác minh";
}

export function reportCapabilities(view: ReportView) {
  const changeBlocked = view.availability?.changeBlocked;
  const canChange = !changeBlocked && view.freshness !== "stale";
  const canDecide = canChange && view.canDecide && !view.decision;
  return {
    accept:
      !!canDecide &&
      view.freshness === "current" &&
      !view.artifactIssues.length &&
      !view.availability?.acceptBlocked,
    requestFix: !!canDecide,
    setPolicy: !!canChange && !!view.report.work,
    reason:
      changeBlocked ||
      (view.freshness === "stale"
        ? view.reasons.join(" · ") || "Kết quả đã hết hiệu lực."
        : view.decision
          ? "Báo cáo đã có quyết định."
          : !view.canDecide
            ? "Mở công việc hiện tại hoặc bản tích hợp để tiếp tục."
            : view.artifactIssues.length
              ? "Thiếu bằng chứng lưu trữ để nghiệm thu."
              : view.availability?.acceptBlocked ||
                (view.freshness === "unknown"
                  ? "Đối chiếu source trước khi nghiệm thu."
                  : "")),
  };
}
