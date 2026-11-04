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
  .extend({ conversationId: id.optional() })
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
export type BoardItem = z.infer<typeof createBoardItemSchema> & {
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
