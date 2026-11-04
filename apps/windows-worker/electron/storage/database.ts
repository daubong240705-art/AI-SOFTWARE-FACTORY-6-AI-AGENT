import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { normalizeRun, type Run, type RunEvent } from "../../shared/runs";
import {
  defaultSettings,
  settingsSchema,
  type Settings,
  type Project,
} from "../../shared/contracts";

export class Store {
  private db: Database.Database;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new Database(join(directory, "worker.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    const version = this.db.pragma("user_version", { simple: true }) as number;
    if (version > 3)
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
    for (const run of this.runs())
      if (["queued", "running", "blocked", "cancelling"].includes(run.state)) {
        this.updateRun(
          {
            ...run,
            state: "interrupted",
            currentTaskId: null,
            tasks: run.tasks.map((task) => ({
              ...task,
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
}
