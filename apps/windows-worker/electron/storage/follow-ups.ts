import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { FollowUp } from "../../shared/chat";
import { BoardStore } from "./board";

export class FollowUps {
  constructor(
    private db: Database.Database,
    directory: string,
    originalVersion: number,
  ) {
    if ((db.pragma("user_version", { simple: true }) as number) >= 5) return;
    const backup = join(directory, "worker.schema4.backup.sqlite");
    if (originalVersion === 4 && !existsSync(backup))
      db.prepare("VACUUM INTO ?").run(backup);
    db.transaction(() => {
      db.exec(
        `CREATE TABLE follow_ups (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, conversation_id TEXT NOT NULL REFERENCES conversations(id), value TEXT NOT NULL); PRAGMA user_version=5;`,
      );
    })();
  }
  list(conversationId?: string): FollowUp[] {
    return (
      this.db
        .prepare(
          "SELECT value,(SELECT item_id FROM work_submissions WHERE follow_up_id=follow_ups.id) AS boardItemId,EXISTS(SELECT 1 FROM chat_requests WHERE follow_up_id=follow_ups.id) AS immutable FROM follow_ups WHERE (? IS NULL OR conversation_id=?) ORDER BY sequence",
        )
        .all(conversationId ?? null, conversationId ?? null) as {
        value: string;
        boardItemId: string | null;
        immutable: number;
      }[]
    ).map((row) => ({
      ...JSON.parse(row.value),
      boardItemId: row.boardItemId ?? undefined,
      immutable: !!row.immutable,
    }));
  }
  get(id: string): FollowUp {
    const row = this.db
      .prepare(
        "SELECT value,(SELECT item_id FROM work_submissions WHERE follow_up_id=follow_ups.id) AS boardItemId,EXISTS(SELECT 1 FROM chat_requests WHERE follow_up_id=follow_ups.id) AS immutable FROM follow_ups WHERE id=?",
      )
      .get(id) as
      | { value: string; boardItemId: string | null; immutable: number }
      | undefined;
    if (!row) throw new Error("Yêu cầu không còn trong hàng chờ.");
    return {
      ...JSON.parse(row.value),
      boardItemId: row.boardItemId ?? undefined,
      immutable: !!row.immutable,
    };
  }
  add(input: Omit<FollowUp, "id" | "createdAt">): FollowUp {
    if (this.list().length >= 50) throw new Error("Hàng chờ đã đủ 50 yêu cầu.");
    const item = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        "INSERT INTO follow_ups (id,conversation_id,value) VALUES (?,?,?)",
      )
      .run(item.id, item.conversationId, JSON.stringify(item));
    return item;
  }
  save(item: FollowUp): void {
    this.db
      .prepare("UPDATE follow_ups SET value=? WHERE id=?")
      .run(JSON.stringify(item), item.id);
  }
  edit(id: string, prompt: string): void {
    new BoardStore(this.db).assertQueueEditable(id);
    if (
      this.db
        .prepare("SELECT request_id FROM chat_requests WHERE follow_up_id=?")
        .get(id)
    )
      throw new Error(
        "Tin nhắn đã lưu. Bỏ khỏi hàng chờ rồi gửi nội dung mới.",
      );
    const item = this.get(id);
    item.prompt = prompt;
    this.save(item);
  }
  remove(id: string): void {
    this.get(id);
    this.db.transaction(() => {
      new BoardStore(this.db).releaseQueue(id);
      this.db
        .prepare(
          "UPDATE chat_requests SET follow_up_id=NULL,state='removed' WHERE follow_up_id=?",
        )
        .run(id);
      this.db.prepare("DELETE FROM follow_ups WHERE id=?").run(id);
    })();
  }
  hold(reason: string, afterRunId?: string): void {
    for (const item of this.list())
      if (
        item.state === "waiting" &&
        (!afterRunId || item.afterRunId === afterRunId)
      )
        this.save({ ...item, state: "held", reason });
  }
  claim<T>(id: string, start: (item: FollowUp) => { id: string; value: T }): T {
    return this.db.transaction(() => {
      const item = this.get(id);
      const result = start(item);
      new BoardStore(this.db).claimQueue(id, result.id);
      this.db
        .prepare(
          "UPDATE chat_requests SET run_id=?,follow_up_id=NULL,state='running' WHERE follow_up_id=?",
        )
        .run(result.id, id);
      this.remove(id);
      for (const next of this.list())
        if (next.state === "waiting" && next.afterRunId === item.afterRunId)
          this.save({ ...next, afterRunId: result.id });
      return result.value;
    })();
  }
}
