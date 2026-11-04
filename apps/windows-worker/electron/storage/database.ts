import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { Conversations } from "./conversations";
import { FollowUps } from "./follow-ups";
import { EvidenceStore } from "./evidence";
import { failure } from "../runtime/failure";
import { redact } from "../runtime/security";
import { isActive } from "../../shared/runs";
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
      if (version > 6)
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
    const active = this.runs().find(
      (run) =>
        run.projectId === id &&
        ["queued", "running", "blocked", "cancelling"].includes(run.state),
    );
    if (active)
      throw new Error("Dừng tác vụ trước khi bỏ dự án khỏi danh sách.");
    this.db.prepare("DELETE FROM projects WHERE id=?").run(id);
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
  runs(): Run[] {
    return (
      this.db
        .prepare("SELECT value FROM runs ORDER BY created_at DESC LIMIT 50")
        .all() as { value: string }[]
    ).map((row) => normalizeRun(JSON.parse(row.value)));
  }
  updateRun(run: Run, event?: { type: string; text: string }): void {
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
      if (event) this.event(run.id, event.type, event.text);
    })();
  }
  event(runId: string, type: string, text: string): void {
    const count = (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM events WHERE run_id=?")
        .get(runId) as { n: number }
    ).n;
    if (count >= 2000) return;
    this.db
      .prepare("INSERT INTO events (run_id,type,text,at) VALUES (?,?,?,?)")
      .run(runId, type, text.slice(0, 12000), new Date().toISOString());
  }
  events(id: string): RunEvent[] {
    return this.db
      .prepare(
        "SELECT sequence,run_id AS runId,type,text,at FROM (SELECT * FROM events WHERE run_id=? ORDER BY sequence DESC LIMIT 300) ORDER BY sequence",
      )
      .all(id) as RunEvent[];
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
