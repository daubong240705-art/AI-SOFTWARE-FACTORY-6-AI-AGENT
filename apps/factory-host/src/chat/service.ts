import type { Database } from "better-sqlite3";
import { conversationSchema, messageSchema, type Command, type Conversation, type Message } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import type { HandlerMap } from "../commands/pipeline.js";
import { findLeadSeat, getActiveEngagement } from "../org/service.js";

interface ConversationRow { project_id: string; id: string; revision: number; seat_id: string; task_id: string | null; title: string }
interface MessageRow { body_json: string; ordinal: number }
export type TurnState = "queued" | "running" | "done" | "failed" | "unknown" | "budget-blocked";
interface TurnRow {
  project_id: string; id: string; conversation_id: string; state: TurnState; reply_message_id: string | null;
  error_kind: string | null; created_at: string; updated_at: string;
}
export interface LeadTurn {
  projectId: string; id: string; conversationId: string; state: TurnState; replyMessageId: string | null;
  errorKind: string | null; createdAt: string; updatedAt: string;
}
const conversationFromRow = (row: ConversationRow): Conversation => conversationSchema.parse({
  id: row.id, projectId: row.project_id, revision: row.revision, agentId: row.seat_id, workItemId: row.task_id, title: row.title,
});
const messageFromRow = (row: MessageRow): Message & { ordinal: number } => ({
  ...messageSchema.parse(JSON.parse(row.body_json).message), ordinal: row.ordinal,
});
const turnFromRow = (row: TurnRow): LeadTurn => ({
  projectId: row.project_id, id: row.id, conversationId: row.conversation_id, state: row.state,
  replyMessageId: row.reply_message_id, errorKind: row.error_kind, createdAt: row.created_at, updatedAt: row.updated_at,
});
const boundedLimit = (limit: number): number => Number.isNaN(limit) ? 100 : Math.max(1, Math.min(200, Math.trunc(limit)));

export function getConversation(raw: Database, projectId: string, conversationId: string): Conversation | undefined {
  const row = raw.prepare("SELECT * FROM conversations WHERE project_id = ? AND id = ?").get(projectId, conversationId) as ConversationRow | undefined;
  return row === undefined ? undefined : conversationFromRow(row);
}

export function listConversations(raw: Database, projectId: string): Conversation[] {
  return (raw.prepare("SELECT * FROM conversations WHERE project_id = ? ORDER BY id").all(projectId) as ConversationRow[])
    .map(conversationFromRow);
}

type ChatPayload = Extract<Command, { type: "chat.send" }>["payload"];
export function appendMessage(raw: Database, input: {
  projectId: string; conversationId: string; id: string; speaker: Message["speaker"]; agentId: string | null;
  text: string; createdAt: string; intent?: ChatPayload["intent"]; context?: ChatPayload["context"];
}): { message: Message; ordinal: number } {
  const message = messageSchema.parse({
    id: input.id, projectId: input.projectId, conversationId: input.conversationId, revision: 1,
    createdAt: input.createdAt, speaker: input.speaker, agentId: input.agentId, text: input.text, attachmentIds: [], runId: null,
  });
  return raw.transaction(() => {
    const { ordinal } = raw.prepare("SELECT COALESCE(MAX(ordinal), 0) + 1 AS ordinal FROM messages WHERE project_id = ? AND conversation_id = ?")
      .get(input.projectId, input.conversationId) as { ordinal: number };
    raw.prepare("INSERT INTO messages (project_id, id, conversation_id, ordinal, command_id, body_json) VALUES (?, ?, ?, ?, NULL, ?)")
      .run(input.projectId, input.id, input.conversationId, ordinal, JSON.stringify({ message,
        ...(input.intent === undefined ? {} : { intent: input.intent }), ...(input.context === undefined ? {} : { context: input.context }),
      }));
    return { message, ordinal };
  }).immediate();
}

export function listMessages(raw: Database, projectId: string, conversationId: string,
  { afterOrdinal = 0, limit = 100 }: { afterOrdinal?: number; limit?: number } = {},
): { messages: Array<Message & { ordinal: number }> } {
  const rows = raw.prepare("SELECT body_json, ordinal FROM messages WHERE project_id = ? AND conversation_id = ? AND ordinal > ? ORDER BY ordinal LIMIT ?")
    .all(projectId, conversationId, afterOrdinal, boundedLimit(limit)) as MessageRow[];
  return { messages: rows.map(messageFromRow) };
}

