import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
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
    if (version > 1)
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
}
