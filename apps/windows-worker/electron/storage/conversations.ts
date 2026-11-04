import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  Conversation,
  ConversationSummary,
  ConversationDetail,
  ChatMessage,
  ConversationContext,
} from "../../shared/chat";
import type { Run } from "../../shared/runs";
import { isActive } from "../../shared/runs";

const titleFor = (prompt: string) =>
  prompt.trim().split(/\r?\n/)[0].slice(0, 100) || "Cuộc trò chuyện mới";
const assistantContent = (run: Run) =>
  [
    run.summary || run.partialText,
    run.error && run.error !== run.summary ? run.error : "",
  ]
    .filter(Boolean)
    .join("\n\n");

export class Conversations {
  constructor(
    private db: Database.Database,
    directory: string,
    originalVersion: number,
  ) {
    db.function("asf_search", { deterministic: true }, (value) =>
      String(value ?? "")
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/[đĐ]/g, "d")
        .toLowerCase(),
    );
    if ((db.pragma("user_version", { simple: true }) as number) >= 4) return;
    if (originalVersion === 3) {
      const backup = join(directory, "worker.schema3.backup.sqlite");
      if (!existsSync(backup)) db.prepare("VACUUM INTO ?").run(backup);
    }
    db.transaction(() => {
      db.exec(`CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, draft TEXT NOT NULL DEFAULT '');
        CREATE INDEX conversation_project ON conversations(project_id,updated_at);
        CREATE TABLE messages (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, conversation_id TEXT NOT NULL REFERENCES conversations(id), role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES runs(id), state TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(run_id,role));
        CREATE INDEX conversation_messages ON messages(conversation_id,sequence);
        CREATE INDEX message_run ON messages(run_id);
        PRAGMA user_version=4;`);
      // No history limit here: all old runs, including deleted projects, survive.
      const rows = db
        .prepare("SELECT value FROM runs ORDER BY created_at,id")
        .all() as { value: string }[];
      for (const row of rows) {
        const run = JSON.parse(row.value) as Run;
        const conversation = this.insert(
          run.projectId,
          titleFor(run.prompt),
          run.createdAt,
        );
        run.conversationId = conversation.id;
        db.prepare("UPDATE runs SET value=? WHERE id=?").run(
          JSON.stringify(run),
          run.id,
        );
        this.messagesFor(run);
      }
      for (const project of db
        .prepare("SELECT id,draft FROM projects WHERE draft<>''")
        .all() as { id: string; draft: string }[]) {
        const conversation = this.insert(project.id, "Bản nháp đã lưu");
        db.prepare("UPDATE conversations SET draft=? WHERE id=?").run(
          project.draft,
          conversation.id,
        );
      }
    })();
  }
  private insert(
    projectId: string,
    title = "Cuộc trò chuyện mới",
    at = new Date().toISOString(),
  ): Conversation {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO conversations VALUES (?,?,?,?,?,?)")
      .run(id, projectId, title, at, at, "");
    return this.find(id);
  }
  create(projectId: string): Conversation {
    if (!this.db.prepare("SELECT id FROM projects WHERE id=?").get(projectId))
      throw new Error("Không tìm thấy dự án.");
    return this.insert(projectId);
  }
  list(
    input: { projectId?: string; search?: string } = {},
  ): ConversationSummary[] {
    // instr treats '%' and '_' literally, not as SQL wildcards.
    return this.db
      .prepare(
        `SELECT id,project_id AS projectId,title,created_at AS createdAt,updated_at AS updatedAt FROM conversations
      WHERE (? IS NULL OR project_id=?) AND (?='' OR instr(asf_search(title),asf_search(?))>0)
      ORDER BY updated_at DESC,rowid DESC LIMIT 300`,
      )
      .all(
        input.projectId ?? null,
        input.projectId ?? null,
        input.search ?? "",
        input.search ?? "",
      ) as ConversationSummary[];
  }
  private find(id: string): Conversation {
    const conversation = this.db
      .prepare(
        "SELECT id,project_id AS projectId,title,created_at AS createdAt,updated_at AS updatedAt,draft FROM conversations WHERE id=?",
      )
      .get(id) as Conversation | undefined;
    if (!conversation) throw new Error("Không tìm thấy cuộc trò chuyện.");
    return conversation;
  }
  get(id: string, before?: number): ConversationDetail {
    const conversation = this.find(id);
    const messages = (
      this.db
        .prepare(
          "SELECT sequence,id,conversation_id AS conversationId,role,content,run_id AS runId,state,created_at AS createdAt FROM messages WHERE conversation_id=? AND sequence<? ORDER BY sequence DESC LIMIT 60",
        )
        .all(id, before ?? Number.MAX_SAFE_INTEGER) as ChatMessage[]
    ).reverse();
    const hasEarlier =
      messages.length > 0 &&
      !!this.db
        .prepare(
          "SELECT 1 FROM messages WHERE conversation_id=? AND sequence<? LIMIT 1",
        )
        .get(id, messages[0].sequence);
    for (const message of messages) {
      const row = this.db
        .prepare(
          "SELECT json_extract(value,'$.retryOf') AS retryOf,json_extract(value,'$.failure.code') AS failureCode,json_extract(value,'$.integration.origin.id') AS integrationId FROM runs WHERE id=?",
        )
        .get(message.runId) as {
        retryOf: string | null;
        integrationId: string | null;
        failureCode: ChatMessage["failureCode"];
      };
      if (row.retryOf) message.retryOf = row.retryOf;
      if (row.failureCode) message.failureCode = row.failureCode;
      if (row.integrationId) message.integrationId = row.integrationId;
    }
    return { conversation, messages, hasEarlier };
  }
  rename(id: string, title: string): Conversation {
    this.find(id);
    this.db
      .prepare("UPDATE conversations SET title=?,updated_at=? WHERE id=?")
      .run(title, new Date().toISOString(), id);
    return this.find(id);
  }
  draft(id: string, draft: string): void {
    this.find(id);
    this.db
      .prepare("UPDATE conversations SET draft=? WHERE id=?")
      .run(draft, id);
  }
  attach(run: Run): void {
    const conversation = run.conversationId
      ? this.find(run.conversationId)
      : this.insert(run.projectId, titleFor(run.prompt), run.createdAt);
    if (conversation.projectId !== run.projectId)
      throw new Error("Cuộc trò chuyện thuộc dự án khác.");
    run.conversationId = conversation.id;
    this.db
      .prepare(
        "UPDATE conversations SET title=?,draft=?,updated_at=? WHERE id=?",
      )
      .run(
        conversation.title === "Cuộc trò chuyện mới"
          ? titleFor(run.prompt)
          : conversation.title,
        conversation.draft.trim() === run.prompt.trim()
          ? ""
          : conversation.draft,
        run.createdAt,
        conversation.id,
      );
  }
  messagesFor(run: Run): void {
    if (!run.conversationId) return;
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO messages (id,conversation_id,role,content,run_id,state,created_at) VALUES (?,?,?,?,?,?,?)",
    );
    insert.run(
      randomUUID(),
      run.conversationId,
      "user",
      run.prompt,
      run.id,
      run.state,
      run.createdAt,
    );
    insert.run(
      randomUUID(),
      run.conversationId,
      "assistant",
      assistantContent(run),
      run.id,
      run.state,
      run.createdAt,
    );
    this.sync(run);
  }
  sync(run: Run): void {
    if (!run.conversationId) return;
    this.db
      .prepare(
        "UPDATE messages SET state=?,content=? WHERE run_id=? AND role='assistant'",
      )
      .run(run.state, assistantContent(run), run.id);
    this.db
      .prepare("UPDATE messages SET state=? WHERE run_id=? AND role='user'")
      .run(run.state, run.id);
    if (!isActive(run.state))
      this.db
        .prepare("UPDATE conversations SET updated_at=? WHERE id=?")
        .run(run.endedAt ?? run.createdAt, run.conversationId);
  }
  context(id: string, projectId: string): ConversationContext {
    const detail = this.get(id);
    if (detail.conversation.projectId !== projectId)
      throw new Error("Cuộc trò chuyện thuộc dự án khác.");
    const messages = detail.messages.slice(-8);
    const runIds = [...new Set(messages.map((m) => m.runId))];
    const text = messages
      .map(
        (m) =>
          `${m.role.toUpperCase()} [${m.runId}, ${m.state}]: ${m.content.slice(0, m.role === "user" ? 2000 : 3500)}`,
      )
      .join("\n\n")
      .slice(-14000);
    const refs = runIds
      .map((runId) => {
        const row = this.db
          .prepare("SELECT value FROM runs WHERE id=?")
          .get(runId) as { value: string } | undefined;
        if (!row) return "";
        const run = JSON.parse(row.value) as Run;
        return JSON.stringify({
          runId,
          retryOf: run.retryOf,
          files: run.changes.slice(0, 20),
          commands: run.commands.slice(-8).map((c) => ({
            id: c.callId,
            command: c.command.slice(0, 300),
            status: c.status,
            exitCode: c.exitCode,
          })),
          tasks: (run.tasks ?? []).slice(-8).map((t) => ({
            id: t.id,
            state: t.state,
            acceptance: t.acceptance,
          })),
        });
      })
      .join("\n")
      .slice(0, 6000);
    return {
      runIds,
      text: text
        ? `Ngữ cảnh các lượt trước (chỉ tham khảo; không tự chạy lại lệnh, kiểm tra source hiện tại):\n${text.slice(-8000)}\nTham chiếu evidence:\n${refs}`
        : "",
    };
  }
}
