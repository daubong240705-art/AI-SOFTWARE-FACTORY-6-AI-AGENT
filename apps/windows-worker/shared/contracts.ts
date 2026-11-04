import { z } from "zod";
import { roles } from "./defaults";
import type { Run, RunDetail, RuntimeView } from "./runs";
import type { EvidenceView, FileDiff, RestorePreview } from "./evidence";
import type {
  ConversationSummary,
  ConversationDetail,
  Conversation,
  FollowUp,
} from "./chat";

export { roles, defaultSettings } from "./defaults";
export type Role = (typeof roles)[number];
export const agentSchema = z
  .object({
    role: z.enum(roles),
    enabled: z.boolean(),
    model: z.string().trim().max(200),
  })
  .strict();
export const settingsSchema = z
  .object({
    gatewayUrl: z
      .string()
      .trim()
      .max(2048)
      .refine((value) => {
        if (!value) return true;
        try {
          const url = new URL(value);
          return (
            ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash
          );
        } catch {
          return false;
        }
      }, "URL phải là HTTP/HTTPS, không chứa key hoặc query."),
    caPath: z.string().max(4096),
    runtimePath: z.string().trim().max(4096),
    timeoutMinutes: z.number().int().min(1).max(240),
    maxRequests: z.number().int().min(1).max(1000),
    maxFixRounds: z.number().int().min(0).max(2),
    permissionMode: z.enum(["ask", "full-access"]).default("ask"),
    teamExecution: z
      .enum(["sequential", "isolated-pair"])
      .default("sequential"),
    agents: z
      .array(agentSchema)
      .length(7)
      .refine(
        (items) => new Set(items.map((a) => a.role)).size === 7,
        "Mỗi role chỉ xuất hiện một lần.",
      )
      .refine(
        (items) => items.find((a) => a.role === "lead")?.enabled,
        "Lead luôn phải bật.",
      ),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;
export const saveSettingsSchema = z
  .object({
    settings: settingsSchema,
    keyAction: z.enum(["keep", "replace", "remove"]),
    apiKey: z.string().max(8192).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.keyAction === "replace" &&
      (!value.apiKey?.trim() || /[\r\n]/.test(value.apiKey))
    ) {
      context.addIssue({
        code: "custom",
        message: "API key không hợp lệ.",
        path: ["apiKey"],
      });
    }
    if (value.keyAction !== "replace" && value.apiKey) {
      context.addIssue({
        code: "custom",
        message: "Không gửi key khi giữ hoặc xóa key.",
        path: ["apiKey"],
      });
    }
  });
export type SaveSettings = z.infer<typeof saveSettingsSchema>;
export const idSchema = z.string().uuid();
export type Project = {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: string;
  draft: string;
};
export type ProjectStatus = {
  gitRoot: string | null;
  branch: string | null;
  changedFiles: number;
  error?: string;
};
export type ToolStatus = {
  name: string;
  available: boolean;
  version: string;
  path: string;
};
export type Bootstrap = {
  settings: Settings;
  projects: Project[];
  models: string[];
  hasKey: boolean;
  secureStorage: boolean;
};
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };
export interface WorkerAPI {
  inbox(
    input: import("zod").z.infer<typeof import("./inbox").inboxQuerySchema>,
  ): Promise<Reply<import("./inbox").InboxPage>>;
  inboxSeen(
    input: import("zod").z.infer<typeof import("./inbox").inboxSeenSchema>,
  ): Promise<Reply<void>>;
  readiness(
    input: import("zod").z.infer<typeof import("./readiness").readinessSchema>,
  ): Promise<Reply<import("./readiness").Readiness>>;
  workReport(
    input: import("./reports").ReportRef,
  ): Promise<Reply<import("./reports").ReportView>>;
  reportFile(
    input: import("./reports").ReportRef & { path: string },
  ): Promise<Reply<Pick<FileDiff, "patch" | "binary" | "reason">>>;
  reportDecision(
    input: import("./reports").ReportDecision,
  ): Promise<Reply<import("./reports").ReportView>>;
  reportPolicy(
    input: import("zod").z.infer<typeof import("./reports").reportPolicySchema>,
  ): Promise<Reply<{ required: boolean; version: number }>>;
  questionSet(
    input: import("zod").z.infer<
      typeof import("./questions").questionRefSchema
    >,
  ): Promise<Reply<import("./questions").QuestionSet>>;
  saveQuestionDraft(
    input: import("./questions").AnswerQuestions,
  ): Promise<Reply<import("./questions").QuestionSet>>;
  answerQuestions(
    input: import("./questions").AnswerQuestions,
  ): Promise<Reply<import("./questions").QuestionSet>>;
  workChatForRun(input: {
    projectId: string;
    runId: string;
  }): Promise<Reply<import("./chat").WorkChatContext | null>>;
  sendChat(
    input: import("./chat").ChatSend,
  ): Promise<Reply<import("./chat").ChatReceipt>>;
  workChat(input: {
    projectId: string;
    itemId: string;
  }): Promise<Reply<import("./chat").WorkChatContext>>;
  workItemDetail(
    input: import("zod").z.infer<typeof import("./board").workItemPageSchema>,
  ): Promise<Reply<import("./board").WorkItemDetail>>;
  workItemComments(
    input: import("zod").z.infer<typeof import("./board").workItemPageSchema>,
  ): Promise<
    Reply<{ comments: import("./board").WorkComment[]; hasMore: boolean }>
  >;
  addWorkComment(
    input: import("zod").z.infer<typeof import("./board").workCommentSchema>,
  ): Promise<Reply<import("./board").WorkComment>>;
  materializeWorkItem(
    input: import("zod").z.infer<
      typeof import("./board").materializeWorkItemSchema
    >,
  ): Promise<Reply<import("./board").BoardItem>>;
  exportWorkItem(
    input: import("zod").z.infer<typeof import("./board").workItemRefSchema>,
  ): Promise<Reply<boolean>>;
  createBoardItem(
    input: import("zod").z.infer<
      typeof import("./board").createBoardItemSchema
    >,
  ): Promise<Reply<import("./board").BoardItem>>;
  boardItem(id: string): Promise<Reply<import("./board").BoardItem>>;
  updateBoardItem(
    input: import("zod").z.infer<
      typeof import("./board").updateBoardItemSchema
    >,
  ): Promise<Reply<import("./board").BoardItem>>;
  moveBoardItem(
    input: import("zod").z.infer<typeof import("./board").moveBoardItemSchema>,
  ): Promise<Reply<import("./board").BoardItem>>;
  archiveBoardItem(input: {
    id: string;
    version: number;
    archived: boolean;
  }): Promise<Reply<import("./board").BoardItem>>;
  submitBoardItem(
    input: import("zod").z.infer<
      typeof import("./board").submitBoardItemSchema
    >,
  ): Promise<Reply<import("./board").BoardSubmission>>;
  monitorSnapshot(
    input: import("./monitor").MonitorRequest,
  ): Promise<Reply<import("./monitor").MonitorReply>>;
  workspaces(
    projectId: string,
  ): Promise<Reply<import("./worktrees").OwnedWorkspace[]>>;
  createWorkspace(
    projectId: string,
  ): Promise<Reply<import("./worktrees").OwnedWorkspace>>;
  openWorkspace(id: string): Promise<Reply<Project>>;
  recoverWorkspace(
    id: string,
  ): Promise<Reply<import("./worktrees").OwnedWorkspace>>;
  previewWorkspaceRemoval(
    id: string,
  ): Promise<Reply<import("./worktrees").WorkspaceRemoval>>;
  removeWorkspace(token: string): Promise<Reply<void>>;
  recovery(id: string): Promise<Reply<import("./lifecycle").RecoveryPreview>>;
  continueRecovery(token: string): Promise<Reply<Run>>;
  exportRun(id: string): Promise<Reply<boolean>>;
  retention(input: {
    days: number;
    keep: number;
  }): Promise<Reply<import("./lifecycle").RetentionPreview>>;
  prune(token: string): Promise<Reply<number>>;
  commandCatalog(
    id: string,
  ): Promise<Reply<import("./lifecycle").ProjectCommand[]>>;
  startCommand(input: {
    projectId: string;
    script: string;
  }): Promise<Reply<import("./lifecycle").LocalCommand>>;
  stopCommand(): Promise<Reply<void>>;
  localCommand(): Promise<Reply<import("./lifecycle").LocalCommand | null>>;
  acceptanceEvidence(
    ref: import("./evidence").EvidenceRef,
  ): Promise<Reply<string>>;
  taskFileDiff(
    ref: import("./evidence").EvidenceRef,
  ): Promise<Reply<Pick<FileDiff, "patch" | "binary" | "reason">>>;
  commandOutput(input: {
    runId: string;
    callId: string;
    artifactId?: string;
  }): Promise<Reply<string>>;
  evidence(id: string): Promise<Reply<EvidenceView>>;
  fileDiff(input: {
    runId: string;
    path: string;
    comparison: "run" | "staged" | "unstaged";
    source: "before" | "after";
  }): Promise<Reply<FileDiff>>;
  previewRestore(input: {
    runId: string;
    path: string;
  }): Promise<Reply<RestorePreview>>;
  restoreFile(token: string): Promise<Reply<void>>;
  revealFile(input: { runId: string; path: string }): Promise<Reply<void>>;
  enqueue(input: {
    projectId: string;
    conversationId: string;
    prompt: string;
    role: Role;
    mode: "direct" | "team";
  }): Promise<Reply<FollowUp>>;
  editFollowUp(input: { id: string; prompt: string }): Promise<Reply<void>>;
  removeFollowUp(id: string): Promise<Reply<void>>;
  resumeFollowUp(id: string): Promise<Reply<Run>>;
  retryRun(id: string): Promise<Reply<Run>>;
  startRun(input: {
    conversationId?: string;
    mode?: "direct" | "team";
    projectId: string;
    prompt: string;
    role: Role;
  }): Promise<Reply<Run>>;
  conversations(input: {
    projectId?: string;
    search?: string;
  }): Promise<Reply<ConversationSummary[]>>;
  conversation(id: string, before?: number): Promise<Reply<ConversationDetail>>;
  createConversation(projectId: string): Promise<Reply<Conversation>>;
  renameConversation(input: {
    id: string;
    title: string;
  }): Promise<Reply<Conversation>>;
  saveConversationDraft(input: {
    id: string;
    draft: string;
  }): Promise<Reply<void>>;
  openExternal(url: string): Promise<Reply<void>>;
  stopRun(id: string): Promise<Reply<void>>;
  runtimeView(): Promise<Reply<RuntimeView>>;
  runDetail(id: string): Promise<Reply<RunDetail>>;
  replyPermission(input: {
    runId: string;
    requestId: string;
    allow: boolean;
  }): Promise<Reply<void>>;
  bootstrap(): Promise<Reply<Bootstrap>>;
  chooseProject(): Promise<Reply<Project | null>>;
  openProject(id: string): Promise<Reply<Project>>;
  removeProject(id: string): Promise<Reply<void>>;
  projectStatus(id: string): Promise<Reply<ProjectStatus>>;
  revealProject(id: string): Promise<Reply<void>>;
  saveDraft(input: { id: string; draft: string }): Promise<Reply<void>>;
  saveSettings(input: SaveSettings): Promise<Reply<Bootstrap>>;
  chooseFile(kind: "ca" | "runtime"): Promise<Reply<string | null>>;
  fetchModels(): Promise<Reply<string[]>>;
  checkTools(): Promise<Reply<ToolStatus[]>>;
}
export { channels } from "./channels";
