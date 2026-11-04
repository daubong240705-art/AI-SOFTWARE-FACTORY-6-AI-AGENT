import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdir,
  realpath,
  lstat,
  readFile,
  writeFile,
  rename,
  readdir,
  unlink,
} from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { z } from "zod";
import type { OwnedWorkspace, WorkspaceRemoval } from "../../shared/worktrees";

const manifestSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    repository: z.string().min(1),
    source: z.string().min(1),
    path: z.string().min(1),
    head: z.string().regex(/^[a-f0-9]{40,64}$/),
    createdAt: z.string(),
    state: z.enum(["creating", "ready", "retained", "missing"]),
    issue: z.string().optional(),
  })
  .strict();
const same = (a: string, b: string) =>
  process.platform === "win32"
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b);
const inside = (root: string, path: string) => {
  const r = relative(root, path);
  return (
    r !== ".." &&
    !r.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) &&
    !isAbsolute(r)
  );
};
type Registration = {
  path: string;
  head: string;
  detached: boolean;
  locked: string;
  prunable: boolean;
};

export class Worktrees {
  private root: string;
  private busy = false;
  private tickets = new Map<
    string,
    { id: string; stamp: string; expires: number }
  >();
  constructor(
    directory: string,
    private referenced: (path: string) => boolean = () => false,
  ) {
    this.root = resolve(directory, "workspaces");
  }
  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.busy)
      throw new Error("Đang xử lý workspace. Chờ thao tác hiện tại kết thúc.");
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }
  private async base(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    if (
      (await lstat(this.root)).isSymbolicLink() ||
      !same(await realpath(this.root), this.root)
    )
      throw new Error("Thư mục workspace bị thay bằng liên kết.");
    await mkdir(join(this.root, "no-hooks"), { recursive: true });
    if (
      (await lstat(join(this.root, "no-hooks"))).isSymbolicLink() ||
      (await readdir(join(this.root, "no-hooks"))).length
    )
      throw new Error("Thư mục tắt hook không còn trống/an toàn.");
  }
  private async git(
    cwd: string,
    args: string[],
    input?: string,
  ): Promise<string> {
    if (
      args[0] === "status" ||
      (args[0] === "worktree" && ["add", "remove"].includes(args[1]))
    )
      await this.noFilters(cwd);
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const name of Object.keys(env))
      if (name.toUpperCase().startsWith("GIT_")) delete env[name];
    env.GIT_TERMINAL_PROMPT = "0";
    env.GIT_OPTIONAL_LOCKS = "0";
    return new Promise((ok, bad) => {
      const child = execFile(
        "git",
        [
          "--no-optional-locks",
          "-c",
          `core.hooksPath=${join(this.root, "no-hooks")}`,
          "-c",
          "submodule.recurse=false",
          "-C",
          cwd,
          ...args,
        ],
        {
          windowsHide: true,
          timeout: 30000,
          maxBuffer: 4 * 1024 * 1024,
          env,
        },
        (error, out) =>
          error
            ? bad(
                new Error(
                  "Git worktree không thực hiện được thao tác. Kiểm tra repo, file khóa và quyền truy cập.",
                ),
              )
            : ok(out),
      );
      child.stdin?.on("error", () => {});
      child.stdin?.end(input);
    });
  }
  private dir(id: string): string {
    if (!z.string().uuid().safeParse(id).success)
      throw new Error("Workspace ID không hợp lệ.");
    return join(this.root, id);
  }
  private async noFilters(repository: string): Promise<void> {
    const tracked = await this.git(repository, ["ls-files", "-z"]);
    const attributes = (
      await this.git(
        repository,
        ["check-attr", "-z", "--stdin", "filter"],
        tracked,
      )
    ).split("\0");
    if (
      attributes.some(
        (value, index) =>
          index % 3 === 2 && !["unspecified", "unset"].includes(value),
      )
    )
      throw new Error(
        "Source có Git filter thực thi bên ngoài (ví dụ LFS). V1.2A chưa tự chạy filter khi checkout/status.",
      );
  }
  private async save(value: OwnedWorkspace): Promise<void> {
    const dir = this.dir(value.id);
    await mkdir(dir, { recursive: true });
    if ((await lstat(dir)).isSymbolicLink() || !same(await realpath(dir), dir))
      throw new Error("Ownership directory không hợp lệ.");
    await writeFile(join(dir, "manifest.tmp"), JSON.stringify(value));
    await rename(join(dir, "manifest.tmp"), join(dir, "manifest.json"));
  }
  private async read(id: string): Promise<OwnedWorkspace> {
    await this.base();
    const dir = this.dir(id);
    if ((await lstat(dir)).isSymbolicLink() || !same(await realpath(dir), dir))
      throw new Error("Ownership directory không hợp lệ.");
    const path = join(dir, "manifest.json"),
      info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16384)
      throw new Error("Ownership manifest không hợp lệ.");
    const value = manifestSchema.parse(
      JSON.parse(await readFile(path, "utf8")),
    );
    if (value.id !== id || !inside(join(dir, "tree"), value.path))
      throw new Error("Workspace nằm ngoài thư mục sở hữu.");
    return value;
  }
  private async registrations(repository: string): Promise<Registration[]> {
    const out = await this.git(repository, [
      "worktree",
      "list",
      "--porcelain",
      "-z",
    ]);
    const result: Registration[] = [];
    let current: Registration | undefined;
    for (const field of out.split("\0")) {
      if (field.startsWith("worktree ")) {
        current = {
          path: field.slice(9),
          head: "",
          detached: false,
          locked: "",
          prunable: false,
        };
        result.push(current);
      } else if (current) {
        if (field.startsWith("HEAD ")) current.head = field.slice(5);
        else if (field === "detached") current.detached = true;
        else if (field.startsWith("locked"))
          current.locked = field.slice(6).trim();
        else if (field.startsWith("prunable")) current.prunable = true;
      }
    }
    return result;
  }
  private reason(id: string) {
    return `ASF workspace ${id}`;
  }
  private async absent(value: OwnedWorkspace): Promise<boolean> {
    const tree = join(this.dir(value.id), "tree");
    if (
      (await this.registrations(value.repository)).some((r) =>
        same(r.path, tree),
      )
    )
      return false;
    try {
      await lstat(tree);
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      throw error;
    }
  }
  private async identity(
    value: OwnedWorkspace,
    allowUnlocked = false,
  ): Promise<Registration> {
    const tree = join(this.dir(value.id), "tree");
    const reg = (await this.registrations(value.repository)).find((r) =>
      same(r.path, tree),
    );
    if (!reg || reg.prunable)
      throw new Error(
        "Worktree không còn đăng ký đúng ownership. Giữ dữ liệu để kiểm tra.",
      );
    if (
      !same(await realpath(value.repository), value.repository) ||
      !same(await realpath(tree), tree) ||
      (await lstat(tree)).isSymbolicLink()
    )
      throw new Error("Đường dẫn repo/worktree đã thay đổi.");
    const source = await realpath(value.path);
    if (!inside(tree, source) || !same(source, value.path))
      throw new Error("Source worktree đã thay đổi đường dẫn.");
    const marker = join(tree, ".git"),
      markerInfo = await lstat(marker);
    if (!markerInfo.isFile() || markerInfo.isSymbolicLink())
      throw new Error("Git marker của worktree không hợp lệ.");
    const gitDirectory = (
      await this.git(tree, ["rev-parse", "--path-format=absolute", "--git-dir"])
    ).trim();
    const backlink = (
      await readFile(join(gitDirectory, "gitdir"), "utf8")
    ).trim();
    if (!same(backlink, marker))
      throw new Error("Git metadata trỏ sang worktree khác.");
    const commonA = (
      await this.git(value.repository, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ])
    ).trim();
    const commonB = (
      await this.git(tree, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ])
    ).trim();
    if (!same(await realpath(commonA), await realpath(commonB)))
      throw new Error("Worktree thuộc repository khác.");
    if (reg.locked !== this.reason(value.id) && !(allowUnlocked && !reg.locked))
      throw new Error(
        "Ownership lock không khớp. Không nhận hoặc xóa worktree này.",
      );
    return reg;
  }
  async create(projectId: string, source: string): Promise<OwnedWorkspace> {
    return this.exclusive(async () => {
      await this.base();
      z.string().uuid().parse(projectId);
      source = await realpath(source);
      const repository = await realpath(
        (await this.git(source, ["rev-parse", "--show-toplevel"])).trim(),
      );
      if (inside(this.root, repository))
        throw new Error(
          "Không tạo worktree lồng trong workspace do ứng dụng quản lý.",
        );
      const status = await this.git(repository, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      ]);
      if (status)
        throw new Error(
          "Repo có thay đổi chưa commit. Commit hoặc chọn repo sạch trước khi tạo workspace; ứng dụng không tự stash.",
        );
      if (
        (await this.git(repository, ["ls-files", "--stage"]))
          .split("\n")
          .some((line) => line.startsWith("160000 "))
      )
        throw new Error("V1.2A chưa hỗ trợ repo có submodule.");
      const head = (
        await this.git(repository, ["rev-parse", "--verify", "HEAD"])
      ).trim();
      const id = randomUUID(),
        tree = join(this.dir(id), "tree"),
        scope = relative(repository, source);
      if (!inside(repository, source))
        throw new Error("Project nằm ngoài repository.");
      const value: OwnedWorkspace = {
        id,
        projectId,
        repository,
        source,
        path: join(tree, scope),
        head,
        createdAt: new Date().toISOString(),
        state: "creating",
      };
      await this.save(value);
      try {
        await this.git(repository, [
          "worktree",
          "add",
          "--detach",
          "--lock",
          "--reason",
          this.reason(id),
          tree,
          head,
        ]);
        await this.identity(value);
        if (
          (await this.git(repository, ["rev-parse", "HEAD"])).trim() !== head ||
          (await this.git(repository, [
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
          ]))
        )
          throw new Error(
            "Source gốc đổi khi tạo worktree. Workspace giữ lại tại commit đã chụp; kiểm tra trước khi dùng.",
          );
        value.state = "ready";
      } catch (error) {
        value.state = "retained";
        value.issue =
          error instanceof Error ? error.message : "Không tạo được workspace.";
        await this.save(value);
        throw new Error(value.issue);
      }
      await this.save(value);
      return value;
    });
  }
  async list(projectId: string): Promise<OwnedWorkspace[]> {
    await this.base();
    const values: OwnedWorkspace[] = [];
    for (const id of await readdir(this.root)) {
      if (!z.string().uuid().safeParse(id).success) continue;
      try {
        const value = await this.read(id);
        if (value.projectId !== projectId) continue;
        try {
          await this.identity(value);
        } catch (error) {
          value.state = (await this.absent(value).catch(() => false))
            ? "missing"
            : "retained";
          value.issue =
            error instanceof Error
              ? error.message
              : "Không xác minh được workspace.";
        }
        values.push(value);
      } catch {
        /* Never adopt malformed or foreign directories. */
      }
    }
    return values.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async open(id: string): Promise<OwnedWorkspace> {
    return this.exclusive(async () => {
      const value = await this.read(id);
      await this.identity(value);
      if (value.state !== "ready")
        throw new Error("Kiểm tra phục hồi workspace trước khi mở.");
      return value;
    });
  }
  async owner(path: string): Promise<OwnedWorkspace | null> {
    if (!inside(this.root, path)) return null;
    const id = relative(this.root, path).split(/[\\/]/)[0];
    const value = await this.open(id);
    if (!inside(join(this.dir(id), "tree"), path))
      throw new Error("Source nằm ngoài worktree được sở hữu.");
    return value;
  }
  async verifyTask(id: string, baseHead: string): Promise<OwnedWorkspace> {
    const value = await this.read(id);
    const registration = await this.identity(value);
    if (
      value.state !== "ready" ||
      value.head !== baseHead ||
      registration.head !== baseHead ||
      !registration.detached
    )
      throw new Error(
        "Baseline/HEAD của task workspace đã thay đổi. Giữ dữ liệu để kiểm tra.",
      );
    return value;
  }
  async recover(id: string): Promise<OwnedWorkspace> {
    return this.exclusive(async () => {
      const value = await this.read(id);
      if (await this.absent(value)) {
        value.state = "missing";
        value.issue =
          "Chưa có worktree đăng ký hoặc dữ liệu source. Có thể dọn metadata sau khi xem trước.";
        await this.save(value);
        return value;
      }
      const registration = await this.identity(value, true);
      if (!registration.locked)
        await this.git(value.repository, [
          "worktree",
          "lock",
          "--reason",
          this.reason(value.id),
          join(this.dir(value.id), "tree"),
        ]);
      value.state = "ready";
      delete value.issue;
      await this.save(value);
      return value;
    });
  }
  private async clean(value: OwnedWorkspace): Promise<string> {
    if (this.referenced(join(this.dir(value.id), "tree")))
      throw new Error(
        "Workspace còn trong danh sách dự án hoặc được lượt chạy/hàng chờ tham chiếu. Giữ lại dữ liệu.",
      );
    if (await this.absent(value))
      return createHash("sha256").update(`missing:${value.id}`).digest("hex");
    const reg = await this.identity(value);
    if (!reg.detached || reg.head !== value.head)
      throw new Error(
        "Worktree có commit/branch khác baseline. Giữ lại kết quả; chưa hỗ trợ gộp ở V1.2A.",
      );
    const status = await this.git(join(this.dir(value.id), "tree"), [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--ignored=matching",
    ]);
    if (status)
      throw new Error(
        "Worktree còn file sửa, file mới hoặc file ignored. Giữ lại dữ liệu, không force xóa.",
      );
    return createHash("sha256")
      .update(JSON.stringify([reg, value.path, value.head, status]))
      .digest("hex");
  }
  async previewRemoval(id: string): Promise<WorkspaceRemoval> {
    return this.exclusive(async () => {
      const value = await this.read(id);
      const stamp = await this.clean(value);
      this.tickets.clear();
      const token = randomUUID();
      this.tickets.set(token, { id, stamp, expires: Date.now() + 60000 });
      return { token, id, path: value.path };
    });
  }
  async remove(token: string): Promise<void> {
    return this.exclusive(async () => {
      const ticket = this.tickets.get(token);
      this.tickets.delete(token);
      if (!ticket || ticket.expires < Date.now())
        throw new Error("Bản xem trước đã hết hạn. Kiểm tra lại.");
      const value = await this.read(ticket.id);
      if ((await this.clean(value)) !== ticket.stamp)
        throw new Error("Workspace đã đổi. Kiểm tra lại trước khi dọn.");
      const tree = join(this.dir(value.id), "tree");
      if (await this.absent(value)) {
        await unlink(join(this.dir(value.id), "manifest.json"));
        return;
      }
      // Only Git removes the validated worktree. Never recursive-delete a computed path.
      await this.git(value.repository, ["worktree", "unlock", tree]);
      try {
        await this.git(value.repository, ["worktree", "remove", tree]);
      } catch {
        await this.git(value.repository, [
          "worktree",
          "lock",
          "--reason",
          this.reason(value.id),
          tree,
        ]).catch(() => {});
        throw new Error("Git từ chối dọn worktree. Dữ liệu được giữ lại.");
      }
      await unlink(join(this.dir(value.id), "manifest.json"));
    });
  }
}
