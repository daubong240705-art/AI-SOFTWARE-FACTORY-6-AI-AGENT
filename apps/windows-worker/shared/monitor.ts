import { z } from "zod";
import { roles } from "./defaults";
import { boardQuerySchema, type BoardPage } from "./board";

export const activitySchema = z.enum([
  "preparing",
  "waiting_model",
  "running",
  "reading",
  "editing",
  "command",
  "testing",
  "reviewing",
  "waiting_input",
  "stopping",
  "finished",
  "unknown",
]);
export type AgentActivity = z.infer<typeof activitySchema>;
export const activityLabels: Record<AgentActivity, string> = {
  preparing: "Đang chuẩn bị",
  waiting_model: "Chờ model",
  running: "Đang chạy",
  reading: "Đang đọc source",
  editing: "Đang sửa file",
  command: "Đang chạy lệnh",
  testing: "Đang kiểm thử",
  reviewing: "Đang review",
  waiting_input: "Chờ bạn",
  stopping: "Đang dừng",
  finished: "Đã kết thúc",
  unknown: "Chưa rõ hoạt động",
};
export const availabilityLabels = {
  available: "Rảnh",
  occupied: "Đang làm",
  disabled: "Đã tắt",
  unconfigured: "Chưa cấu hình",
  unknown: "Chưa đồng bộ",
} as const;
export type Availability = keyof typeof availabilityLabels;
export type ExecutionObservation = {
  executionId: string;
  startedAt: string;
  at: string;
  pendingModels: number;
  tools: Record<string, { activity: AgentActivity; at: string }>;
  finishedCalls?: string[];
  closed?: boolean;
};
export const monitorEventSchema = z
  .object({
    version: z.literal(1),
    taskId: z.string().max(100).nullable(),
    executionId: z.string().uuid().optional(),
    activity: activitySchema.optional(),
  })
  .strict();
export type MonitorEvent = z.infer<typeof monitorEventSchema>;
export const monitorRequestSchema = z
  .object({
    projectId: z.string().uuid(),
    epoch: z.string().uuid().optional(),
    sinceRevision: z.number().int().nonnegative().optional(),
    board: boardQuerySchema.optional(),
    overview: z.boolean().optional(),
  })
  .strict();
export type MonitorRequest = z.infer<typeof monitorRequestSchema>;
export type AgentExecution = {
  executionId: string;
  runId: string;
  taskId: string | null;
  logicalTaskKey: string;
  attemptKey: string;
  title: string;
  model: string;
  activity: AgentActivity;
  observedFrom: "runtime" | "derived";
  startedAt: string | null;
  activityAt: string | null;
};
export type AgentStatus = {
  role: (typeof roles)[number];
  availability: Availability;
  configuredModel: string | null;
  enabled: boolean;
  executions: AgentExecution[];
  waiting: { taskId: string; title: string; reason: string }[];
  lastFinished: {
    title: string;
    at: string | null;
    outcome: string;
    taskId?: string | null;
  } | null;
};
export type MonitorSnapshot = {
  epoch: string;
  revision: number;
  projectId: string;
  observedAt: string;
  activeRun: {
    id: string;
    projectId: string;
    projectName: string;
    state: string;
  } | null;
  runId: string | null;
  runState: string | null;
  conversationId: string | null;
  agents: AgentStatus[];
  board?: BoardPage;
  overview?: import("./overview").ProjectOverviewData;
  progress: {
    currentTasks: number;
    executedTasks: number;
    verifiedTasks: number;
    applicableCriteria: number;
    passedCriteria: number;
    unverifiedCriteria: number;
  };
};
export type MonitorReply =
  | {
      unchanged: true;
      epoch: string;
      revision: number;
      projectId: string;
      observedAt: string;
    }
  | { unchanged: false; snapshot: MonitorSnapshot };
