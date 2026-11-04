import {
  lstat,
  realpath,
  readFile,
  open,
  unlink,
  rename,
  link,
} from "node:fs/promises";
import { join, relative, isAbsolute, dirname } from "node:path";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Store } from "../storage/database";
import type { FileVersion, RestorePreview } from "../../shared/evidence";
import { captureGit, hashBytes } from "./git-evidence";
import { patchFor } from "../storage/evidence";

type Ticket = {
  runId: string;
  path: string;
  expires: number;
  expected: string | null;
  head: string | null;
  index: string | null;
  gitRoot: string | null;
};
const conflict = () =>
  new Error(
    "File hoặc Git đã thay đổi sau lượt chạy. Không ghi đè; giữ thay đổi mới và xử lý thủ công.",
  );
export class WorkspaceFiles {
  private tickets = new Map<string, Ticket>();
  constructor(
    private store: Store,
    private idle: () => void,
    private exclusive: <T>(fn: () => Promise<T>) => Promise<T>,
  ) {}
  async resolve(runId: string, path: string): Promise<string> {
    const run = this.store.run(runId),
      e = this.store.evidence.get(runId);
    const project = this.store.project(run.projectId);
    if (project.path !== e.root || run.workspace !== e.root)
      throw new Error("Source không còn khớp dự án của lượt chạy.");
    if (
      !Object.hasOwn(e.before.files, path) &&
      !Object.hasOwn(e.after?.files ?? {}, path)
    )
      throw new Error("File không thuộc snapshot.");
    if (
      !path ||
      isAbsolute(path) ||
      path
        .split("/")
        .some(
          (p) =>
            !p ||
            p === "." ||
            p === ".." ||
            /[\\:\x00-\x1f]/.test(p) ||
            p.endsWith(".") ||
            p.endsWith(" ") ||
            /^(\.git|con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(p),
        )
    )
      throw new Error("Đường dẫn file không hợp lệ.");
    const root = await realpath(e.root);
    if (root.toLowerCase() !== e.root.toLowerCase())
      throw new Error("Đường dẫn source đã thay đổi.");
    const target = join(root, ...path.split("/"));
    const rel = relative(root, target);
    if (rel.startsWith("..") || isAbsolute(rel))
      throw new Error("File nằm ngoài dự án.");
    let current = root;
    for (const [i, part] of path.split("/").entries()) {
      current = join(current, part);
      try {
        const info = await lstat(current);
        if (
          info.isSymbolicLink() ||
          (i < path.split("/").length - 1 && !info.isDirectory()) ||
          (i === path.split("/").length - 1 && !info.isFile())
        )
          throw new Error("Không thao tác qua liên kết hoặc file đặc biệt.");
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code === "ENOENT" &&
          i === path.split("/").length - 1
        )
          break;
        throw error;
      }
    }
    return target;
  }
  private async current(
    target: string,
  ): Promise<{ hash: string; data: Buffer; mode: number } | null> {
    let info;
    try {
      info = await lstat(target);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink > 1 ||
      info.size > 1024 * 1024
    )
      throw conflict();
    const data = await readFile(target);
    return { hash: hashBytes(data), data, mode: info.mode };
  }
  private async verify(
    runId: string,
    path: string,
    expected: FileVersion | null,
  ) {
    const e = this.store.evidence.get(runId),
      target = await this.resolve(runId, path);
    if (!e.after) throw new Error("Chưa có snapshot kết quả.");
    const current = await this.current(target);
    if (
      (current?.hash ?? null) !== (expected?.hash ?? null) ||
      (current &&
        expected &&
        (current.mode & 0o777) !== (expected.mode & 0o777))
    )
      throw conflict();
    const git = (await captureGit(e.root)).state;
    if (
      !!git !== !!e.after.git ||
      (git &&
        (!git.metadataComplete ||
          !e.after.git?.metadataComplete ||
          git.head !== e.after.git.head ||
          git.indexHash !== e.after.git.indexHash ||
          git.root !== e.after.git.root))
    )
      throw conflict();
    return { target, current, git };
  }
  async preview(runId: string, path: string): Promise<RestorePreview> {
    this.idle();
    const diff = this.store.evidence.diff(runId, path);
    if (!diff.canRestore)
      throw new Error("File này không đủ snapshot để khôi phục an toàn.");
    const e = this.store.evidence.get(runId),
      before = e.before.files[path] ?? null,
      after = e.after!.files[path] ?? null;
    const checked = await this.verify(runId, path, after);
    const data = this.store.evidence.bytes(before);
    const patch = patchFor(path, checked.current?.data ?? null, data);
    const token = randomUUID(),
      expires = Date.now() + 120000;
    for (const [id, t] of this.tickets)
      if (t.expires < Date.now()) this.tickets.delete(id);
    if (this.tickets.size >= 20)
      this.tickets.delete(this.tickets.keys().next().value!);
    this.tickets.set(token, {
      runId,
      path,
      expires,
      expected: after?.hash ?? null,
      head: checked.git?.head ?? null,
      index: checked.git?.indexHash ?? null,
      gitRoot: checked.git?.root ?? null,
    });
    return {
      token,
      path,
      patch: patch.patch || patch.reason,
      action: diff.restoreAction,
      expiresAt: new Date(expires).toISOString(),
    };
  }
  async restore(token: string): Promise<void> {
    return this.exclusive(async () => {
      const t = this.tickets.get(token);
      this.tickets.delete(token);
      if (!t || t.expires < Date.now())
        throw new Error(
          "Bản xem trước đã hết hạn. Mở lại trước khi khôi phục.",
        );
      const e = this.store.evidence.get(t.runId),
        before = e.before.files[t.path] ?? null,
        after = e.after!.files[t.path] ?? null;
      const checked = await this.verify(t.runId, t.path, after);
      if ((after?.hash ?? null) !== t.expected) throw conflict();
      if (
        checked.git?.head !== undefined &&
        (checked.git.head !== t.head ||
          checked.git.indexHash !== t.index ||
          checked.git.root !== t.gitRoot)
      )
        throw conflict();
      const bytes = this.store.evidence.bytes(before);
      // A recovery copy precedes every mutation, including removal of a newly created file.
      this.store.evidence.recovery(
        t.runId,
        t.path,
        checked.current?.data ?? null,
      );
      const temp = join(
        dirname(checked.target),
        `.asf-restore-${randomUUID()}.tmp`,
      );
      const parked = join(
        dirname(checked.target),
        `.asf-recovery-${randomUUID()}.tmp`,
      );
      let moved = false;
      try {
        if (bytes !== null) {
          const handle = await open(
            temp,
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
            before!.mode & 0o777,
          );
          try {
            await handle.writeFile(bytes);
            await handle.sync();
          } finally {
            await handle.close();
          }
        }
        await this.verify(t.runId, t.path, after);
        if (after !== null) {
          // Move the exact current file aside, then verify it. Never replace an occupied destination.
          await rename(checked.target, parked);
          moved = true;
          const actual = await this.current(parked);
          if (actual?.hash !== after.hash) throw conflict();
        }
        await this.verify(t.runId, t.path, null);
        if (bytes !== null) await link(temp, checked.target); // Atomic exclusive publication on NTFS; EEXIST preserves a concurrent editor's file.
        if (moved) {
          const actual = await this.current(parked);
          if (actual?.hash !== after?.hash) throw conflict();
          await unlink(parked);
          moved = false;
        }
      } catch (error) {
        if (moved) {
          // Roll back only into an absent path. If an editor created a new file, keep both copies.
          try {
            await this.resolve(t.runId, t.path);
            await link(parked, checked.target);
            await unlink(parked);
            moved = false;
          } catch {}
        }
        if (moved)
          throw new Error(
            `Không ghi đè file mới. Bản dự phòng còn tại ${parked}. Kiểm tra hai file trước khi xử lý tiếp.`,
          );
        throw error;
      } finally {
        await unlink(temp).catch(() => {});
      }
      this.store.event(
        t.runId,
        "FILE_RESTORED",
        `Khôi phục snapshot trước lượt chạy: ${t.path}. Giữ nguyên Git index; có bản dự phòng trước khôi phục.`,
      );
    });
  }
}
