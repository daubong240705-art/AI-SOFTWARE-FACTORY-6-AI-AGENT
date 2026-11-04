import type { RunState } from "./runs";
import type { Role, Settings } from "./contracts";
export type FollowUp = {
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
