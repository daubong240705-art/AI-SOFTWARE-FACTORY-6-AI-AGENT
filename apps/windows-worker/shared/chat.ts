import type { RunState } from "./runs";
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
};
export type ConversationContext = { text: string; runIds: string[] };
