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
