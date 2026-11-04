import { spawn, execFile, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { OpencodeClient, Config, Event } from "@opencode-ai/sdk/v2/client";
import type { Run, Permission } from "../../shared/runs";
import { redact } from "./security";

export type RuntimeHooks = {
  event: (event: Event) => void;
  permission: (permission: Permission) => void;
  failure: (message: string) => void;
};
export class OpenCodeRuntime {
  private child?: ChildProcess;
  private client?: OpencodeClient;
  private session?: string;
  private streamAbort = new AbortController();
  private streamTask?: Promise<void>;
  private closed = false;
  private closing?: Promise<void>;
  private processExit?: Promise<void>;
  private serverPassword = randomBytes(24).toString("hex");
  constructor(
    private executable: string,
    private root: string,
    private run: Run,
    private proxy: { url: string; token: string },
    private hooks: RuntimeHooks,
  ) {}
  async start(): Promise<string> {
    const { createOpencodeClient } = await import("@opencode-ai/sdk/v2/client");
    const env: NodeJS.ProcessEnv = {};
    // Do not leak provider credentials, editor integrations or SSH agents to tools.
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
    for (const dir of ["home", "config", "data", "state", "cache"])
      await mkdir(join(this.root, dir), { recursive: true });
    Object.assign(env, {
      HOME: join(this.root, "home"),
      XDG_CONFIG_HOME: join(this.root, "config"),
      XDG_DATA_HOME: join(this.root, "data"),
      XDG_STATE_HOME: join(this.root, "state"),
      XDG_CACHE_HOME: join(this.root, "cache"),
      OPENCODE_TEST_HOME: join(this.root, "home"),
      OPENCODE_TEST_MANAGED_CONFIG_DIR: join(this.root, "managed"),
      OPENCODE_DISABLE_PROJECT_CONFIG: "true",
      OPENCODE_DISABLE_AUTOUPDATE: "true",
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
      OPENCODE_DISABLE_EXTERNAL_SKILLS: "true",
      OPENCODE_DISABLE_CLAUDE_CODE: "true",
      OPENCODE_DISABLE_MODELS_FETCH: "true",
      OPENCODE_DISABLE_LSP_DOWNLOAD: "true",
      OPENCODE_SERVER_PASSWORD: this.serverPassword,
      ASF_EXECUTION_TOKEN: this.proxy.token,
    });
    const filePolicy = {
      "*": "allow",
      "**/.env": "deny",
      "**/.env.*": "deny",
      ".env": "deny",
      ".env.*": "deny",
      "**/*.pem": "deny",
      "**/*.key": "deny",
      "**/credentials.json": "deny",
      "**/auth.json": "deny",
      "**/.git/**": "deny",
    } as const;
    const config: Config = {
      model: `nine_router/${this.run.model}`,
      small_model: `nine_router/${this.run.model}`,
      enabled_providers: ["nine_router"],
      autoupdate: false,
      share: "disabled",
      snapshot: false,
      plugin: [],
      mcp: {},
      lsp: false,
      provider: {
        nine_router: {
          npm: "@ai-sdk/openai-compatible",
          name: "9Router",
          options: {
            baseURL: this.proxy.url,
            apiKey: "{env:ASF_EXECUTION_TOKEN}",
            timeout: 90000,
          },
          models: {
            [this.run.model]: {
              name: this.run.model,
              tool_call: true,
              limit: { context: 128000, output: 8192 },
            },
          },
        },
      },
      default_agent: "worker",
      agent: {
        worker: {
          mode: "primary",
          description: `Local ${this.run.role.toUpperCase()} coding worker`,
          steps: this.run.settings.maxRequests,
        },
      },
      permission: {
        "*": "deny",
        read: filePolicy,
        edit: filePolicy,
        glob: "allow",
        grep: "allow",
        list: "allow",
        bash: "ask",
        external_directory: "deny",
        todowrite: "allow",
        question: "deny",
        task: "deny",
        webfetch: "deny",
        websearch: "deny",
        skill: "deny",
        lsp: "deny",
        doom_loop: "ask",
      },
    };
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify(config);
    if (this.closed) throw new Error("Đã dừng trước khi runtime khởi động.");
    this.child = spawn(
      this.executable,
      ["serve", "--pure", "--hostname", "127.0.0.1", "--port", "0"],
      {
        cwd: this.run.workspace,
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.processExit = new Promise((resolve) =>
      this.child!.once("exit", () => resolve()),
    );
    const url = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(new Error("OpenCode không khởi động trong 30 giây.")),
        30000,
      );
      const fail = () => {
        clearTimeout(timer);
        reject(new Error("OpenCode kết thúc trước khi sẵn sàng."));
      };
      this.child!.once("error", fail);
      this.child!.once("exit", fail);
      this.child!.stdout?.on("data", (chunk) => {
        output = (output + chunk.toString()).slice(-8000);
        const match = output.match(
          /opencode server listening on (http:\/\/127\.0\.0\.1:\d+)/,
        );
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      this.child!.stderr?.on("data", () => {
        /* Runtime logs may contain prompts/config. Never persist raw stderr. */
      });
    });
    if (this.closed) throw new Error("Đã dừng trước khi runtime sẵn sàng.");
    this.client = createOpencodeClient({
      baseUrl: url,
      directory: this.run.workspace,
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`opencode:${this.serverPassword}`).toString("base64"),
      },
    });
    const health = await this.client.global.health({
      throwOnError: true,
      signal: AbortSignal.timeout(10000),
    });
    if (health.data?.version !== "1.19.5")
      throw new Error("Runtime server không khớp bản 1.19.5.");
    const result = await this.client.session.create(
      {
        directory: this.run.workspace,
        title: `${this.run.role.toUpperCase()} · ${this.run.id.slice(0, 8)}`,
      },
      { throwOnError: true, signal: AbortSignal.timeout(20000) },
    );
    if (!result.data) throw new Error("OpenCode không tạo được session.");
    this.session = result.data.id;
    const events = await this.client.event.subscribe(
      { directory: this.run.workspace },
      { signal: this.streamAbort.signal, sseMaxRetryAttempts: 1 },
    );
    const iterator = events.stream[Symbol.asyncIterator]();
    // Establish SSE before submitting a prompt; permission events must never be missed.
    await iterator.next();
    this.streamTask = (async () => {
      while (!this.streamAbort.signal.aborted) {
        const next = await iterator.next();
        if (next.done) break;
        const event = next.value;
        const properties = event.properties as Record<string, unknown>;
        if (properties.sessionID !== this.session) continue;
        this.hooks.event(event);
        if (event.type === "permission.asked")
          this.hooks.permission({
            id: event.properties.id,
            permission: event.properties.permission,
            patterns: event.properties.patterns,
          });
      }
      if (!this.closed && !this.streamAbort.signal.aborted)
        this.hooks.failure(
          "Mất kết nối sự kiện OpenCode; đã dừng tác vụ để tránh mất yêu cầu quyền.",
        );
    })().catch(() => {
      if (!this.closed && !this.streamAbort.signal.aborted)
        this.hooks.failure("Luồng sự kiện OpenCode bị gián đoạn.");
    });
    this.child!.once("exit", () => {
      if (!this.closed)
        this.hooks.failure("Tiến trình OpenCode đã kết thúc ngoài dự kiến.");
    });
    return this.session;
  }
  async prompt(): Promise<{ text: string; error: string }> {
    if (!this.client || !this.session)
      throw new Error("Runtime chưa sẵn sàng.");
    const result = await this.client.session.prompt(
      {
        sessionID: this.session,
        directory: this.run.workspace,
        agent: "worker",
        model: { providerID: "nine_router", modelID: this.run.model },
        system: `You are a ${this.run.role.toUpperCase()} coding agent. Work only in ${this.run.workspace}. Read existing project conventions first. Do not read credentials, modify .git, commit, push, or deploy. Use tools to make requested changes. Shell commands require explicit permission. Do not delegate. Report files changed, actual command results and limitations in Vietnamese. Never claim tests passed without command evidence.`,
        parts: [{ type: "text", text: this.run.prompt }],
      },
      { throwOnError: true, signal: this.streamAbort.signal },
    );
    const info = result.data?.info;
    const messages = await this.client.session.messages(
      { sessionID: this.session, directory: this.run.workspace },
      { throwOnError: true, signal: AbortSignal.timeout(10000) },
    );
    for (const message of messages.data ?? [])
      if (message.info.role === "assistant")
        for (const part of message.parts) {
          if (part.type === "tool" || part.type === "step-finish")
            this.hooks.event({
              id: `final-${part.id}`,
              type: "message.part.updated",
              properties: { sessionID: this.session, part, time: Date.now() },
            });
        }
    const text = (result.data?.parts ?? [])
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n");
    return {
      text,
      error:
        info && "error" in info && info.error
          ? this.errorText(info.error)
          : info?.finish === "tool-calls"
            ? "Runtime dừng khi công cụ chưa hoàn tất hoặc quyền đã bị từ chối."
            : "",
    };
  }
  errorText(error: unknown): string {
    const text = redact(
      JSON.stringify(error) ?? "Lỗi runtime không xác định.",
      [this.proxy.token, this.serverPassword],
    );
    if (/request_limit/i.test(text)) return "Đã hết số request cho lượt chạy.";
    if (/authentication|401|403|ProviderAuth/i.test(text))
      return "Gateway từ chối xác thực hoặc quyền model.";
    if (/429|rate.limit/i.test(text)) return "Gateway đang giới hạn request.";
    if (/TLS|certificate|network/i.test(text))
      return "Không kết nối được gateway hoặc lỗi chứng chỉ TLS.";
    return text.slice(0, 1200);
  }
  async reply(requestID: string, allow: boolean): Promise<void> {
    if (!this.client) throw new Error("Runtime không còn kết nối.");
    await this.client.permission.reply(
      {
        requestID,
        directory: this.run.workspace,
        reply: allow ? "once" : "reject",
      },
      { throwOnError: true, signal: AbortSignal.timeout(10000) },
    );
  }
  async close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = this.terminate().catch((error) => {
      this.closing = undefined;
      throw error;
    });
    return this.closing;
  }
  private async terminate(): Promise<void> {
    if (this.closed && (!this.child || this.child.exitCode !== null)) return;
    this.closed = true;
    if (this.client && this.session)
      await this.client.session
        .abort(
          { sessionID: this.session, directory: this.run.workspace },
          { signal: AbortSignal.timeout(3000) },
        )
        .catch(() => {});
    // Kill the owned process tree while the parent PID is still alive. No process-name matching.
    const child = this.child;
    if (child?.pid && child.exitCode === null) {
      if (process.platform === "win32")
        await new Promise<void>((resolve) => {
          execFile(
            join(
              process.env.SystemRoot ?? "C:\\Windows",
              "System32/taskkill.exe",
            ),
            ["/PID", String(child.pid), "/T", "/F"],
            { windowsHide: true, timeout: 7000 },
            () => resolve(),
          );
        });
      else child.kill("SIGTERM");
      await Promise.race([
        this.processExit,
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
      if (child.exitCode === null)
        throw new Error(
          "Chưa xác nhận dừng được runtime. Không chạy task mới.",
        );
    }
    this.streamAbort.abort();
    await this.streamTask;
  }
}
