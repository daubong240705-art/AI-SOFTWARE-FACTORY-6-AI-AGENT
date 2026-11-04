import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { Conversations } from "./conversations";
import { FollowUps } from "./follow-ups";
import { BoardStore } from "./board";
import { migrateWorkItems } from "./work-migration";
import { migrateChatRequests } from "./chat-requests";
import { Questions } from "./questions";
import { Reports } from "./reports";
import {
  chatSendSchema,
  type ChatSend,
  type ChatReceipt,
  type WorkChatSnapshot,
} from "../../shared/chat";
import type { BoardRun } from "../../shared/board";
import { EvidenceStore } from "./evidence";
import { failure } from "../runtime/failure";
import { redact } from "../runtime/security";
import { monitorEventSchema, type MonitorEvent } from "../../shared/monitor";
import { isActive } from "../../shared/runs";
import { milestoneEventTypes } from "../../shared/inspector";
import type { RetentionPreview } from "../../shared/lifecycle";
import { normalizeRun, type Run, type RunEvent } from "../../shared/runs";
import {
  defaultSettings,
  settingsSchema,
  type Settings,
  type Project,
} from "../../shared/contracts";

export class Store {
  private db: Database.Database;
  readonly conversations: Conversations;
  readonly queue: FollowUps;
  readonly evidence: EvidenceStore;
  readonly board: BoardStore;
  readonly questions: Questions;
  readonly reports: Reports;
  private retentionTickets = new Map<
    string,
    { ids: string[]; expires: number }
  >();
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new Database(join(directory, "worker.sqlite"));
    try {
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("foreign_keys = ON");
      const version = this.db.pragma("user_version", {
        simple: true,
      }) as number;
      if (version > 11)
        throw new Error(
          "Dữ liệu được tạo bởi bản mới hơn. Hãy cập nhật ứng dụng.",
        );
      if (!version)
        this.db.transaction(() => {
          this.db.exec(`
        CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL);
        CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL,
          path_key TEXT NOT NULL UNIQUE, lastOpenedAt TEXT NOT NULL, draft TEXT NOT NULL DEFAULT '');
        CREATE TABLE catalog (id INTEGER PRIMARY KEY CHECK(id = 1), models TEXT NOT NULL);
        CREATE TABLE credentials (id INTEGER PRIMARY KEY CHECK(id = 1), encrypted BLOB NOT NULL);
        PRAGMA user_version = 1;
      `);
          this.db
            .prepare("INSERT INTO settings VALUES (1, ?)")
            .run(JSON.stringify(defaultSettings()));
        })();
      if (version < 2) {
        if (version === 1) {
          const backup = join(directory, "worker.schema1.backup.sqlite");
          if (!existsSync(backup)) this.db.prepare("VACUUM INTO ?").run(backup);
        }
        this.db.transaction(() => {
          this.db.exec(`
          CREATE TABLE runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, value TEXT NOT NULL);
          CREATE UNIQUE INDEX one_active_run ON runs ((1)) WHERE state IN ('queued','running','blocked','cancelling');
          CREATE TABLE tasks (id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES runs(id), role TEXT NOT NULL, state TEXT NOT NULL, instructions TEXT NOT NULL);
          CREATE TABLE events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id), type TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL);
          CREATE INDEX run_events ON events(run_id, sequence);
          PRAGMA user_version = 2;
        `);
        })();
      }
      if (version < 3) {
        if (version === 2) {
          const backup = join(directory, "worker.schema2.backup.sqlite");
          if (!existsSync(backup)) this.db.prepare("VACUUM INTO ?").run(backup);
        }
        this.db.transaction(() => {
          this.db.exec(`
          ALTER TABLE tasks RENAME TO tasks_v2;
          CREATE TABLE tasks (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), role TEXT NOT NULL, state TEXT NOT NULL, instructions TEXT NOT NULL, value TEXT);
          INSERT INTO tasks (id,run_id,role,state,instructions) SELECT id,run_id,role,state,instructions FROM tasks_v2;
          DROP TABLE tasks_v2;
          CREATE INDEX tasks_run ON tasks(run_id);
          PRAGMA user_version = 3;
        `);
        })();
      }
      this.conversations = new Conversations(this.db, directory, version);
      this.queue = new FollowUps(this.db, directory, version);
      this.evidence = new EvidenceStore(this.db, directory, version);
      if (version < 7) {
        const backup = join(
          directory,
          "worker.schema6.pre-monitor.backup.sqlite",
        );
        if (version === 6 && !existsSync(backup))
          this.db.prepare("VACUUM INTO ?").run(backup);
        this.db.transaction(() => {
          const columns = this.db.pragma("table_info(events)") as {
            name: string;
          }[];
          if (!columns.some((column) => column.name === "metadata"))
            this.db.exec("ALTER TABLE events ADD COLUMN metadata TEXT");
          this.db.exec(`
            CREATE TABLE IF NOT EXISTS board_items (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
              title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', suggested_role TEXT,
              priority INTEGER NOT NULL DEFAULT 0, planning_state TEXT NOT NULL DEFAULT 'backlog',
              position REAL NOT NULL DEFAULT 0, archived_at TEXT, version INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS board_links (
              item_id TEXT PRIMARY KEY REFERENCES board_items(id), run_id TEXT REFERENCES runs(id),
              follow_up_id TEXT, logical_task_key TEXT, created_at TEXT NOT NULL
            );
            PRAGMA user_version=7;
          `);
        })();
      }
      migrateWorkItems(this.db, directory, version);
      migrateChatRequests(this.db, directory, version);
      this.questions = new Questions(this.db, directory, version);
      this.board = new BoardStore(this.db);
      this.reports = new Reports(
        this.db,
        directory,
        version,
        this.evidence,
        this.board,
        (id) => this.run(id),
      );
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  settings(): Settings {
    return settingsSchema.parse(
      JSON.parse(
        (
          this.db.prepare("SELECT value FROM settings WHERE id=1").get() as {
            value: string;
          }
        ).value,
      ),
    );
  }
  sendChat(
    input: ChatSend,
    launch: (snapshot?: WorkChatSnapshot) => {
      runId: string | null;
      followUpId: string | null;
    },
  ): ChatReceipt {
    const data = chatSendSchema.parse(input),
      fingerprint = JSON.stringify(data);
    return this.db.transaction(() => {
      const prior = this.db
        .prepare(
          "SELECT fingerprint,run_id AS runId,follow_up_id AS followUpId,state FROM chat_requests WHERE request_id=?",
        )
        .get(data.requestId) as
        | (Omit<ChatReceipt, "requestId"> & { fingerprint: string })
        | undefined;
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new Error("Mã gửi đã được dùng cho nội dung khác.");
        return {
          requestId: data.requestId,
          runId: prior.runId,
          followUpId: prior.followUpId,
          state: prior.state,
        };
      }
      this.project(data.projectId);
      this.conversations.context(data.conversationId, data.projectId);
      const snapshot = data.workContext
        ? this.board.chatSnapshot(
            data.projectId,
            data.workContext.itemId,
            data.workContext.revision,
            data.conversationId,
          )
        : undefined;
      const result = launch(snapshot),
        state: ChatReceipt["state"] = result.followUpId ? "queued" : "running";
      if (snapshot) this.board.attachChat(data.requestId, snapshot, result);
      this.db
        .prepare("INSERT INTO chat_requests VALUES (?,?,?,?,?,?,?,?,?)")
        .run(
          data.requestId,
          fingerprint,
          data.projectId,
          data.conversationId,
          result.runId,
          result.followUpId,
          state,
          new Date().toISOString(),
          snapshot?.itemId ?? null,
        );
      return { requestId: data.requestId, ...result, state };
    })();
  }
  projects(): Project[] {
    return this.db
      .prepare(
        "SELECT id,name,path,lastOpenedAt,draft FROM projects ORDER BY lastOpenedAt DESC",
      )
      .all() as Project[];
  }
  workspaceReferenced(path: string): boolean {
    const matches = (value: string) => {
      const a =
        process.platform === "win32"
          ? resolve(value).toLowerCase()
          : resolve(value);
      const b =
        process.platform === "win32"
          ? resolve(path).toLowerCase()
          : resolve(path);
      return (
        a === b || a.startsWith(b + (process.platform === "win32" ? "\\" : "/"))
      );
    };
    if (this.projects().some((project) => matches(project.path))) return true;
    return (
      this.db.prepare("SELECT value FROM runs").all() as { value: string }[]
    ).some((row) => {
      const run = JSON.parse(row.value) as Run;
      return (
        matches(run.workspace) ||
        (run.integration && matches(run.integration.workspace)) ||
        run.tasks?.some((task) => task.workspace && matches(task.workspace))
      );
    });
  }
  project(id: string): Project {
    const project = this.db
      .prepare(
        "SELECT id,name,path,lastOpenedAt,draft FROM projects WHERE id=?",
      )
      .get(id) as Project | undefined;
    if (!project) throw new Error("Không tìm thấy dự án.");
    return project;
  }
  addProject(path: string): Project {
    const pathKey = process.platform === "win32" ? path.toLowerCase() : path;
    this.db
      .prepare(
        `INSERT INTO projects (id,name,path,path_key,lastOpenedAt) VALUES (?,?,?,?,?)
      ON CONFLICT(path_key) DO UPDATE SET lastOpenedAt=excluded.lastOpenedAt`,
      )
      .run(
        randomUUID(),
        basename(path) || path,
        path,
        pathKey,
        new Date().toISOString(),
      );
    const row = this.db
      .prepare("SELECT id FROM projects WHERE path_key=?")
      .get(pathKey) as { id: string };
    return this.project(row.id);
  }
  touch(id: string): Project {
    this.db
      .prepare("UPDATE projects SET lastOpenedAt=? WHERE id=?")
      .run(new Date().toISOString(), id);
    return this.project(id);
  }
  removeProject(id: string): void {
    if (this.questions.hasProject(id))
      throw new Error("Giữ dự án có lịch sử câu hỏi; chưa hỗ trợ xóa hẳn.");
    const active = this.runs().find(
      (run) =>
        run.projectId === id &&
        ["queued", "running", "blocked", "cancelling"].includes(run.state),
    );
    if (active)
      throw new Error("Dừng tác vụ trước khi bỏ dự án khỏi danh sách.");
    if (
      this.db
        .prepare("SELECT id FROM board_items WHERE project_id=? LIMIT 1")
        .get(id)
    )
      throw new Error(
        "Dự án có thẻ Kanban. Giữ dự án trong danh sách để bảo toàn backlog và liên kết.",
      );
    if (this.reports.hasProject(id))
      throw new Error("Giữ dự án có báo cáo đã lưu để bảo toàn bằng chứng.");
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM work_counters WHERE project_id=?").run(id);
      this.db.prepare("DELETE FROM projects WHERE id=?").run(id);
    })();
  }
  saveDraft(id: string, draft: string): void {
    this.project(id);
    this.db.prepare("UPDATE projects SET draft=? WHERE id=?").run(draft, id);
  }
  models(): string[] {
    const row = this.db
      .prepare("SELECT models FROM catalog WHERE id=1")
      .get() as { models: string } | undefined;
    return row ? JSON.parse(row.models) : [];
  }
  setModels(models: string[]): void {
    this.db
      .prepare("INSERT OR REPLACE INTO catalog VALUES (1,?)")
      .run(JSON.stringify(models));
  }
  encryptedKey(): Buffer | undefined {
    return (
      this.db.prepare("SELECT encrypted FROM credentials WHERE id=1").get() as
        | { encrypted: Buffer }
        | undefined
    )?.encrypted;
  }
  save(settings: Settings, encryptedKey: Buffer | null | undefined): void {
    this.db.transaction(() => {
      const before = this.settings();
      this.db
        .prepare("UPDATE settings SET value=? WHERE id=1")
        .run(JSON.stringify(settings));
      if (encryptedKey === null)
        this.db.prepare("DELETE FROM credentials").run();
      else if (encryptedKey !== undefined)
        this.db
          .prepare("INSERT OR REPLACE INTO credentials VALUES (1,?)")
          .run(encryptedKey);
      if (
        before.gatewayUrl !== settings.gatewayUrl ||
        before.caPath !== settings.caPath ||
        encryptedKey !== undefined
      )
        this.db.prepare("DELETE FROM catalog").run();
    })();
  }
  close(): void {
    this.db.close();
  }
  createRun(run: Run): void {
    this.db.transaction(() => {
      this.conversations.attach(run);
      this.questions.supersede(run.conversationId!);
      this.db
        .prepare("INSERT INTO runs VALUES (?,?,?,?,?)")
        .run(
          run.id,
          run.projectId,
          run.state,
          run.createdAt,
          JSON.stringify(run),
        );
      this.db
        .prepare(
          "INSERT INTO tasks (id,run_id,role,state,instructions) VALUES (?,?,?,?,?)",
        )
        .run(randomUUID(), run.id, run.role, run.state, run.prompt);
      this.conversations.messagesFor(run);
      if (run.retryOf) this.board.retargetRun(run.retryOf, run.id);
      this.event(run.id, "RUN_QUEUED", "Đã nhận yêu cầu.");
    })();
  }
  run(id: string): Run {
    const row = this.db.prepare("SELECT value FROM runs WHERE id=?").get(id) as
      | { value: string }
      | undefined;
    if (!row) throw new Error("Không tìm thấy lượt chạy.");
    return normalizeRun(JSON.parse(row.value));
  }
  latestProjectRun(projectId: string): Run | null {
    const row = this.db
      .prepare(
        "SELECT value FROM runs WHERE project_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
      )
      .get(projectId) as { value: string } | undefined;
    return row ? normalizeRun(JSON.parse(row.value)) : null;
  }
  recentProjectRuns(projectId: string): Run[] {
    const rows = this.db
      .prepare(
        `WITH ranked AS (
      SELECT value,created_at,rowid AS ordering,
        ROW_NUMBER() OVER (PARTITION BY COALESCE(json_extract(value,'$.attemptRoot'),id)
          ORDER BY created_at DESC,rowid DESC) AS rn FROM runs WHERE project_id=?
      ) SELECT value FROM ranked WHERE rn=1 ORDER BY created_at DESC,ordering DESC LIMIT 12`,
      )
      .all(projectId) as { value: string }[];
    return rows.map((row) => normalizeRun(JSON.parse(row.value)));
  }
  *boardRuns(projectId: string): Iterable<BoardRun> {
    const rows = this.db
      .prepare(
        `WITH ranked AS (
      SELECT id,value,created_at,COALESCE(json_extract(value,'$.attemptRoot'),id) AS root,
      ROW_NUMBER() OVER (PARTITION BY COALESCE(json_extract(value,'$.attemptRoot'),id) ORDER BY created_at DESC,rowid DESC) AS rn
      FROM runs WHERE project_id=?
    ) SELECT id,root AS rootId,json_extract(value,'$.conversationId') AS conversationId,json_extract(value,'$.state') AS state,
      json_extract(value,'$.mode') AS mode,json_extract(value,'$.prompt') AS prompt,
      json_extract(value,'$.model') AS model,json_extract(value,'$.role') AS role,created_at AS createdAt,
      json_extract(value,'$.endedAt') AS endedAt,json_extract(value,'$.integration.state') AS integrationState,
      (json_extract(value,'$.state')='completed' AND json_extract(value,'$.review.version')=2
       AND json_extract(value,'$.review.status')='completed' AND json_extract(value,'$.review.verification.verified')=1
       AND NOT EXISTS(SELECT 1 FROM json_each(ranked.value,'$.review.acceptance') a WHERE json_extract(a.value,'$.status') IS NOT 'passed')
       AND NOT EXISTS(SELECT 1 FROM json_each(ranked.value,'$.review.fixes')) ) AS reviewVerified,
      (SELECT json_group_array(json_object('id',json_extract(t.value,'$.id'),'originalTaskId',json_extract(t.value,'$.originalTaskId'),
        'role',json_extract(t.value,'$.role'),'title',json_extract(t.value,'$.title'),'state',json_extract(t.value,'$.state'),
        'kind',json_extract(t.value,'$.kind'),'model',json_extract(t.value,'$.model'),'dependsOn',json_extract(t.value,'$.dependsOn'),
        'acceptanceCount',json_array_length(t.value,'$.acceptance'),'workType',json_extract(t.value,'$.workType')))
       FROM json_each(ranked.value,'$.tasks') t) AS tasks,
      COALESCE(json_array_length(value,'$.changes'),0) AS changes,json_extract(value,'$.error') AS error
      FROM ranked
      WHERE rn=1 ORDER BY created_at DESC,id DESC`,
      )
      .iterate(projectId);
    for (const row of rows as Iterable<Record<string, unknown>>)
      yield {
        ...row,
        state: row.state as string,
        reviewVerified: !!row.reviewVerified,
        tasks: JSON.parse(row.tasks as string),
      } as BoardRun;
  }
  runs(): Run[] {
    return (
      this.db
        .prepare("SELECT value FROM runs ORDER BY created_at DESC LIMIT 50")
        .all() as { value: string }[]
    ).map((row) => normalizeRun(JSON.parse(row.value)));
  }
  updateRun(
    run: Run,
    event?: { type: string; text: string; metadata?: MonitorEvent },
  ): void {
    this.db.transaction(() => {
      this.db
        .prepare("UPDATE runs SET state=?,value=? WHERE id=?")
        .run(run.state, JSON.stringify(run), run.id);
      if (run.mode === "team") {
        this.db
          .prepare("DELETE FROM tasks WHERE run_id=? AND value IS NULL")
          .run(run.id);
        const upsert = this.db.prepare(
          "INSERT INTO tasks VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,value=excluded.value",
        );
        for (const task of run.tasks)
          upsert.run(
            `${run.id}:${task.id}`,
            run.id,
            task.role,
            task.state,
            task.instructions,
            JSON.stringify(task),
          );
      } else
        this.db
          .prepare("UPDATE tasks SET state=? WHERE run_id=?")
          .run(run.state, run.id);
      this.conversations.sync(run);
      this.questions.publish(run);
      if (!isActive(run.state) && run.endedAt)
        this.reports.capture({ projectId: run.projectId, runId: run.id });
      if (event) this.event(run.id, event.type, event.text, event.metadata);
    })();
  }
  event(
    runId: string,
    type: string,
    text: string,
    metadata?: MonitorEvent,
  ): void {
    const count = (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM events WHERE run_id=?")
        .get(runId) as { n: number }
    ).n;
    if (count >= 2000) return;
    this.db
      .prepare(
        "INSERT INTO events (run_id,type,text,at,metadata) VALUES (?,?,?,?,?)",
      )
      .run(
        runId,
        type,
        text.slice(0, 12000),
        new Date().toISOString(),
        metadata ? JSON.stringify(monitorEventSchema.parse(metadata)) : null,
      );
  }
  events(id: string, milestonesOnly = false): RunEvent[] {
    const filter = milestonesOnly
      ? ` AND (type GLOB 'RUN_*' OR type IN (${milestoneEventTypes.map(() => "?").join(",")}))`
      : "";
    const rows = this.db
      .prepare(
        `SELECT sequence,run_id AS runId,type,text,at,metadata FROM (SELECT * FROM events WHERE run_id=?${filter} ORDER BY sequence DESC LIMIT ${milestonesOnly ? 30 : 300}) ORDER BY sequence`,
      )
      .all(id, ...(milestonesOnly ? milestoneEventTypes : [])) as (Omit<
      RunEvent,
      "metadata"
    > & { metadata: string | null })[];
    return rows.map(({ metadata, ...event }) => ({
      ...event,
      ...(metadata
        ? { metadata: monitorEventSchema.parse(JSON.parse(metadata)) }
        : {}),
    }));
  }
  interruptRuns(): void {
    const rows = this.db
      .prepare(
        "SELECT value FROM runs WHERE state IN ('queued','running','blocked','cancelling')",
      )
      .all() as { value: string }[];
    for (const run of rows.map((row) => normalizeRun(JSON.parse(row.value))))
      if (["queued", "running", "blocked", "cancelling"].includes(run.state)) {
        this.updateRun(
          {
            ...run,
            state: "interrupted",
            failure: run.metrics
              ? failure(
                  "interrupted",
                  "Ứng dụng kết thúc ngoài dự kiến. Kiểm tra workspace trước khi thử lại có chủ đích.",
                )
              : run.failure,
            metrics: run.metrics
              ? { ...run.metrics, durationMs: null }
              : undefined,
            currentTaskId: null,
            tasks: run.tasks.map((task) => ({
              ...task,
              failure:
                task.metrics && ["running", "blocked"].includes(task.state)
                  ? failure(
                      "interrupted",
                      "Task bị gián đoạn; không tự chạy lại.",
                    )
                  : task.failure,
              metrics:
                task.metrics && ["running", "blocked"].includes(task.state)
                  ? { ...task.metrics, durationMs: null }
                  : task.metrics,
              state:
                task.state === "queued"
                  ? "skipped"
                  : ["running", "blocked"].includes(task.state)
                    ? "failed"
                    : task.state,
              endedAt: task.endedAt ?? new Date().toISOString(),
            })),
            permissions: [],
            endedAt: new Date().toISOString(),
            error: "Ứng dụng kết thúc ngoài dự kiến. Không tự chạy lại task.",
          },
          {
            type: "RUN_INTERRUPTED",
            text: "Lượt chạy bị gián đoạn; cần kiểm tra workspace trước khi thử lại.",
          },
        );
      }
  }
  report(id: string, secrets: string[] = []): string {
    const run = this.run(id);
    const events = this.db
      .prepare(
        "SELECT sequence,type,text,at FROM events WHERE run_id=? ORDER BY sequence",
      )
      .all(id);
    return JSON.stringify(
      {
        version: 1,
        result:
          !isActive(run.state) && run.endedAt
            ? this.reports.export(
                { projectId: run.projectId, runId: run.id },
                secrets,
              )
            : null,
        boardLinks: this.board.links().filter((link) => link.runId === id),
        workItem: this.board.runReference(id),
        workContext: run.workContext,
        questionSets: [this.questions.forRun(run.id)].filter(Boolean),
        exportedAt: new Date().toISOString(),
        run: {
          id: run.id,
          project: run.projectName,
          prompt: run.prompt,
          state: run.state,
          role: run.role,
          model: run.model,
          runtimeVersion: run.runtimeVersion,
          createdAt: run.createdAt,
          startedAt: run.startedAt,
          endedAt: run.endedAt,
          summary: run.summary,
          error: run.error,
          failure: run.failure,
          metrics: run.metrics,
          retryOf: run.retryOf,
          recoveryOf: run.recoveryOf,
          workspaceOrigin: run.workspaceOrigin,
          integration: run.integration,
          workspace: run.workspace,
          teamExecution: run.settings.teamExecution ?? "sequential",
          checkpoints: run.checkpoints,
          changes: run.changes,
          commands: run.commands,
          tasks: run.tasks.map((t) => ({
            id: t.id,
            role: t.role,
            model: t.model,
            state: t.state,
            summary: t.summary,
            error: t.error,
            failure: t.failure,
            metrics: t.metrics,
            sessionId: t.sessionId,
            workspace: t.workspace,
            workspaceOrigin: t.workspaceOrigin,
            baseEvidence: t.baseEvidence,
            evidence: t.evidence,
            changes: t.changes,
          })),
          review: run.review,
        },
        events,
      },
      (_field, value) =>
        typeof value === "string" ? redact(value, secrets, Infinity) : value,
      2,
    );
  }
  retention(days: number, keep: number): RetentionPreview {
    const runs = (
      this.db
        .prepare("SELECT value FROM runs ORDER BY created_at DESC")
        .all() as { value: string }[]
    ).map((r) => normalizeRun(JSON.parse(r.value)));
    const cutoff = Date.now() - days * 86400000;
    const protectedIds = new Set(runs.slice(0, keep).map((r) => r.id));
    for (const r of runs)
      if (isActive(r.state) || r.state === "interrupted")
        protectedIds.add(r.id);
    for (const q of this.queue.list())
      if (q.afterRunId) protectedIds.add(q.afterRunId);
    for (const id of this.board.protectedRunIds()) protectedIds.add(id);
    for (const id of this.questions.protectedRunIds()) protectedIds.add(id);
    for (const id of this.reports.protectedRunIds()) protectedIds.add(id);
    const refs = (value: unknown, result: Set<string>) => {
      if (!value || typeof value !== "object") return;
      for (const [key, item] of Object.entries(value)) {
        if (
          ["retryOf", "recoveryOf", "attemptRoot", "runId"].includes(key) &&
          typeof item === "string"
        )
          result.add(item);
        else if (key === "runIds" && Array.isArray(item)) {
          for (const id of item) if (typeof id === "string") result.add(id);
        } else refs(item, result);
      }
    };
    let candidates = new Set(
      runs
        .filter(
          (r) => !protectedIds.has(r.id) && Date.parse(r.createdAt) < cutoff,
        )
        .map((r) => r.id),
    );
    for (;;) {
      const referenced = new Set<string>();
      for (const run of runs)
        if (!candidates.has(run.id)) refs(run, referenced);
      const size = candidates.size;
      for (const id of referenced) candidates.delete(id);
      if (size === candidates.size) break;
    }
    const token = randomUUID();
    this.retentionTickets.clear();
    this.retentionTickets.set(token, {
      ids: [...candidates],
      expires: Date.now() + 60000,
    });
    return {
      token,
      runIds: [...candidates],
      count: candidates.size,
      protected: runs.length - candidates.size,
    };
  }
  prune(token: string): number {
    const ticket = this.retentionTickets.get(token);
    this.retentionTickets.delete(token);
    if (!ticket || ticket.expires < Date.now())
      throw new Error("Bản xem trước dọn dữ liệu đã hết hạn.");
    const ids = new Set(ticket.ids);
    if (this.reports.protectedRunIds().some((id) => ids.has(id)))
      throw new Error(
        "Có báo cáo mới tham chiếu lịch sử này; tải lại bản xem trước.",
      );
    if (this.questions.protectedRunIds().some((id) => ids.has(id)))
      throw new Error(
        "Có câu hỏi mới tham chiếu lịch sử này; tải lại bản xem trước.",
      );
    if (this.board.protectedRunIds().some((id) => ids.has(id)))
      throw new Error("Có liên kết Kanban mới; tải lại bản xem trước.");
    const queued = this.queue.list();
    const rows = this.db.prepare("SELECT value FROM runs").all() as {
      value: string;
    }[];
    const runs = rows.map((row) => normalizeRun(JSON.parse(row.value)));
    for (const run of runs) {
      if (
        ids.has(run.id) &&
        (isActive(run.state) ||
          run.state === "interrupted" ||
          queued.some((q) => q.afterRunId === run.id))
      )
        throw new Error(
          "Có lượt đang hoạt động hoặc cần phục hồi; tải lại bản xem trước.",
        );
      if (
        !ids.has(run.id) &&
        [...ids].some((id) => JSON.stringify(run).includes(id))
      )
        throw new Error(
          "Có tham chiếu mới đến lịch sử này; tải lại bản xem trước.",
        );
    }
    this.db.transaction(() => {
      for (const id of ids) {
        this.db.prepare("DELETE FROM reports WHERE run_id=?").run(id);
        this.db.prepare("DELETE FROM chat_requests WHERE run_id=?").run(id);
        for (const table of [
          "events",
          "tasks",
          "messages",
          "workspace_evidence",
          "file_recoveries",
          "command_artifacts",
        ])
          this.db.prepare(`DELETE FROM ${table} WHERE run_id=?`).run(id);
        this.db.prepare("DELETE FROM runs WHERE id=?").run(id);
      }
      const hashes = new Set<string>();
      const collect = (value: unknown) => {
        if (typeof value === "string" && /^[a-f0-9]{64}$/.test(value))
          hashes.add(value);
        else if (value && typeof value === "object")
          for (const item of Object.values(value)) collect(item);
      };
      for (const table of ["runs", "workspace_evidence"])
        for (const row of this.db
          .prepare(`SELECT value FROM ${table}`)
          .all() as { value: string }[])
          collect(JSON.parse(row.value));
      for (const row of this.db
        .prepare("SELECT value,run_value FROM reports")
        .all() as { value: string; run_value: string }[]) {
        collect(JSON.parse(row.value));
        collect(JSON.parse(row.run_value));
      }
      for (const row of this.db
        .prepare("SELECT hash FROM file_recoveries")
        .all() as { hash: string }[])
        if (row.hash) hashes.add(row.hash);
      for (const row of this.db
        .prepare("SELECT hash FROM workspace_blobs")
        .all() as { hash: string }[])
        if (!hashes.has(row.hash))
          this.db
            .prepare("DELETE FROM workspace_blobs WHERE hash=?")
            .run(row.hash);
    })();
    return ids.size;
  }
}
