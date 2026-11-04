import { coordinate, TeamBlocked } from "../team/coordinator";
import {
  commandArtifactId,
  sourceVersion,
  upsertCommand,
} from "../team/evidence";
import { loadProfiles } from "../team/profiles";
import { inferWorkType, loadSkillCatalog, selectSkills } from "../team/skills";
import { rolePolicy, runtimeContext, sourcePolicyError } from "../team/policy";
import { ExecutionStopped } from "../runtime/stopped";
import type { TeamTask } from "../../shared/team";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Event, ToolPart } from "@opencode-ai/sdk/v2/client";
import type { Role, Settings } from "../../shared/contracts";
import type { FollowUp } from "../../shared/chat";
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
import { captureGit } from "../workspace/git-evidence";
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
  visibleSteps?: Map<string, string>;
  lastTextAt?: number;
  sourceObservation?: { version: string; at: number };
};
export class RunController {
  private active?: Active;
  private workspaceBusy = false;
  private workspaceTask?: Promise<unknown>;
  isBusy(): boolean {
    return !!this.active || this.workspaceBusy;
  }
  assertWorkspaceIdle(): void {
    if (this.active || this.workspaceBusy)
      throw new Error("Dừng lượt đang chạy trước khi khôi phục file.");
  }
  async workspaceAction<T>(fn: () => Promise<T>): Promise<T> {
    this.assertWorkspaceIdle();
    if (this.shuttingDown) throw new Error("Ứng dụng đang đóng.");
    this.workspaceBusy = true;
    try {
      const task = fn();
      this.workspaceTask = task;
      return await task;
    } finally {
      this.workspaceBusy = false;
      this.workspaceTask = undefined;
    }
  }
  private shuttingDown = false;
  constructor(
    private store: Store,
    private directory: string,
    private readKey: () => string | undefined,
  ) {
    store.interruptRuns();
    store.queue.hold(
      "Ứng dụng đã mở lại. Chọn Chạy tiếp để tiếp tục hàng chờ.",
    );
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
            conversationId,
          }) => ({
            id,
            projectId,
            projectName,
            prompt: prompt.slice(0, 320),
            role,
            model,
            state,
            createdAt,
            conversationId,
          }),
        ),
    };
  }
  detail(id: string): RunDetail {
    return { run: this.store.run(id), events: this.store.events(id) };
  }
  start(
    projectId: string,
    prompt: string,
    role: Role,
    mode: "direct" | "team" = "direct",
    conversationId?: string,
    retryOf?: string,
    settingsSnapshot?: Settings,
  ): Run {
    if (this.shuttingDown) throw new Error("Ứng dụng đang đóng.");
    if (this.workspaceBusy)
      throw new Error(
        "Đang khôi phục file. Chờ thao tác kết thúc trước khi chạy.",
      );
    if (mode === "team") role = "lead";
    if (this.active)
      throw new Error(
        "Chỉ chạy một yêu cầu tại một thời điểm. Dừng task hiện tại trước.",
      );
    const project = this.store.project(projectId);
    const settings = settingsSnapshot ?? this.store.settings();
    const agent = settings.agents.find((a) => a.role === role);
    if (!settings.gatewayUrl)
      throw new Error("Cấu hình và lưu gateway trước khi chạy.");
    if (!agent?.enabled || !agent.model)
      throw new Error(
        `Bật và chọn model cho ${role.toUpperCase()} trong Đội agent.`,
      );
    const key = this.readKey();
    const context = conversationId
      ? this.store.conversations.context(conversationId, projectId)
      : undefined;
    const run: Run = {
      retryOf,
      attemptRoot: retryOf
        ? (this.store.run(retryOf).attemptRoot ?? retryOf)
        : undefined,
      conversationId,
      context,
      mode,
      tasks: [],
      profiles: loadProfiles(mode === "team" ? undefined : [role]),
      skillCatalog: loadSkillCatalog(),
      currentTaskId: null,
      fixRound: 0,
      review: null,
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
    if (mode === "direct")
      run.skillSelection = selectSkills(
        run.skillCatalog!,
        role,
        inferWorkType(role, prompt),
      );
    this.store.createRun(run);
    const active: Active = { run, secrets: key ? [key] : [], seen: new Set() };
    this.active = active;
    active.finished = Promise.resolve().then(() => {
      if (this.active === active) return this.execute(active, key);
    });
    return structuredClone(run);
  }
  private record(active: Active, type: string, text: string): void {
    this.store.updateRun(active.run, {
      type,
      text: redact(text, active.secrets),
    });
  }
  private check(active: Active): void {
    if (active.desired) throw new ExecutionStopped(active.desired);
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
      const canonical = await canonicalDirectory(run.workspace);
      if (canonical.toLowerCase() !== run.workspace.toLowerCase())
        throw new Error(
          "Đường dẫn source đã thay đổi. Chọn lại dự án trước khi chạy.",
        );
      this.check(active);
      const executable = resolveRuntime(run.settings.runtimePath);
      run.runtimeVersion = await runtimeVersion(executable);
      this.check(active);
      active.baseline = await snapshot(run.workspace, true, active.secrets);
      const gitBefore = await captureGit(run.workspace, true, active.secrets);
      this.store.evidence.begin(
        run.id,
        run.workspace,
        active.baseline,
        gitBefore,
      );
      active.baseline.blobs?.clear();
      run.baselineComplete = active.baseline.complete;
      if (
        run.mode === "direct" &&
        rolePolicy(run.role).readOnly &&
        !run.baselineComplete
      )
        throw new TeamBlocked(
          "Không thể xác minh toàn bộ phạm vi source chỉ đọc.",
        );
      this.check(active);
      run.state = "running";
      run.startedAt = new Date().toISOString();
      this.record(
        active,
        "RUN_STARTED",
        `${run.mode} · ${run.model} · OpenCode ${run.runtimeVersion}`,
      );
      if (run.mode === "team") {
        await coordinate(
          run,
          (task, prompt) => this.step(active, key, executable, task, prompt),
          (type, text) => this.record(active, type, text),
          () => this.check(active),
          this.store.evidence,
          active.secrets,
        );
      } else {
        run.summary = await this.step(active, key, executable);
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
      }
    } catch (error) {
      run.state =
        active.desired ??
        (error instanceof TeamBlocked ? "needs_input" : "failed");
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
          const after = await snapshot(run.workspace, true, active.secrets);
          this.store.evidence.finish(
            run.id,
            after,
            await captureGit(run.workspace, true, active.secrets),
          );
          run.changes = changes(active.baseline, after).slice(0, 500);
          run.baselineComplete &&= after.complete;
        } catch {
          run.baselineComplete = false;
        }
      }
      if (
        run.mode === "direct" &&
        rolePolicy(run.role).readOnly &&
        run.state === "completed"
      ) {
        const violation = sourcePolicyError(
          run.role,
          ["."],
          run.changes,
          run.baselineComplete,
        );
        if (violation) {
          run.state = "needs_input";
          run.error = violation;
        }
      }
      run.permissions = [];
      run.currentTaskId = null;
      for (const task of run.tasks) {
        if (["running", "blocked"].includes(task.state) && active.desired)
          task.state = active.desired === "cancelled" ? "cancelled" : "failed";
        if (task.state === "queued") task.state = "skipped";
        if (!task.endedAt) task.endedAt = new Date().toISOString();
      }
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
      if (!this.shuttingDown) {
        if (run.state === "completed") this.advance(run.id);
        else
          this.store.queue.hold(
            "Lượt trước chưa hoàn tất. Kiểm tra kết quả rồi chọn Chạy tiếp.",
            run.id,
          );
      }
    }
  }
  private async step(
    active: Active,
    key: string | undefined,
    executable: string,
    task?: TeamTask,
    prompt?: string,
  ): Promise<string> {
    this.check(active);
    const { run } = active;
    const context = runtimeContext(run, task, prompt);
    const remaining = run.settings.maxRequests - run.requests;
    if (remaining <= 0)
      throw new Error("Đã hết số request cho toàn bộ lượt chạy.");
    const base = run.requests;
    const model = task?.model ?? run.model;
    active.proxy = new ModelProxy(
      { ...run.settings, maxRequests: remaining },
      key,
      model,
      (count) => {
        run.requests = base + count;
        this.record(
          active,
          "MODEL_REQUEST",
          `Request ${run.requests}/${run.settings.maxRequests} · ${model} · ${task?.id ?? "direct"}`,
        );
      },
    );
    active.secrets.push(active.proxy.token);
    try {
      const url = await active.proxy.start();
      this.check(active);
      active.runtime = new OpenCodeRuntime(
        executable,
        join(this.directory, "runtime", run.id, task?.id ?? "direct"),
        {
          ...run,
          model,
          role: task?.role ?? run.role,
          settings: { ...run.settings, maxRequests: remaining },
        },
        { url, token: active.proxy.token },
        {
          text:
            task && !["work", "fix"].includes(task.kind)
              ? undefined
              : (text) => {
                  if (active.desired) return;
                  // Withhold the tail until final reconciliation, including any split credential.
                  const tail = Math.max(
                    128,
                    ...active.secrets.map((s) => s.length),
                  );
                  const visible = redact(text, active.secrets).slice(
                    0,
                    Math.max(0, text.length - tail),
                  );
                  if (task) {
                    active.visibleSteps ??= new Map();
                    active.visibleSteps.set(
                      task.id,
                      `### ${task.role.toUpperCase()} · ${task.title}\n\n${visible}`,
                    );
                  }
                  const combined = task
                    ? [...active.visibleSteps!.values()]
                        .join("\n\n")
                        .slice(-16000)
                    : visible;
                  if (
                    combined !== run.partialText &&
                    Date.now() - (active.lastTextAt ?? 0) >= 150
                  ) {
                    run.partialText = combined;
                    active.lastTextAt = Date.now();
                    this.store.updateRun(run);
                  }
                },
          event: (event, reconciled) => this.onEvent(active, event, reconciled),
          permission: (permission) => this.onPermission(active, permission),
          failure: (message) => {
            void this.stop(run.id, "failed", message).catch(() => {});
          },
        },
        context,
      );
      run.sessionId = await active.runtime.start();
      if (task) task.sessionId = run.sessionId;
      this.check(active);
      this.record(
        active,
        "SESSION_STARTED",
        `${task?.id ?? "direct"} · ${run.sessionId}`,
      );
      const source = sourceVersion(
        await snapshot(run.workspace, true, active.secrets),
      );
      active.sourceObservation = source
        ? { version: source, at: Date.now() }
        : undefined;
      this.check(active);
      const result = await active.runtime.prompt();
      this.check(active);
      if (result.error) throw new Error(result.error);
      if (!result.text.trim())
        throw new Error("Runtime kết thúc nhưng không có báo cáo cuối.");
      return redact(result.text, active.secrets);
    } finally {
      await active.runtime?.close();
      await active.proxy.close();
      active.runtime = undefined;
      active.proxy = undefined;
      this.check(active);
      if (run.permissions.length)
        throw new Error("Session kết thúc khi còn yêu cầu quyền.");
    }
  }
  private onPermission(active: Active, permission: Permission): void {
    if (active.desired) return;
    active.run.permissions.push({
      ...permission,
      patterns: permission.patterns.map((p) => redact(p, active.secrets)),
    });
    active.run.state = "blocked";
    const task = active.run.tasks.find(
      (t) => t.id === active.run.currentTaskId,
    );
    if (task) task.state = "blocked";
    this.record(
      active,
      "PERMISSION_REQUESTED",
      `${permission.permission}: ${permission.patterns.join("; ")}`,
    );
  }
  private async onEvent(
    active: Active,
    event: Event,
    reconciled = false,
  ): Promise<void> {
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
    const key = `${run.currentTaskId ?? "direct"}:${part.sessionID}:${part.id}:${state}`;
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
    if (part.type === "tool") await this.tool(active, part, reconciled);
  }
  private async tool(
    active: Active,
    part: ToolPart,
    reconciled: boolean,
  ): Promise<void> {
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
    // Anchor command evidence to an observation made BEFORE execution as well
    // as the post-command snapshot. Timestamps alone cannot detect deletions.
    const before = active.sourceObservation;
    const mutatesSource = ![
      "read",
      "glob",
      "grep",
      "list",
      "webfetch",
      "websearch",
      "todowrite",
      "todoread",
      "question",
    ].includes(part.tool);
    let observed: Awaited<ReturnType<typeof snapshot>> | undefined;
    if (mutatesSource && ["completed", "error"].includes(state.status)) {
      if (!reconciled)
        observed = await snapshot(run.workspace, true, active.secrets);
      const version = observed && sourceVersion(observed);
      active.sourceObservation = version
        ? { version, at: Date.now() }
        : undefined;
    }
    if (part.tool === "bash") {
      const rawOutput =
        state.status === "completed"
          ? state.output
          : state.status === "error"
            ? state.error
            : "";
      const fullOutput = redact(rawOutput, active.secrets, 256000);
      const attemptId = run.currentTaskId ?? "direct";
      const sessionId = part.sessionID;
      const artifactId = commandArtifactId(
        run.id,
        attemptId,
        sessionId,
        part.callID,
      );
      const result = {
        artifactId,
        artifactHash: createHash("sha256").update(fullOutput).digest("hex"),
        sessionId,
        sourceVersion: undefined as string | undefined,
        cwd: redact(String(input.workdir ?? run.workspace), active.secrets),
        startedAt: state.time.start,
        endedAt: "end" in state.time ? state.time.end : undefined,
        outputTruncated: fullOutput.length > 16000 || rawOutput.length > 256000,
        taskId: run.currentTaskId ?? undefined,
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
      if (upsertCommand(run.commands, result)) {
        this.store.evidence.saveCommand(run.id, artifactId, fullOutput);
        // Final-message reconciliation may arrive long after execution: keep its
        // output, but never invent a source version from that late observation.
        if (
          !reconciled &&
          state.status === "completed" &&
          result.exitCode === 0
        ) {
          const version = observed && sourceVersion(observed);
          if (
            before &&
            before.at <= state.time.start &&
            before.version === version &&
            (observed?.latestMtime ?? Infinity) <= state.time.start
          )
            result.sourceVersion = version;
        }
      } else {
        throw new TeamBlocked(
          "Đã hết giới hạn 100 command evidence; không thể xác minh thêm lệnh.",
        );
      }
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
    const task = active.run.tasks.find(
      (t) => t.id === active.run.currentTaskId,
    );
    if (task)
      task.state = active.run.permissions.length ? "blocked" : "running";
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
    this.store.queue.hold(
      "Lượt trước đã dừng. Kiểm tra kết quả rồi chọn Chạy tiếp.",
      id,
    );
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
    this.shuttingDown = true;
    await this.workspaceTask;
    this.store.queue.hold("Ứng dụng đã đóng. Chọn Chạy tiếp để tiếp tục.");
    if (this.active) await this.stop(this.active.run.id);
  }
  enqueue(
    projectId: string,
    conversationId: string,
    prompt: string,
    role: Role,
    mode: "direct" | "team",
  ): FollowUp {
    this.store.project(projectId);
    this.store.conversations.context(conversationId, projectId);
    const settings = this.store.settings();
    if (mode === "team") role = "lead";
    if (
      !settings.gatewayUrl ||
      !settings.agents.find((a) => a.role === role && a.enabled && a.model)
    )
      throw new Error("Lưu gateway và chọn model trước khi thêm hàng chờ.");
    const held = this.store.queue
      .list(conversationId)
      .some((q) => q.state === "held");
    const waiting = !!this.active && !held;
    return this.store.queue.add({
      projectId,
      conversationId,
      prompt,
      role,
      mode,
      settings,
      afterRunId: this.active?.run.id ?? null,
      state: waiting ? "waiting" : "held",
      reason: waiting ? "" : "Chọn Chạy tiếp từ đầu hàng chờ để bắt đầu.",
    });
  }
  resume(id: string): Run {
    if (this.active) throw new Error("Một lượt khác đang chạy.");
    const item = this.store.queue.get(id);
    const all = this.store.queue.list();
    if (all.find((q) => q.conversationId === item.conversationId)?.id !== id)
      throw new Error("Chạy yêu cầu đầu hàng chờ trước.");
    const run = this.launchQueued(item);
    for (const next of this.store.queue.list())
      if (next.conversationId === item.conversationId)
        this.store.queue.save({
          ...next,
          state: "waiting",
          reason: "",
          afterRunId: run.id,
        });
    return run;
  }
  private launchQueued(item: FollowUp): Run {
    if (JSON.stringify(item.settings) !== JSON.stringify(this.store.settings()))
      throw new Error(
        "Cấu hình đã thay đổi. Xóa yêu cầu và gửi lại với cấu hình mới.",
      );
    const before = this.active;
    try {
      return this.store.queue.claim(item.id, (q) => {
        const run = this.start(
          q.projectId,
          q.prompt,
          q.role,
          q.mode,
          q.conversationId,
          undefined,
          q.settings,
        );
        return { id: run.id, value: run };
      });
    } catch (error) {
      // Claim and run insertion roll back together; a rolled-back run must never execute.
      if (this.active !== before) this.active = before;
      throw error;
    }
  }
  private advance(afterRunId: string): void {
    const item = this.store.queue
      .list()
      .find((q) => q.state === "waiting" && q.afterRunId === afterRunId);
    if (!item) return;
    try {
      this.launchQueued(item);
    } catch (error) {
      this.store.queue.hold(
        error instanceof Error ? error.message : "Không thể chạy yêu cầu tiếp.",
        afterRunId,
      );
    }
  }
  retry(id: string): Run {
    const previous = this.store.run(id);
    if (["queued", "running", "blocked", "cancelling"].includes(previous.state))
      throw new Error("Lượt này chưa kết thúc.");
    return this.start(
      previous.projectId,
      previous.prompt,
      previous.role,
      previous.mode,
      previous.conversationId ?? undefined,
      previous.id,
    );
  }
}
