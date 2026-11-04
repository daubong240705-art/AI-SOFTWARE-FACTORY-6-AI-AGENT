import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Event, ToolPart } from "@opencode-ai/sdk/v2/client";
import type { Role } from "../../shared/contracts";
import type {
  Run,
  RunState,
  RunDetail,
  Permission,
  RuntimeView,
} from "../../shared/runs";
import { Store } from "../storage/database";
import { OpenCodeRuntime } from "../runtime/opencode";
import { ModelProxy } from "../gateway/model-proxy";
import { canonicalDirectory } from "../workspace/projects";
import { changes, snapshot, type Snapshot } from "../workspace/snapshot";
import { resolveRuntime, runtimeVersion, redact } from "../runtime/security";

type Active = {
  run: Run;
  runtime?: OpenCodeRuntime;
  proxy?: ModelProxy;
  baseline?: Snapshot;
  desired?: "cancelled" | "failed";
  stopError?: string;
  secrets: string[];
  finished?: Promise<void>;
  seen: Set<string>;
};
export class RunController {
  private active?: Active;
  constructor(
    private store: Store,
    private directory: string,
    private readKey: () => string | undefined,
  ) {
    store.interruptRuns();
  }
  view(): RuntimeView {
    return {
      activeId: this.active?.run.id ?? null,
      runs: this.store
        .runs()
        .map(
          ({
            id,
            projectId,
            projectName,
            prompt,
            role,
            model,
            state,
            createdAt,
          }) => ({
            id,
            projectId,
            projectName,
            prompt: prompt.slice(0, 320),
            role,
            model,
            state,
            createdAt,
          }),
        ),
    };
  }
  detail(id: string): RunDetail {
    return { run: this.store.run(id), events: this.store.events(id) };
  }
  start(projectId: string, prompt: string, role: Role): Run {
    if (this.active)
      throw new Error(
        "Chỉ chạy một yêu cầu tại một thời điểm. Dừng task hiện tại trước.",
      );
    const project = this.store.project(projectId);
    const settings = this.store.settings();
    const agent = settings.agents.find((a) => a.role === role);
    if (!settings.gatewayUrl)
      throw new Error("Cấu hình và lưu gateway trước khi chạy.");
    if (!agent?.enabled || !agent.model)
      throw new Error(
        `Bật và chọn model cho ${role.toUpperCase()} trong Đội agent.`,
      );
    const key = this.readKey();
    const run: Run = {
      id: randomUUID(),
      projectId,
      projectName: project.name,
      workspace: project.path,
      prompt,
      role,
      model: agent.model,
      state: "queued",
      createdAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
      sessionId: null,
      summary: "",
      error: "",
      settings,
      changes: [],
      commands: [],
      permissions: [],
      requests: 0,
      baselineComplete: true,
      toolsCompleted: 0,
      runtimeVersion: "",
      inputTokens: 0,
      outputTokens: 0,
    };
    this.store.createRun(run);
    const active: Active = { run, secrets: key ? [key] : [], seen: new Set() };
    this.active = active;
    active.finished = this.execute(active, key);
    return structuredClone(run);
  }
  private record(active: Active, type: string, text: string): void {
    this.store.updateRun(active.run, {
      type,
      text: redact(text, active.secrets),
    });
  }
  private check(active: Active): void {
    if (active.desired) throw new Error("Đã yêu cầu dừng.");
  }
  private async execute(
    active: Active,
    key: string | undefined,
  ): Promise<void> {
    const { run } = active;
    const deadline = setTimeout(() => {
      void this.stop(run.id, "failed", "Đã hết thời gian chạy.").catch(
        () => {},
      );
    }, run.settings.timeoutMinutes * 60000);
    try {
      await canonicalDirectory(run.workspace);
      this.check(active);
      const executable = resolveRuntime(run.settings.runtimePath);
      run.runtimeVersion = await runtimeVersion(executable);
      this.check(active);
      active.baseline = await snapshot(run.workspace);
      run.baselineComplete = active.baseline.complete;
      this.check(active);
      active.proxy = new ModelProxy(run.settings, key, run.model, (count) => {
        run.requests = count;
        this.record(
          active,
          "MODEL_REQUEST",
          `Request ${count}/${run.settings.maxRequests} · ${run.model}`,
        );
      });
      active.secrets.push(active.proxy.token);
      const url = await active.proxy.start();
      this.check(active);
      active.runtime = new OpenCodeRuntime(
        executable,
        join(this.directory, "runtime", run.id),
        run,
        { url, token: active.proxy.token },
        {
          event: (event) => this.onEvent(active, event),
          permission: (permission) => this.onPermission(active, permission),
          failure: (message) => {
            void this.stop(run.id, "failed", message).catch(() => {});
          },
        },
      );
      run.sessionId = await active.runtime.start();
      this.check(active);
      run.state = "running";
      run.startedAt = new Date().toISOString();
      this.record(
        active,
        "RUN_STARTED",
        `${run.role.toUpperCase()} · ${run.model} · OpenCode ${run.runtimeVersion}`,
      );
      const result = await active.runtime.prompt();
      this.check(active);
      run.summary = redact(result.text, active.secrets);
      if (result.error) throw new Error(result.error);
      if (!run.summary)
        throw new Error("Runtime kết thúc nhưng không có báo cáo cuối.");
      if (
        run.commands.some(
          (c) =>
            c.status === "error" || (c.exitCode !== null && c.exitCode !== 0),
        )
      )
        throw new Error(
          "Có lệnh công cụ thất bại. Xem kết quả để xử lý hoặc thử lại.",
        );
      run.state = "completed";
    } catch (error) {
      run.state = active.desired ?? "failed";
      run.error = redact(
        active.stopError ??
          (error instanceof Error ? error.message : "Runtime thất bại."),
        active.secrets,
      );
    } finally {
      clearTimeout(deadline);
      try {
        await active.runtime?.close();
        await active.proxy?.close();
      } catch {
        run.state = "cancelling";
        run.error =
          "Chưa xác nhận dừng được tiến trình. Bấm Dừng để thử lại; task mới đang bị khóa.";
        this.record(active, "STOP_FAILED", run.error);
        return;
      }
      if (active.desired) {
        run.state = active.desired;
        run.error = active.stopError ?? "";
      }
      if (active.baseline) {
        try {
          const after = await snapshot(run.workspace);
          run.changes = changes(active.baseline, after).slice(0, 500);
          run.baselineComplete &&= after.complete;
        } catch {
          run.baselineComplete = false;
        }
      }
      run.permissions = [];
      for (const command of run.commands)
        if (["running", "pending"].includes(command.status)) {
          command.status =
            run.state === "cancelled" ? "cancelled" : "interrupted";
          command.output =
            command.output ||
            "Lệnh chưa có kết quả cuối; không được tính là đã đạt.";
        }
      run.endedAt = new Date().toISOString();
      this.record(
        active,
        `RUN_${run.state.toUpperCase()}`,
        run.state === "completed"
          ? "Runtime đã kết thúc. Xem báo cáo và kết quả lệnh để đánh giá yêu cầu."
          : run.error || "Đã dừng lượt chạy.",
      );
      if (this.active === active) this.active = undefined;
      active.secrets = [];
    }
  }
  private onPermission(active: Active, permission: Permission): void {
    if (active.desired) return;
    active.run.permissions.push({
      ...permission,
      patterns: permission.patterns.map((p) => redact(p, active.secrets)),
    });
    active.run.state = "blocked";
    this.record(
      active,
      "PERMISSION_REQUESTED",
      `${permission.permission}: ${permission.patterns.join("; ")}`,
    );
  }
  private onEvent(active: Active, event: Event): void {
    const { run } = active;
    if (active.desired) return;
    if (event.type === "session.error") {
      const message =
        active.runtime?.errorText(event.properties.error) ?? "Runtime báo lỗi.";
      void this.stop(run.id, "failed", message).catch(() => {});
      return;
    }
    if (event.type !== "message.part.updated") return;
    const part = event.properties.part;
    if (part.type === "reasoning" || part.type === "text") return; // Never store reasoning or raw streamed prompt fragments.
    const state = part.type === "tool" ? part.state.status : part.type;
    const key = `${part.id}:${state}`;
    if (active.seen.has(key)) return;
    active.seen.add(key);
    if (part.type === "step-finish") {
      run.inputTokens += part.tokens.input;
      run.outputTokens += part.tokens.output;
      this.record(
        active,
        "MODEL_STEP",
        `Kết thúc bước model · input ${part.tokens.input}, output ${part.tokens.output}`,
      );
    }
    if (part.type === "tool") this.tool(active, part);
  }
  private tool(active: Active, part: ToolPart): void {
    const { run } = active;
    const state = part.state;
    if (state.status === "pending") return;
    const input = state.input;
    const title = String(
      input.command ??
        input.filePath ??
        input.path ??
        input.pattern ??
        part.tool,
    );
    if (state.status === "completed") run.toolsCompleted++;
    if (part.tool === "bash") {
      const result = {
        callId: part.callID,
        command: redact(String(input.command ?? ""), active.secrets),
        status: state.status,
        output: redact(
          state.status === "completed"
            ? state.output
            : state.status === "error"
              ? state.error
              : "",
          active.secrets,
        ),
        exitCode:
          state.status === "completed" &&
          typeof state.metadata.exit === "number"
            ? state.metadata.exit
            : null,
      };
      const index = run.commands.findIndex(
        (command) => command.callId === part.callID,
      );
      if (index >= 0) run.commands[index] = result;
      else if (run.commands.length < 100) run.commands.push(result);
    }
    this.record(
      active,
      state.status === "completed"
        ? "TOOL_COMPLETED"
        : state.status === "error"
          ? "TOOL_FAILED"
          : "TOOL_STARTED",
      `${part.tool} · ${title}${state.status === "error" ? " · " + state.error : ""}`,
    );
  }
  async reply(runId: string, requestId: string, allow: boolean): Promise<void> {
    const active = this.active;
    if (
      !active ||
      active.run.id !== runId ||
      !active.run.permissions.some((p) => p.id === requestId)
    )
      throw new Error("Yêu cầu quyền đã hết hiệu lực.");
    await active.runtime!.reply(requestId, allow);
    if (this.active !== active || active.desired) return;
    active.run.permissions = active.run.permissions.filter(
      (p) => p.id !== requestId,
    );
    active.run.state = active.run.permissions.length ? "blocked" : "running";
    this.record(
      active,
      "PERMISSION_RESOLVED",
      allow ? "Cho phép công cụ một lần." : "Đã từ chối công cụ.",
    );
  }
  async stop(
    id: string,
    desired: "cancelled" | "failed" = "cancelled",
    error = "",
  ): Promise<void> {
    const active = this.active;
    if (!active || active.run.id !== id)
      throw new Error("Lượt chạy không còn hoạt động.");
    active.desired = desired;
    active.stopError = error;
    active.run.state = "cancelling";
    this.record(
      active,
      "RUN_CANCELLING",
      error || "Đang dừng runtime và tiến trình con.",
    );
    await active.runtime?.close();
    await active.proxy?.close();
    await active.finished;
    // Retry path when a previous process-tree termination could not be confirmed.
    if (this.active === active) {
      active.run.state = desired;
      active.run.error = error;
      active.run.permissions = [];
      active.run.endedAt = new Date().toISOString();
      this.record(active, `RUN_${desired.toUpperCase()}`, error || "Đã dừng.");
      this.active = undefined;
    }
  }
  async shutdown(): Promise<void> {
    if (this.active) await this.stop(this.active.run.id);
  }
}
