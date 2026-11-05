import { z } from "zod";
import { workStateLabels } from "./work-state";
export const inboxQuerySchema = z
  .object({
    unreadOnly: z.boolean().default(false),
    projectId: z.string().uuid().optional(),
    category: z.enum(["decision", "blocked"]).optional(),
    scope: z.enum(["open", "closed"]).optional(),
    before: z
      .object({ at: z.string().max(80), key: z.string().max(220) })
      .strict()
      .optional(),
  })
  .strict();
export const inboxSeenSchema = z
  .object({
    key: z.string().min(1).max(220),
    token: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const inboxDismissSchema = inboxSeenSchema
  .extend({ dismissed: z.boolean() })
  .strict();
export type InboxItem = {
  key: string;
  token: string;
  kind: "permission" | "question" | "report" | "failure" | "queue";
  projectId: string;
  projectName: string;
  title: string;
  detail: string;
  at: string;
  runId: string | null;
  conversationId: string | null;
  unread: boolean;
  code: string | null;
  itemId: string | null;
  problem: string;
  nextAction: string;
  actionLabel: string;
  taskId: string | null;
  taskTitle: string | null;
  canDismiss: boolean;
  dismissed: boolean;
};
export type InboxPage = {
  items: InboxItem[];
  hasMore: boolean;
  next: { at: string; key: string } | null;
};
export const inboxLabels: Record<InboxItem["kind"], string> = workStateLabels;
