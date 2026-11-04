import type Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createTwoFilesPatch } from "diff";
import type {
  EvidenceView,
  EvidenceFile,
  FileVersion,
  FileDiff,
  TaskEvidence,
  EvidenceRef,
} from "../../shared/evidence";
import { sourceVersion, readEvidence } from "../team/evidence";
import type { Run } from "../../shared/runs";
import { inScope } from "../../shared/team";
import type { Snapshot } from "../workspace/snapshot";
import type { GitCapture } from "../workspace/git-evidence";
import { hashBytes } from "../workspace/git-evidence";
type Capture = {
  at: string;
  complete: boolean;
  enumerationComplete: boolean;
  files: Record<string, FileVersion>;
  git: GitCapture["state"];
  versions: GitCapture["versions"];
};
type Evidence = { root: string; before: Capture; after?: Capture };
export function textOf(data: Buffer): string | null {
  try {
    if (data.includes(0)) return null;
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return null;
  }
}
export function patchFor(
  path: string,
  before: Buffer | null,
  after: Buffer | null,
): { patch: string; binary: boolean; reason: string } {
  const a = before === null ? "" : textOf(before),
    b = after === null ? "" : textOf(after);
  if (a === null || b === null)
    return {
      patch: "",
      binary: true,
      reason: "File nhị phân hoặc không phải UTF-8.",
    };
  if (a.length + b.length > 512000)
    return {
      patch: "",
      binary: false,
      reason: "Nội dung quá lớn để hiển thị diff (500 KB).",
    };
  if (a.split("\n").length + b.split("\n").length > 20000)
    return {
      patch: "",
      binary: false,
      reason: "Quá nhiều dòng để hiển thị diff.",
    };
  try {
    const patch = createTwoFilesPatch(
      before === null ? "/dev/null" : `a/${path}`,
      after === null ? "/dev/null" : `b/${path}`,
      a,
      b,
      "",
      "",
      { context: 3, timeout: 1000, maxEditLength: 12000 },
    );
    if (!patch || patch.length > 512000 || patch.split("\n").length > 6000)
      return {
        patch: "",
        binary: false,
        reason: "Diff vượt giới hạn hiển thị (500 KB, 6.000 dòng).",
      };
    return {
      patch,
      binary: false,
      reason: "",
    };
  } catch {
    return { patch: "", binary: false, reason: "Diff vượt giới hạn xử lý." };
  }
}
export class EvidenceStore {
  taskDiff(
    run: Run,
    ref: EvidenceRef,
  ): Pick<FileDiff, "patch" | "binary" | "reason"> {
    if (ref.kind !== "file") throw new Error("Chỉ mở diff của file evidence.");
    readEvidence(run, ref, this); // Validate exact run/task/attempt/session/source/hash.
    const task = run.tasks.find((t) => t.id === ref.attemptId)!;
    const added = task.changes.some(
      (file) => file.path === ref.path && file.kind === "added",
    );
    if (
      !task.baseEvidence ||
      (!Object.hasOwn(task.baseEvidence.files, ref.path) && !added)
    )
      return {
        patch: "",
        binary: false,
        reason:
          "Attempt này chưa lưu baseline file; mở nội dung evidence để xem kết quả.",
      };
    return patchFor(
      ref.path,
      this.bytes(task.baseEvidence.files[ref.path] ?? null),
      this.bytes(task.evidence!.files[ref.path]),
    );
  }
  constructor(
    private db: Database.Database,
    directory: string,
    version: number,
  ) {
    if ((db.pragma("user_version", { simple: true }) as number) >= 6) return;
    const backup = join(directory, "worker.schema5.backup.sqlite");
    if (version === 5 && !existsSync(backup))
      db.prepare("VACUUM INTO ?").run(backup);
    db.transaction(() =>
      db.exec(
        `CREATE TABLE workspace_evidence (run_id TEXT PRIMARY KEY REFERENCES runs(id),value TEXT NOT NULL); CREATE TABLE workspace_blobs (hash TEXT PRIMARY KEY,data BLOB NOT NULL); CREATE TABLE file_recoveries (id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL REFERENCES runs(id),path TEXT NOT NULL,hash TEXT,at TEXT NOT NULL); CREATE TABLE command_artifacts (run_id TEXT NOT NULL REFERENCES runs(id),call_id TEXT NOT NULL,output TEXT NOT NULL,PRIMARY KEY(run_id,call_id)); PRAGMA user_version=6;`,
      ),
    )();
  }
  private capture(snapshot: Snapshot, git: GitCapture): Capture {
    return {
      at: new Date().toISOString(),
      complete:
        snapshot.complete &&
        snapshot.contentComplete !== false &&
        (!git.state || git.state.complete),
      enumerationComplete: snapshot.enumerationComplete ?? snapshot.complete,
      files: snapshot.entries ?? {},
      git: git.state,
      versions: git.versions,
    };
  }
  begin(
    runId: string,
    root: string,
    snapshot: Snapshot,
    git: GitCapture,
  ): void {
    this.save(
      runId,
      { root, before: this.capture(snapshot, git) },
      snapshot,
      git,
    );
  }
  finish(runId: string, snapshot: Snapshot, git: GitCapture): void {
    this.save(
      runId,
      { ...this.get(runId), after: this.capture(snapshot, git) },
      snapshot,
      git,
    );
  }
  private save(
    runId: string,
    value: Evidence,
    snapshot: Snapshot,
    git: GitCapture,
  ): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO workspace_evidence VALUES (?,?) ON CONFLICT(run_id) DO UPDATE SET value=excluded.value",
        )
        .run(runId, JSON.stringify(value));
      const insert = this.db.prepare(
        "INSERT OR IGNORE INTO workspace_blobs VALUES (?,?)",
      );
      for (const [hash, data] of [
        ...(snapshot.blobs ?? new Map()),
        ...git.blobs,
      ])
        insert.run(hash, data);
    })();
  }
  get(runId: string): Evidence {
    const row = this.db
      .prepare("SELECT value FROM workspace_evidence WHERE run_id=?")
      .get(runId) as { value: string } | undefined;
    if (!row)
      throw new Error(
        "Lượt này chưa có snapshot nội dung. Lượt cũ chỉ giữ danh sách file.",
      );
    return JSON.parse(row.value);
  }
  bytes(version: FileVersion | null): Buffer | null {
    if (version === null) return null;
    if (version.reason || !version.hash)
      throw new Error(version.reason ?? "Không có nội dung snapshot.");
    const row = this.db
      .prepare("SELECT data FROM workspace_blobs WHERE hash=?")
      .get(version.hash) as { data: Buffer } | undefined;
    if (!row) throw new Error("Không có nội dung snapshot.");
    if (hashBytes(row.data) !== version.hash)
      throw new Error("Nội dung snapshot không khớp hash.");
    return row.data;
  }
  saveTaskSnapshot(
    source: Snapshot,
    deleted: string[] = [],
    allowedPaths: string[] = ["."],
  ): TaskEvidence | undefined {
    const version = sourceVersion(source);
    if (!version || !source.entries) return;
    const files: TaskEvidence["files"] = Object.fromEntries(
      Object.entries(source.entries).filter(([path]) =>
        inScope(path, allowedPaths),
      ),
    );
    const needed = new Set(Object.values(files).map((file) => file?.hash));
    this.db.transaction(() => {
      const insert = this.db.prepare(
        "INSERT OR IGNORE INTO workspace_blobs VALUES (?,?)",
      );
      for (const [hash, data] of source.blobs ?? [])
        if (needed.has(hash)) insert.run(hash, data);
    })();
    for (const path of deleted)
      if (inScope(path, allowedPaths)) files[path] = null;
    return { sourceVersion: version, files };
  }
  recovery(runId: string, path: string, data: Buffer | null): void {
    this.db.transaction(() => {
      const hash = data === null ? null : hashBytes(data);
      if (hash)
        this.db
          .prepare("INSERT OR IGNORE INTO workspace_blobs VALUES (?,?)")
          .run(hash, data);
      this.db
        .prepare(
          "INSERT INTO file_recoveries (run_id,path,hash,at) VALUES (?,?,?,?)",
        )
        .run(runId, path, hash, new Date().toISOString());
    })();
  }
  saveCommand(runId: string, callId: string, output: string): void {
    const count = this.db
      .prepare("SELECT COUNT(*) AS n FROM command_artifacts WHERE run_id=?")
      .get(runId) as { n: number };
    if (
      count.n >= 100 &&
      !this.db
        .prepare("SELECT 1 FROM command_artifacts WHERE run_id=? AND call_id=?")
        .get(runId, callId)
    )
      return;
    this.db
      .prepare(
        "INSERT INTO command_artifacts VALUES (?,?,?) ON CONFLICT(run_id,call_id) DO UPDATE SET output=excluded.output",
      )
      .run(runId, callId, output.slice(0, 256000));
  }
  command(runId: string, callId: string): string {
    const row = this.db
      .prepare(
        "SELECT output FROM command_artifacts WHERE run_id=? AND call_id=?",
      )
      .get(runId, callId) as { output: string } | undefined;
    if (!row) throw new Error("Lệnh cũ không có artifact mở rộng.");
    return row.output;
  }
  view(runId: string): EvidenceView {
    const e = this.get(runId),
      a = e.before,
      b = e.after;
    const changed = (path: string) => {
      const x = a.files[path],
        y = b?.files[path];
      return (
        b &&
        (x?.hash !== y?.hash ||
          x?.stamp !== y?.stamp ||
          x?.mode !== y?.mode ||
          !x !== !y)
      );
    };
    const make = (path: string): EvidenceFile => ({
      path,
      kind: !a.files[path] ? "added" : !b?.files[path] ? "deleted" : "modified",
      preExisting: !!a.git?.status[path],
      before: a.files[path] ?? null,
      after: b?.files[path] ?? null,
      gitBefore: a.git?.status[path],
      gitAfter: b?.git?.status[path],
    });
    const allFiles = [
      ...new Set([...Object.keys(a.files), ...Object.keys(b?.files ?? {})]),
    ]
      .filter(
        (p) =>
          changed(p) &&
          ((a.files[p] && b?.files[p]) ||
            (!a.files[p] && a.enumerationComplete) ||
            (!b?.files[p] && b?.enumerationComplete)),
      )
      .map(make);
    const files = allFiles.slice(0, 500);
    for (const added of files.filter(
      (f) => f.kind === "added" && f.after?.hash,
    )) {
      const deleted = files.filter(
        (f) => f.kind === "deleted" && f.before?.hash === added.after!.hash,
      );
      if (deleted.length === 1) {
        added.renamedFrom = deleted[0].path;
        deleted[0].renamedTo = added.path;
      }
      const original = added.gitAfter?.originalPath;
      if (
        original &&
        files.some((f) => f.path === original && f.kind === "deleted")
      ) {
        added.renamedFrom = original;
        files.find((f) => f.path === original)!.renamedTo = added.path;
      }
    }
    return {
      runId,
      complete: a.complete && !!b?.complete && allFiles.length <= 500,
      finished: !!b,
      beforeAt: a.at,
      afterAt: b?.at,
      headBefore: a.git?.head ?? null,
      headAfter: b?.git?.head ?? null,
      indexChanged: a.git?.indexHash !== b?.git?.indexHash,
      preExistingCount: Object.keys(a.git?.status ?? {}).length,
      files,
      existing: Object.keys(a.git?.status ?? {})
        .slice(0, 500)
        .map(make),
    };
  }
  diff(
    runId: string,
    path: string,
    comparison: "run" | "staged" | "unstaged" = "run",
    source: "before" | "after" = "after",
  ): FileDiff {
    const e = this.get(runId),
      phase = source === "before" ? e.before : e.after;
    if (!phase) throw new Error("Lượt này chưa có snapshot kết quả.");
    let before: FileVersion | null, after: FileVersion | null;
    if (comparison === "run") {
      if (
        !this.view(runId).files.some((f) => f.path === path) &&
        !Object.hasOwn(e.before.files, path)
      )
        throw new Error("File không thuộc snapshot.");
      before = e.before.files[path] ?? null;
      after = e.after?.files[path] ?? null;
    } else {
      const versions = Object.hasOwn(phase.versions, path)
        ? phase.versions[path]
        : undefined;
      if (!versions)
        throw new Error(
          "Không có nội dung Git cho file này (giới hạn 100 file/lượt).",
        );
      before = comparison === "staged" ? versions.head : versions.index;
      after =
        comparison === "staged" ? versions.index : (phase.files[path] ?? null);
    }
    let result: { patch: string; binary: boolean; reason: string };
    try {
      result = patchFor(path, this.bytes(before), this.bytes(after));
    } catch (error) {
      result = {
        patch: "",
        binary: false,
        reason: error instanceof Error ? error.message : "Không có nội dung.",
      };
    }
    const file = this.view(runId).files.find((f) => f.path === path);
    return {
      path,
      ...result,
      comparison,
      canRestore:
        comparison === "run" &&
        !!file &&
        !!e.after &&
        e.before.enumerationComplete &&
        e.after.enumerationComplete &&
        !before?.reason &&
        !after?.reason &&
        (!before || !!before.hash) &&
        (!after || !!after.hash),
      restoreAction: !e.before.files[path]
        ? "Xóa file được thêm trong lượt này"
        : "Khôi phục nội dung trước lượt chạy",
    };
  }
}
