import type { RunState } from "./runs";
import type { Role, Settings } from "./contracts";
import { z } from "zod";
import { roles } from "./defaults";
export const chatSendSchema = z
  .object({
    requestId: z.string().uuid(),
    projectId: z.string().uuid(),
    conversationId: z.string().uuid(),
    prompt: z.string().trim().min(1).max(32000),
    role: z.enum(roles),
    mode: z.enum(["direct", "team"]),
    workContext: z
      .object({
        itemId: z.string().uuid(),
        revision: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ChatSend = z.infer<typeof chatSendSchema>;
export type WorkChatContext = {
  projectId: string;
  itemId: string;
  code: string;
  title: string;
  revision: number;
  conversationId: string;
};
export type WorkChatSnapshot = WorkChatContext & {
  body: string;
  criteria: string[];
  notes: string[];
};
export type ChatReceipt = {
  requestId: string;
  runId: string | null;
  followUpId: string | null;
  state: "running" | "queued" | "removed";
};
export type FollowUp = {
  immutable?: boolean;
  workContext?: WorkChatSnapshot;
  boardItemId?: string;
  id: string;
  conversationId: string;
  projectId: string;
  prompt: string;
  role: Role;
  mode: "direct" | "team";
  settings: Settings;
  afterRunId: string | null;
  state: "waiting" | "held";
  reason: string;
  createdAt: string;
};
export type Conversation = {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  draft: string;
};
export type ConversationSummary = Omit<Conversation, "draft">;
export type ChatMessage = {
  integrationId?: string;
  failureCode?: import("./execution").FailureCode;
  retryOf?: string;
  sequence: number;
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  runId: string;
  state: RunState;
  createdAt: string;
};
export type ConversationDetail = {
  conversation: Conversation;
  messages: ChatMessage[];
  hasEarlier: boolean;
  queue?: FollowUp[];
};
export type ConversationContext = { text: string; runIds: string[] };