export function listRecentMessages(raw: Database, projectId: string, conversationId: string, limit: number): Array<Message & { ordinal: number }> {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("limit must be a non-negative safe integer");
  const rows = raw.prepare("SELECT body_json, ordinal FROM messages WHERE project_id = ? AND conversation_id = ? ORDER BY ordinal DESC LIMIT ?")
    .all(projectId, conversationId, limit) as MessageRow[];
  return rows.reverse().map(messageFromRow);
}

export function getTurn(raw: Database, projectId: string, turnId: string): LeadTurn | undefined {
  const row = raw.prepare("SELECT * FROM lead_turns WHERE project_id = ? AND id = ?").get(projectId, turnId) as TurnRow | undefined;
  return row === undefined ? undefined : turnFromRow(row);
}

export function listPendingTurns(raw: Database): LeadTurn[] {
  return (raw.prepare("SELECT * FROM lead_turns WHERE state IN (?, ?) ORDER BY created_at, id").all("queued", "running") as TurnRow[])
    .map(turnFromRow);
}

export function setTurnState(raw: Database, projectId: string, turnId: string, state: TurnState,
  { replyMessageId, errorKind, now }: { replyMessageId?: string; errorKind?: string; now: string },
): void {
  raw.transaction(() => {
    const turn = getTurn(raw, projectId, turnId);
    const allowed = turn?.state === "queued" ? ["running", "budget-blocked", "failed"]
      : turn?.state === "running" ? ["done", "failed", "unknown", "budget-blocked"] : [];
    if (!allowed.includes(state)) throw new Error("Lead turn transition not allowed");
    // SQLite also enforces that only done has a reply and only failed/budget-blocked have an error.
    raw.prepare("UPDATE lead_turns SET state = ?, reply_message_id = ?, error_kind = ?, updated_at = ? WHERE project_id = ? AND id = ?")
      .run(state, replyMessageId ?? null, errorKind ?? null, now, projectId, turnId);
  }).immediate();
}

export const conversationsCreateHandler: HandlerMap["conversations.create"] = ({ raw }, { projectId, payload }) => {
  if (!raw.prepare("SELECT id FROM projects WHERE id = ?").get(projectId))
    throw new CommandError("not-found", "project not found", "correct-input");
  if (raw.prepare("SELECT id FROM conversations WHERE id = ?").get(payload.conversationId))
    throw new CommandError("conflict", "conversation already exists", "correct-input");
  const engagement = getActiveEngagement(raw, projectId);
  const lead = engagement === undefined ? undefined : findLeadSeat(raw, engagement.teamId);
  if (!lead || lead.id !== payload.agentId)
    throw new CommandError("validation", "only the Lead seat can chat in M1", "correct-input");
  if (payload.workItemId !== null && !raw.prepare("SELECT id FROM tasks WHERE project_id = ? AND id = ?").get(projectId, payload.workItemId))
    throw new CommandError("not-found", "task not found in project", "correct-input");
  raw.prepare("INSERT INTO conversations (project_id, id, revision, seat_id, task_id, title) VALUES (?, ?, ?, ?, ?, ?)")
    .run(projectId, payload.conversationId, 1, payload.agentId, payload.workItemId, payload.title);
  return { effects: [{ kind: "conversation", id: payload.conversationId, revision: 1 }] };
};

export const chatSendHandler: HandlerMap["chat.send"] = ({ raw, clock }, { projectId, payload }) => {
  const conversation = getConversation(raw, projectId, payload.conversationId);
  if (!conversation) throw new CommandError("not-found", "conversation not found", "correct-input");
  if (payload.expectedRevision !== conversation.revision)
    throw new CommandError("conflict", "conversation revision changed", "refresh", { currentRevision: conversation.revision });
  if (raw.prepare("SELECT id FROM messages WHERE project_id = ? AND id = ?").get(projectId, payload.messageId))
    throw new CommandError("conflict", "message already exists", "correct-input");
  if (payload.attachmentIds.length > 0)
    throw new CommandError("unsupported", "attachments are not available yet", "correct-input");
  const now = clock().toISOString();
  const { message } = appendMessage(raw, {
    projectId, conversationId: conversation.id, id: payload.messageId, speaker: "user", agentId: null,
    text: payload.text, createdAt: now, intent: payload.intent, context: payload.context,
  });
  raw.prepare("INSERT INTO lead_turns (project_id, id, conversation_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(projectId, payload.messageId, conversation.id, "queued", now, now);
  return { effects: [{ kind: "message", id: message.id, revision: 1 }], events: [{ type: "message.appended", message }] };
};
