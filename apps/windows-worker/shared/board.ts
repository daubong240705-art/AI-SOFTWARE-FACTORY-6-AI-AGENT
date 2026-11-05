import { z } from "zod";
import { roles } from "./defaults";
import type { Role } from "./contracts";
import type { TeamTask } from "./team";

export const boardColumns = [
  "backlog",
  "ready",
  "in_progress",
  "review",
  "blocked",
  "done",
] as const;
export type BoardColumn = (typeof boardColumns)[number];
export const boardColumnLabels: Record<BoardColumn, string> = {
  backlog: "Chưa làm",
  ready: "Sẵn sàng",
  in_progress: "Đang làm",
  review: "Chờ review",
  blocked: "Cần xử lý",
  done: "Xong",
};
const id = z.string().uuid();
const itemFields = {
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().max(12000),
  criteria: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
  suggestedRole: z.enum(roles).nullable(),
  priority: z.number().int().min(0).max(2),
  planningState: z.enum(["backlog", "ready"]),
};
export const createBoardItemSchema = z
  .object({ projectId: id, ...itemFields })
  .strict();
export const boardVersionSchema = z
  .object({ id, version: z.number().int().positive() })
  .strict();
export const updateBoardItemSchema = z
  .object({
    id,
    version: z.number().int().positive(),
    patch: z.object(itemFields).partial().strict(),
  })
  .strict();
export const moveBoardItemSchema = boardVersionSchema
  .extend({
    planningState: z.enum(["backlog", "ready"]),
    beforeId: id.optional(),
  })
  .strict();
export const submitBoardItemSchema = boardVersionSchema
  .extend({ conversationId: id.optional(), submissionKey: id.optional() })
  .strict();
export const boardQuerySchema = z
  .object({
    search: z.string().max(200).optional(),
    role: z.enum(roles).optional(),
    column: z.enum(boardColumns).optional(),
    priority: z.number().int().min(0).max(2).optional(),
    conversationId: id.optional(),
    runId: id.optional(),
    workType: z
      .enum([
        "docs",
        "analysis",
        "implementation",
        "bugfix",
        "testing",
        "local-dev",
      ])
      .optional(),
    archived: z.boolean().optional(),
    showStopped: z.boolean().optional(),
    offset: z.number().int().min(0).max(100000).optional(),
  })
  .strict();
export type BoardQuery = z.infer<typeof boardQuerySchema>;
export type BoardItem = Omit<
  z.infer<typeof createBoardItemSchema>,
  "criteria"
> & {
  criteria: string[];
  code: string;
  revision: number;
  conversationId: string | null;
  id: string;
  version: number;
  position: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type BoardLink = {
  itemId: string;
  runId: string | null;
  followUpId: string | null;
  createdAt: string;
  current?: boolean;
  revision?: number;
};
export type BoardSubmission = BoardLink & {
  conversationId: string;
  queued: boolean;
};
export type BoardTask = {
  id: string;
  originalTaskId?: string;
  role: Role;
  title: string;
  state: string;
  kind: TeamTask["kind"];
  model: string;
  dependsOn: string[];
  acceptanceCount: number;
  workType?: string;
};
export type BoardRun = {
  projectId?: string;
  commandCount?: number;
  permissionCount?: number;
  questionState?: import("./questions").QuestionSet["state"];
  id: string;
  rootId: string;
  conversationId: string | null;
  state: string;
  mode: string;
  prompt: string;
  model: string;
  role: Role;
  createdAt: string;
  endedAt: string | null;
  integrationState: string | null;
  reviewVerified: boolean;
  tasks: BoardTask[];
  changes: number;
  error: string;
};
export type BoardProgress = {
  tasks: number;
  executed: number;
  verified: number;
  criteria: number;
  passed: number;
};
export type BoardCard = {
  workState?: import("./work-state").WorkStateView;
  code?: string;
  key: string;
  itemId: string | null;
  version: number | null;
  kind: "planning" | "runtime";
  title: string;
  column: BoardColumn;
  reason: string;
  role: Role;
  roles: Role[];
  priority: number;
  position: number;
  archived: boolean;
  updatedAt: string;
  runId: string | null;
  conversationId: string | null;
  followUpId: string | null;
  stopped: boolean;
  progress: BoardProgress;
  workTypes: string[];
  changes: number;
};
export const workItemRefSchema = z
  .object({ projectId: id, itemId: id })
  .strict();
export const workItemPageSchema = workItemRefSchema
  .extend({
    before: z.number().int().positive().optional(),
    offset: z.number().int().min(0).max(100000).optional(),
  })
  .strict();
export const workCommentSchema = workItemRefSchema
  .extend({
    clientId: id,
    body: z.string().trim().min(1).max(6000),
  })
  .strict();
export const materializeWorkItemSchema = z
  .object({ projectId: id, runId: id })
  .strict();
export type WorkRevision = {
  revision: number;
  title: string;
  body: string;
  criteria: string[];
  createdAt: string;
  origin: "user" | "legacy";
};
export type WorkComment = {
  id: string;
  sequence: number;
  body: string;
  createdAt: string;
  actor: "user";
};
export type WorkAttempt = {
  id: string;
  state: string;
  role: string;
  model: string;
  createdAt: string;
  endedAt: string | null;
};
export type WorkSubmission = {
  id: string;
  itemId: string;
  revision: number;
  runId: string | null;
  currentRunId: string | null;
  followUpId: string | null;
  conversationId: string;
  state: string;
  createdAt: string;
  attempts: WorkAttempt[];
  hasEarlierAttempts: boolean;
};
export type WorkItemDetail = {
  item: BoardItem;
  revisions: WorkRevision[];
  hasEarlierRevisions: boolean;
  comments: WorkComment[];
  hasEarlierComments: boolean;
  submissions: WorkSubmission[];
  hasMoreSubmissions: boolean;
};
export type BoardPage = {
  cards: BoardCard[];
  total: number;
  offset: number;
  hasMore: boolean;
  pageSize: number;
};
export function latestBoardTasks<
  T extends Pick<TeamTask, "id" | "originalTaskId" | "kind">,
>(tasks: T[]): T[] {
  const current = new Map<string, T>();
  for (const task of tasks)
    if (["work", "fix"].includes(task.kind))
      current.set(task.originalTaskId ?? task.id, task);
  return [...current.values()];
}
