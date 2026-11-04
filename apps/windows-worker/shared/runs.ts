import type { Role, Settings } from "./contracts";

export type RunState =
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
  callId: string;
  command: string;
  status: string;
  output: string;
  exitCode: number | null;
};
export type Run = {
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
>;
export type RuntimeView = { activeId: string | null; runs: RunSummary[] };
export const isActive = (state: RunState): boolean =>
  ["queued", "running", "blocked", "cancelling"].includes(state);
export const runLabels: Record<RunState, string> = {
  queued: "Đang chuẩn bị",
  running: "Đang chạy",
  blocked: "Chờ quyền",
  cancelling: "Đang dừng",
  completed: "Đã kết thúc",
  failed: "Thất bại",
  cancelled: "Đã dừng",
  interrupted: "Bị gián đoạn",
};
