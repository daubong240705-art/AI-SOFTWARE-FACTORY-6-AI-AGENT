import { z } from "zod";
export const inboxQuerySchema = z
  .object({
    unreadOnly: z.boolean().default(false),
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
};
export type InboxPage = {
  items: InboxItem[];
  hasMore: boolean;
  next: { at: string; key: string } | null;
};
export const inboxLabels: Record<InboxItem["kind"], string> = {
  permission: "Chờ cấp quyền",
  question: "Cần trả lời",
  report: "Chờ nghiệm thu",
  failure: "Cần xử lý",
  queue: "Hàng chờ tạm giữ",
};
