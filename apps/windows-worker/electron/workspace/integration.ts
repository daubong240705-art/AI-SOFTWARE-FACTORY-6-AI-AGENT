import {
  lstat,
  realpath,
  readFile,
  mkdir,
  open,
  rename,
  link,
  unlink,
} from "node:fs/promises";
import { join, dirname, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import type { Run } from "../../shared/runs";
import type { TeamTask } from "../../shared/team";
import { inScope } from "../../shared/team";
import type { FileVersion, TaskEvidence } from "../../shared/evidence";
import type { OwnedWorkspace } from "../../shared/worktrees";
import type { Store } from "../storage/database";
import { Worktrees } from "./worktrees";
import { snapshot } from "./snapshot";
import { sourceVersion } from "../team/evidence";
import { hashBytes } from "./git-evidence";
import { TeamBlocked } from "../team/coordinator";
import { includeSourcePath } from "./snapshot";

const equal = (a: FileVersion | null, b: FileVersion | null) =>
  a === null || b === null
    ? a === b
    : a.hash === b.hash && (a.mode & 0o777) === (b.mode & 0o777);
const versionAt = (evidence: TaskEvidence, path: string) =>
  Object.hasOwn(evidence.files, path) ? evidence.files[path] : null;

/** Conservative whole-file three-way integration. Never writes to the original repository. */
export class Integration {
  constructor(
    private store: Store,
    private manager: Worktrees,
    private run: Run,
    private create: () => Promise<OwnedWorkspace>,
    private check: () => void,
    private persist: (type: string, text: string) => void,
    private secrets: string[] = [],
  ) {}

  async initialize(): Promise<void> {
    if (this.run.integration) return;
    const owned = await this.create();
    const placeholder: TaskEvidence = { sourceVersion: "", files: {} };
    this.run.integration = {
      workspace: owned.path,
      origin: { id: owned.id, source: owned.source, baseHead: owned.head },
      state: "applying",
      sourceVersion: "",
      taskIds: [],
      conflicts: [],
      baseline: placeholder,
    };
    this.persist("INTEGRATION_CREATING", owned.id);
    const source = await snapshot(owned.path, true, this.secrets);
    const evidence = this.store.evidence.saveTaskSnapshot(source);
    if (!evidence)
      throw new TeamBlocked(
        "Không chụp đủ baseline tích hợp.",
        "incomplete-snapshot",
      );
    this.run.integration = {
      workspace: owned.path,
      origin: { id: owned.id, source: owned.source, baseHead: owned.head },
      state: "ready",
      sourceVersion: evidence.sourceVersion,
      taskIds: [],
      conflicts: [],
      evidence,
      baseline: evidence,
    };
    this.persist("INTEGRATION_CREATED", owned.id);
  }

  async validate(): Promise<TaskEvidence> {
    this.check();
    const integration = this.run.integration!;
    if (!["ready", "verified"].includes(integration.state))
      throw new TeamBlocked(
        "Bản tích hợp đang dở hoặc có conflict; không tự phát lại thao tác.",
        "integration-conflict",
      );
    await this.manager.verifyTask(
      integration.origin.id,
      integration.origin.baseHead,
    );
    const current = await snapshot(integration.workspace, true, this.secrets);
    if (sourceVersion(current) !== integration.sourceVersion)
      throw new TeamBlocked(
        "Source tích hợp thay đổi ngoài lượt đang quản lý.",
        "workspace-changed",
      );
    if (!integration.evidence)
      throw new TeamBlocked("Thiếu snapshot tích hợp.", "incomplete-snapshot");
    for (const path of Object.keys(integration.evidence.files))
      if (
        !equal(
          versionAt(integration.evidence, path),
          current.entries?.[path] ?? null,
        )
      )
        throw new TeamBlocked(
          "Metadata source tích hợp đã thay đổi.",
          "workspace-changed",
        );
    return integration.evidence;
  }

  async seed(owned: OwnedWorkspace): Promise<void> {
    const integration = this.run.integration!;
    const latest = await this.validate();
    await this.manager.verifyTask(owned.id, integration.origin.baseHead);
    const initial = await snapshot(owned.path, true, this.secrets);
    if (sourceVersion(initial) !== integration.baseline.sourceVersion)
      throw new TeamBlocked(
        "Workspace mới không khớp baseline tích hợp.",
        "workspace-changed",
      );
    await this.apply(
      owned.path,
      integration.baseline,
      latest,
      integration.baseline,
      ["."],
    );
    const seeded = await snapshot(owned.path);
    if (sourceVersion(seeded) !== latest.sourceVersion)
      throw new TeamBlocked(
        "Chưa sao chép đủ source tích hợp sang task.",
        "incomplete-snapshot",
      );
    this.check();
  }

  async accept(task: TeamTask): Promise<void> {
    const integration = this.run.integration!;
    if (
      task.state !== "completed" ||
      !task.baseEvidence ||
      !task.evidence ||
      !task.workspaceOrigin ||
      !task.workspace
    )
      throw new TeamBlocked(
        "Task chưa đủ bằng chứng để tích hợp.",
        "evidence-unverified",
      );
    const owned = await this.manager.verifyTask(
      task.workspaceOrigin.id,
      integration.origin.baseHead,
    );
    if (owned.path !== task.workspace || integration.taskIds.includes(task.id))
      throw new TeamBlocked(
        "Workspace/attempt tích hợp không hợp lệ hoặc đã áp dụng.",
        "evidence-unverified",
      );
    if (
      sourceVersion(await snapshot(task.workspace)) !==
      task.evidence.sourceVersion
    )
      throw new TeamBlocked(
        "Kết quả task đổi sau khi chụp bằng chứng.",
        "workspace-changed",
      );
    const current = await this.validate();
    integration.state = "applying";
    this.persist("INTEGRATION_APPLYING", task.id);
    try {
      await this.apply(
        integration.workspace,
        task.baseEvidence,
        task.evidence,
        current,
        task.allowedPaths,
      );
      const source = await snapshot(integration.workspace, true, this.secrets);
      const saved = this.store.evidence.saveTaskSnapshot(source);
      if (!saved)
        throw new TeamBlocked(
          "Snapshot tích hợp chưa đủ.",
          "incomplete-snapshot",
        );
      integration.evidence = saved;
      integration.sourceVersion = saved.sourceVersion;
      integration.taskIds.push(task.id);
      integration.state = "ready";
      this.persist("TASK_INTEGRATED", task.id);
    } catch (error) {
      integration.state = "conflict";
      this.persist("INTEGRATION_BLOCKED", task.id);
      throw error;
    }
  }

  private async target(
    root: string,
    path: string,
    parents = false,
  ): Promise<string> {
    const parts = path.split("/");
    if (
      !path ||
      isAbsolute(path) ||
      !includeSourcePath(path) ||
      parts.some(
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
      throw new TeamBlocked(
        "Đường dẫn tích hợp không hợp lệ.",
        "scope-violation",
      );
    const canonical = await realpath(root);
    if (canonical.toLowerCase() !== root.toLowerCase())
      throw new Error("Integration root changed");
    let current = root;
    for (const [index, part] of parts.entries()) {
      current = join(current, part);
      let info;
      try {
        info = await lstat(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (index === parts.length - 1) return current;
        if (!parents) continue;
        await mkdir(current);
        info = await lstat(current);
      }
      if (
        info.isSymbolicLink() ||
        (index < parts.length - 1
          ? !info.isDirectory()
          : !info.isFile() || info.nlink !== 1)
      )
        throw new TeamBlocked(
          "Không tích hợp qua liên kết hoặc file đặc biệt.",
          "scope-violation",
        );
      const rel = relative(root, await realpath(current));
      if (rel.startsWith("..") || isAbsolute(rel))
        throw new Error("Integration path escaped workspace");
    }
    return current;
  }

  private async current(path: string): Promise<FileVersion | null> {
    let info;
    try {
      info = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      info.size > 1024 * 1024
    )
      throw new Error("Unsafe integration file");
    return {
      hash: hashBytes(await readFile(path)),
      size: info.size,
      mode: info.mode,
    };
  }

  private async apply(
    root: string,
    base: TaskEvidence,
    incoming: TaskEvidence,
    expected: TaskEvidence,
    scopes: string[],
  ): Promise<void> {
    const paths = [
      ...new Set([...Object.keys(base.files), ...Object.keys(incoming.files)]),
    ].filter(
      (path) => !equal(versionAt(base, path), versionAt(incoming, path)),
    );
    const predicted: TaskEvidence["files"] = Object.assign(
      Object.create(null),
      expected.files,
    );
    const existingAliases = new Map(
      Object.keys(expected.files).map((path) => [path.toLowerCase(), path]),
    );
    const planned: {
      path: string;
      before: FileVersion | null;
      after: FileVersion | null;
      bytes: Buffer | null;
    }[] = [];
    const conflicts: string[] = [],
      aliases = new Set<string>();
    for (const path of paths) {
      this.check();
      if (!inScope(path, scopes) || aliases.has(path.toLowerCase()))
        throw new TeamBlocked(
          "Phạm vi/alias tích hợp không hợp lệ.",
          "scope-violation",
        );
      aliases.add(path.toLowerCase());
      if (
        existingAliases.has(path.toLowerCase()) &&
        existingAliases.get(path.toLowerCase()) !== path
      )
        throw new TeamBlocked(
          "Đường dẫn trùng khác chữ hoa/thường: " + path,
          "integration-conflict",
        );
      const before = versionAt(expected, path),
        after = versionAt(incoming, path);
      if (before?.reason || after?.reason || versionAt(base, path)?.reason)
        throw new TeamBlocked(
          "File không đủ nội dung snapshot để tích hợp: " + path,
          "evidence-unverified",
        );
      const target = await this.target(root, path);
      if (!equal(await this.current(target), before)) conflicts.push(path);
      else if (equal(before, after)) continue;
      else if (!equal(before, versionAt(base, path))) conflicts.push(path);
      else {
        planned.push({
          path,
          before,
          after,
          bytes: this.store.evidence.bytes(after),
        });
        if (after) predicted[path] = after;
        else delete predicted[path];
      }
    }
    if (conflicts.length) {
      this.run.integration!.conflicts = conflicts;
      throw new TeamBlocked(
        "Xung đột tích hợp: " + conflicts.slice(0, 8).join(", "),
        "integration-conflict",
      );
    }
    for (const file of planned) {
      this.check();
      const target = await this.target(root, file.path, true);
      if (!equal(await this.current(target), file.before))
        throw new TeamBlocked(
          "File tích hợp đổi trước khi ghi: " + file.path,
          "workspace-changed",
        );
      this.store.evidence.recovery(
        this.run.id,
        "integration/" + randomUUID() + "/" + file.path,
        file.before ? await readFile(target) : null,
      );
      const temp = join(dirname(target), ".asf-incoming-" + randomUUID());
      const parked = join(dirname(target), ".asf-before-" + randomUUID());
      let moved = false;
      try {
        if (file.bytes !== null) {
          const handle = await open(temp, "wx", file.after!.mode & 0o777);
          try {
            await handle.writeFile(file.bytes);
            await handle.sync();
          } finally {
            await handle.close();
          }
        }
        await this.target(root, file.path);
        if (!equal(await this.current(target), file.before))
          throw new Error("Integration file changed");
        if (file.before) {
          await rename(target, parked);
          moved = true;
          if (!equal(await this.current(parked), file.before))
            throw new Error("Integration parked file changed");
        }
        await this.target(root, file.path);
        if (file.bytes !== null) await link(temp, target);
        if (moved) {
          if (!equal(await this.current(parked), file.before))
            throw new Error("Integration backup changed; keep both copies");
          await unlink(parked);
          moved = false;
        }
      } catch (error) {
        if (moved) {
          try {
            await this.target(root, file.path);
            await link(parked, target);
            await unlink(parked);
            moved = false;
          } catch {
            /* Preserve both copies on conflict. */
          }
        }
        throw new TeamBlocked(
          "Tích hợp dừng; giữ workspace và bản dự phòng để kiểm tra: " +
            file.path,
          "integration-conflict",
        );
      } finally {
        await unlink(temp).catch(() => {});
      }
    }
    const after = await snapshot(root, true, this.secrets);
    if (
      !after.complete ||
      Object.keys(after.files).length !== Object.keys(predicted).length ||
      Object.entries(predicted).some(
        ([path, file]) => !equal(file, after.entries?.[path] ?? null),
      )
    )
      throw new TeamBlocked(
        "Source tích hợp đổi ngoài tập file đã tính; giữ workspace để kiểm tra.",
        "workspace-changed",
      );
  }
}
