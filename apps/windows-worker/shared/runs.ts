import type { Role, Settings } from "./contracts";
import type { TeamTask, TeamReview, ProfileSnapshot } from "./team";
import type { SkillCatalogSnapshot, SkillSelection } from "./skills";

export type RunState =
  | "needs_input"
  | "queued"
  | "running"
  | "blocked"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
export type RunEvent = {
  sequence: number;
  runId: string;
  type: string;
  text: string;
  at: string;
};
export type Permission = { id: string; permission: string; patterns: string[] };
export type ChangedFile = {
  path: string;
  kind: "added" | "modified" | "deleted";
};
export type CommandResult = {
  artifactId?: string;
  artifactHash?: string;
  sessionId?: string;
  sourceVersion?: string;
  cwd?: string;
  startedAt?: number;
  endedAt?: number;
  outputTruncated?: boolean;
  taskId?: string;
  callId: string;
  command: string;
  status: string;
  output: string;
  exitCode: number | null;
};
export type Run = {
  skillCatalog?: SkillCatalogSnapshot;
  skillSelection?: SkillSelection;
  partialText?: string;
  retryOf?: string;
  attemptRoot?: string;
  conversationId?: string | null;
  context?: { text: string; runIds: string[] };
  mode: "direct" | "team";
  tasks: TeamTask[];
  profiles: ProfileSnapshot[];
  currentTaskId: string | null;
  fixRound: number;
  review: TeamReview | null;
  id: string;
  projectId: string;
  projectName: string;
  workspace: string;
  prompt: string;
  role: Role;
  model: string;
  state: RunState;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  sessionId: string | null;
  summary: string;
  error: string;
  settings: Settings;
  changes: ChangedFile[];
  commands: CommandResult[];
  permissions: Permission[];
  requests: number;
  baselineComplete: boolean;
  toolsCompleted: number;
  runtimeVersion: string;
  inputTokens: number;
  outputTokens: number;
};
export type RunDetail = { run: Run; events: RunEvent[] };
export type RunSummary = Pick<
  Run,
  | "id"
  | "projectId"
  | "projectName"
  | "prompt"
  | "role"
  | "model"
  | "state"
  | "createdAt"
  | "conversationId"
>;
export type RuntimeView = { activeId: string | null; runs: RunSummary[] };
export const isActive = (state: RunState): boolean =>
  ["queued", "running", "blocked", "cancelling"].includes(state);
export const runLabels: Record<RunState, string> = {
  needs_input: "Cần bổ sung",
  queued: "Đang chuẩn bị",
  running: "Đang chạy",
  blocked: "Cần xử lý",
  cancelling: "Đang dừng",
  completed: "Đã kết thúc",
  failed: "Thất bại",
  cancelled: "Đã dừng",
  interrupted: "Bị gián đoạn",
};
export function normalizeRun(run: Run): Run {
  return {
    ...run,
    mode: run.mode ?? "direct",
    tasks: run.tasks ?? [],
    profiles: run.profiles ?? [],
    currentTaskId: run.currentTaskId ?? null,
    fixRound: run.fixRound ?? 0,
    review: run.review ?? null,
  };
}
