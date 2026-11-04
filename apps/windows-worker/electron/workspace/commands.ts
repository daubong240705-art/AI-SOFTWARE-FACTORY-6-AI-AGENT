import { readFile, lstat, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { spawnOwned } from "../runtime/owned-process";
import { canonicalDirectory } from "./projects";
import { redact } from "../runtime/security";
import type { LocalCommand, ProjectCommand } from "../../shared/lifecycle";
import { z } from "zod";
import { StringDecoder } from "node:string_decoder";

const savedCommand = z.object({
  id: z.string().uuid(),
  projectId: z.string().max(200),
  title: z.string().max(200),
  startedAt: z.string().max(80),
  endedAt: z.string().max(80).optional(),
  state: z.enum(["running", "stopping", "completed", "failed", "interrupted"]),
  exitCode: z.number().int().nullable(),
  output: z.string().max(64000),
  url: z.string().max(2048).optional(),
});

export async function commandCatalog(
  workspace: string,
): Promise<ProjectCommand[]> {
  const root = await canonicalDirectory(workspace);
  const path = join(root, "package.json");
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
      return [];
    const json = JSON.parse(await readFile(path, "utf8"));
    return Object.entries(json.scripts ?? {})
      .filter(
        ([name, value]) =>
          /^[a-zA-Z0-9:_-]{1,80}$/.test(name) && typeof value === "string",
      )
      .slice(0, 50)
      .map(([id, value]) => ({
        id,
        title: `npm run ${id}`,
        script: redact(String(value)),
      }));
  } catch {
    return [];
  }
}
export class LocalCommands {
  private child?: ChildProcess;
  private starting?: Promise<LocalCommand>;
  private value?: LocalCommand;
  private exiting?: Promise<void>;
  private writes: Promise<unknown> = Promise.resolve();
  private saveTimer?: ReturnType<typeof setTimeout>;
  constructor(
    private directory: string,
    private secrets: () => string[],
    private change: () => void = () => {},
  ) {}
  async restore(): Promise<void> {
    try {
      const path = join(this.directory, "local-command.json");
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024)
        return;
      const value = savedCommand.parse(
        JSON.parse(await readFile(path, "utf8")),
      );
      this.value = {
        ...value,
        output: redact(value.output, this.secrets(), 64000),
      };
      if (["running", "stopping"].includes(value.state)) {
        this.value.state = "interrupted";
        this.value.exitCode = null;
        delete this.value.url;
      }
    } catch {
      /* No prior local command. */
    }
  }
  private persist(): void {
    if (!this.value) return;
    const content = JSON.stringify(this.value);
    this.writes = this.writes
      .catch(() => {})
      .then(async () => {
        const path = join(this.directory, "local-command.json");
        await writeFile(path + ".tmp", content);
        await rename(path + ".tmp", path);
      });
    void this.writes.catch(() => {});
  }
  view(): LocalCommand | null {
    return this.value ? structuredClone(this.value) : null;
  }
  busy(): boolean {
    return !!this.child || !!this.starting;
  }
  async start(
    projectId: string,
    workspace: string,
    script: string,
  ): Promise<LocalCommand> {
    if (this.busy()) throw new Error("Dừng lệnh local đang chạy trước.");
    this.starting = this.launch(projectId, workspace, script);
    try {
      return await this.starting;
    } finally {
      this.starting = undefined;
    }
  }
  private async launch(
    projectId: string,
    workspace: string,
    script: string,
  ): Promise<LocalCommand> {
    const root = await canonicalDirectory(workspace);
    const selected = (await commandCatalog(root)).find(
      (item) => item.id === script,
    );
    if (!selected)
      throw new Error("Lệnh không còn trong package.json. Tải lại danh sách.");
    const secrets = this.secrets();
    const env: NodeJS.ProcessEnv = {};
    for (const name of [
      "SystemRoot",
      "SYSTEMROOT",
      "WINDIR",
      "COMSPEC",
      "PATH",
      "PATHEXT",
      "TEMP",
      "TMP",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "HOME",
      "LANG",
    ])
      if (process.env[name]) env[name] = process.env[name];
    const value: LocalCommand = {
      id: randomUUID(),
      projectId,
      title: selected.title,
      state: "running",
      startedAt: new Date().toISOString(),
      output: "",
      exitCode: null,
    };
    this.value = value;
    // Shell text is fixed; the script name is an allowlisted package.json key.
    const exe =
      process.platform === "win32"
        ? join(process.env.SystemRoot ?? "C:\\Windows", "System32/cmd.exe")
        : "/bin/sh";
    const args =
      process.platform === "win32"
        ? ["/d", "/s", "/c", `npm run ${script}`]
        : ["-c", `npm run ${script}`];
    let child: ChildProcess;
    try {
      child = await spawnOwned(exe, args, root, env, this.directory);
    } catch (error) {
      value.state = "failed";
      value.endedAt = new Date().toISOString();
      this.persist();
      throw error;
    }
    this.child = child;
    this.persist();
    let raw = "";
    const collect = (data: string) => {
      raw = (raw + data).replace(/\x1b\[[0-9;]*m/g, "").slice(-64000);
      const clean = redact(raw.replace(/\x1b\[[0-9;]*m/g, ""), secrets, 64000);
      // Publish complete lines only; never expose a credential split across chunks.
      const safeEnd = raw.lastIndexOf("\n");
      value.output =
        safeEnd < 0 ? "" : redact(raw.slice(0, safeEnd + 1), secrets, 64000);
      const url = clean.match(
        /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+(?:\/[^\s]*)?/i,
      )?.[0];
      if (url) value.url = url;
      if (!this.saveTimer)
        this.saveTimer = setTimeout(() => {
          this.saveTimer = undefined;
          this.persist();
        }, 1000);
      this.change();
    };
    const stdout = new StringDecoder("utf8"),
      stderr = new StringDecoder("utf8");
    child.stdout?.on("data", (data) => collect(stdout.write(data)));
    child.stderr?.on("data", (data) => collect(stderr.write(data)));
    this.exiting = new Promise((ok) => {
      child.once("error", () => {
        value.output = "Không khởi chạy được công cụ local.";
      });
      child.once("close", (code) => {
        clearTimeout(this.saveTimer);
        this.saveTimer = undefined;
        value.exitCode = code;
        value.endedAt = new Date().toISOString();
        value.state =
          value.state === "stopping"
            ? "interrupted"
            : code === 0
              ? "completed"
              : "failed";
        value.output = redact(raw, secrets, 64000);
        this.child = undefined;
        this.persist();
        this.change();
        void this.writes.finally(ok).catch(() => {});
      });
    });
    return this.view()!;
  }
  async stop(): Promise<void> {
    await this.starting?.catch(() => {});
    if (!this.child) return;
    this.value!.state = "stopping";
    this.persist();
    this.child.stdin?.end();
    const exited = await new Promise<boolean>((ok) => {
      const timer = setTimeout(() => ok(false), 15000);
      void this.exiting!.then(() => {
        clearTimeout(timer);
        ok(true);
      });
    });
    if (!exited)
      throw new Error("Chưa xác nhận dừng lệnh local; không chạy lệnh mới.");
  }
}
