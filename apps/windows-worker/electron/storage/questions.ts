import type Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  answerQuestionsSchema,
  questionDecisionSchema,
  questionRefSchema,
  validateAnswers,
  type AnswerQuestions,
  type QuestionAnswer,
  type QuestionSet,
} from "../../shared/questions";
import type { Run } from "../../shared/runs";
import type { ChatReceipt } from "../../shared/chat";

export class Questions {
  constructor(
    private db: Database.Database,
    directory: string,
    original: number,
  ) {
    if ((db.pragma("user_version", { simple: true }) as number) >= 10) return;
    const backup = join(
      directory,
      "worker.schema9.pre-questions.backup.sqlite",
    );
    if (original === 9 && !existsSync(backup))
      db.prepare("VACUUM INTO ?").run(backup);
    db.transaction(() =>
      db.exec(`CREATE TABLE question_sets (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, conversation_id TEXT NOT NULL REFERENCES conversations(id),
      source_run_id TEXT NOT NULL UNIQUE REFERENCES runs(id), work_item_id TEXT REFERENCES board_items(id),
      revision INTEGER, state TEXT NOT NULL, version INTEGER NOT NULL, value TEXT NOT NULL,
      answers TEXT NOT NULL DEFAULT '[]', fingerprint TEXT, created_at TEXT NOT NULL);
      CREATE INDEX questions_conversation ON question_sets(conversation_id,created_at);
      CREATE INDEX questions_project ON question_sets(project_id,state);
      PRAGMA user_version=10;`),
    )();
  }
  supersede(conversationId: string) {
    this.db
      .prepare(
        "UPDATE question_sets SET state='superseded',version=version+1 WHERE conversation_id=? AND state='pending'",
      )
      .run(conversationId);
  }
  publish(run: Run) {
    if (
      !run.questionRequest ||
      run.state !== "needs_input" ||
      !run.endedAt ||
      !run.conversationId ||
      run.failure?.code !== "needs-context"
    )
      return;
    if (
      this.db
        .prepare("SELECT id FROM question_sets WHERE source_run_id=?")
        .get(run.id)
    )
      return;
    const decision = questionDecisionSchema.parse(run.questionRequest);
    const linked = this.db
      .prepare(
        "SELECT s.item_id AS itemId,s.revision FROM work_attempts a JOIN work_submissions s ON s.id=a.submission_id WHERE a.run_id=?",
      )
      .get(run.id) as { itemId: string; revision: number } | undefined;
    this.supersede(run.conversationId);
    this.db
      .prepare(
        "INSERT INTO question_sets(id,project_id,conversation_id,source_run_id,work_item_id,revision,state,version,value,created_at) VALUES (?,?,?,?,?,?,'pending',1,?,?)",
      )
      .run(
        randomUUID(),
        run.projectId,
        run.conversationId,
        run.id,
        run.workContext?.itemId ?? linked?.itemId ?? null,
        run.workContext?.revision ?? linked?.revision ?? null,
        JSON.stringify(decision),
        run.endedAt,
      );
  }
  private invalidate(conversationId?: string, projectId?: string) {
    this.db
      .prepare(
        `UPDATE question_sets SET state='superseded',version=version+1 WHERE state='pending'
      AND (? IS NULL OR conversation_id=?) AND (? IS NULL OR project_id=?) AND (
      NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=project_id) OR
      EXISTS(SELECT 1 FROM runs r WHERE r.id=source_run_id AND r.state!='needs_input') OR
      (work_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM board_items b WHERE b.id=work_item_id AND b.revision=question_sets.revision AND b.archived_at IS NULL))
    )`,
      )
      .run(
        conversationId ?? null,
        conversationId ?? null,
        projectId ?? null,
        projectId ?? null,
      );
  }
  private decode(row: Record<string, unknown>): QuestionSet {
    const receipt = this.db
      .prepare(
        "SELECT request_id AS requestId,run_id AS runId,follow_up_id AS followUpId,state FROM chat_requests WHERE request_id=?",
      )
      .get(row.id) as ChatReceipt | undefined;
    return {
      ...JSON.parse(row.value as string),
      id: row.id as string,
      projectId: row.project_id as string,
      conversationId: row.conversation_id as string,
      sourceRunId: row.source_run_id as string,
      workItemId: row.work_item_id as string | null,
      revision: row.revision as number | null,
      state: row.state as QuestionSet["state"],
      recordVersion: row.version as number,
      answers: JSON.parse(row.answers as string),
      createdAt: row.created_at as string,
      receipt,
    };
  }
  get(input: zRef): QuestionSet {
    const ref = questionRefSchema.parse({
      projectId: input.projectId,
      conversationId: input.conversationId,
      setId: input.setId,
    });
    this.invalidate(ref.conversationId);
    const row = this.db
      .prepare(
        "SELECT * FROM question_sets WHERE id=? AND project_id=? AND conversation_id=?",
      )
      .get(ref.setId, ref.projectId, ref.conversationId) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new Error("Bộ câu hỏi không thuộc hội thoại/dự án.");
    return this.decode(row);
  }
  list(conversationId: string): QuestionSet[] {
    this.invalidate(conversationId);
    return (
      this.db
        .prepare(
          "SELECT * FROM question_sets WHERE conversation_id=? ORDER BY created_at DESC,rowid DESC LIMIT 20",
        )
        .all(conversationId) as Record<string, unknown>[]
    )
      .map((r) => this.decode(r))
      .reverse();
  }
  pending(projectId: string) {
    this.invalidate(undefined, projectId);
    return this.db
      .prepare(
        "SELECT id,source_run_id AS runId,conversation_id AS conversationId,json_extract(value,'$.summary') AS summary,created_at AS createdAt FROM question_sets WHERE project_id=? AND state='pending' ORDER BY created_at DESC LIMIT 50",
      )
      .all(projectId) as {
      id: string;
      runId: string;
      conversationId: string;
      summary: string;
      createdAt: string;
    }[];
  }
  stateForRun(id: string): QuestionSet["state"] | undefined {
    return (
      this.db
        .prepare("SELECT state FROM question_sets WHERE source_run_id=?")
        .get(id) as { state: QuestionSet["state"] } | undefined
    )?.state;
  }
  forRun(id: string): QuestionSet | null {
    const row = this.db
      .prepare(
        "SELECT id AS setId,project_id AS projectId,conversation_id AS conversationId FROM question_sets WHERE source_run_id=?",
      )
      .get(id) as zRef | undefined;
    return row ? this.get(row) : null;
  }
  hasProject(id: string): boolean {
    return !!this.db
      .prepare("SELECT 1 FROM question_sets WHERE project_id=? LIMIT 1")
      .get(id);
  }
  private editable(data: AnswerQuestions): QuestionSet {
    const set = this.get(data);
    if (set.state !== "pending")
      throw new Error("Bộ câu hỏi đã trả lời hoặc được thay thế.");
    if (set.recordVersion !== data.version)
      throw new Error(
        "Câu trả lời đã thay đổi. Tải lại để đối chiếu; nháp hiện tại được giữ.",
      );
    return set;
  }
  draft(input: AnswerQuestions): QuestionSet {
    const data = answerQuestionsSchema.parse(input);
    return this.db.transaction(() => {
      const set = this.editable(data),
        answers = validateAnswers(set, data.answers, false);
      this.db
        .prepare(
          "UPDATE question_sets SET answers=?,version=version+1 WHERE id=?",
        )
        .run(JSON.stringify(answers), set.id);
      return this.get(data);
    })();
  }
  submit(
    input: AnswerQuestions,
    launch: (set: QuestionSet, answers: QuestionAnswer[]) => ChatReceipt,
  ): QuestionSet {
    const data = answerQuestionsSchema.parse(input);
    return this.db.transaction(() => {
      const set = this.get(data),
        answers = validateAnswers(set, data.answers, true),
        fingerprint = JSON.stringify(answers);
      if (set.state === "answered") {
        const prior = this.db
          .prepare("SELECT fingerprint FROM question_sets WHERE id=?")
          .get(set.id) as { fingerprint: string };
        if (prior.fingerprint !== fingerprint)
          throw new Error("Bộ câu hỏi đã nhận câu trả lời khác.");
        return set;
      }
      this.editable(data);
      launch(set, answers);
      this.db
        .prepare(
          "UPDATE question_sets SET state='answered',answers=?,fingerprint=?,version=version+1 WHERE id=?",
        )
        .run(fingerprint, fingerprint, set.id);
      return this.get(data);
    })();
  }
  protectedRunIds(): string[] {
    return (
      this.db
        .prepare(
          "SELECT source_run_id AS id FROM question_sets UNION SELECT c.run_id AS id FROM question_sets q JOIN chat_requests c ON c.request_id=q.id WHERE c.run_id IS NOT NULL",
        )
        .all() as { id: string }[]
    ).map((r) => r.id);
  }
}
type zRef = { projectId: string; conversationId: string; setId: string };
