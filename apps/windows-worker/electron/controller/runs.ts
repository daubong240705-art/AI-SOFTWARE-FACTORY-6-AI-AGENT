import { coordinate, TeamBlocked } from "../team/coordinator";
import {
  answerQuestionsSchema,
  answersPrompt,
  type AnswerQuestions,
} from "../../shared/questions";
import { reportDecisionSchema } from "../../shared/reports";
import {
  commandArtifactId,
  sourceVersion,
  upsertCommand,
} from "../team/evidence";
import { loadProfiles } from "../team/profiles";
import { inferWorkType, loadSkillCatalog, selectSkills } from "../team/skills";
import { rolePolicy, runtimeContext, sourcePolicyError } from "../team/policy";
import { ExecutionStopped } from "../runtime/stopped";
import { WorkerError, classifyFailure, failure } from "../runtime/failure";
import { emptyMetrics, addUsage, syncMetrics } from "../runtime/metrics";
import { autoApproves } from "../runtime/permissions";
import { recoverOwnedJobs } from "../runtime/owned-process";
import { Worktrees } from "../workspace/worktrees";
import { Integration } from "../workspace/integration";
import {
  checkpoint,
  inspectWorkspace,
  fingerprint,
} from "../workspace/checkpoint";
import type { RecoveryPreview } from "../../shared/lifecycle";
import type { ExecutionFailure } from "../../shared/execution";
import type { TeamTask } from "../../shared/team";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Event, ToolPart } from "@opencode-ai/sdk/v2/client";
import type { Role, Settings } from "../../shared/contracts";
import { settingsSchema } from "../../shared/contracts";
import {
  chatSendSchema,
  type ChatSend,
  type FollowUp,
  type WorkChatSnapshot,
} from "../../shared/chat";
import { withWorkContext } from "../../shared/work-context";
import type {
  Run,
  RunState,
  RunDetail,
  Permission,
  RuntimeView,
} from "../../shared/runs";
import { Store } from "../storage/database";
import { projectOverview } from "./overview";
import { workStateView } from "../../shared/work-state";
import { OpenCodeRuntime } from "../runtime/opencode";
import { ModelProxy } from "../gateway/model-proxy";
import { RequestBudget } from "../gateway/request-budget";
import { Executions } from "../runtime/executions";
import { canonicalDirectory } from "../workspace/projects";
import { changes, snapshot, type Snapshot } from "../workspace/snapshot";
import { captureGit } from "../workspace/git-evidence";
import {
  MonitorProjection,
  projectMonitor,
  observationActivity,
  observeTool,
  toolActivity,
} from "./monitor";
import {
  monitorRequestSchema,
  type MonitorRequest,
} from "../../shared/monitor";
import { resolveRuntime, runtimeVersion, redact } from "../runtime/security";
import { projectBoard } from "./board";
import {
  submitBoardItemSchema,
  type BoardSubmission,
} from "../../shared/board";

type ExecutionContext = {
  id: string;
  taskId: string | null;
  workspace: string;
  sessionId?: string;
  runtime?: OpenCodeRuntime;
  seen: Set<string>;
  approvedPermissions: Set<string>;
  sourceObservation?: { version: string; at: number };
  commandObservations?: Map<string, { version: string; at: number }>;
  closed: boolean;
};
type Active = {
  run: Run;
  runtime?: OpenCodeRuntime;
  proxy?: ModelProxy;
  budget?: RequestBudget;
  executions?: Executions;
  permissionRoutes?: Map<
    string,
    {
      runtime: OpenCodeRuntime;
      nativeId: string;
      taskId: string | null;
      execution?: ExecutionContext;
      resolving?: boolean;
    }
  >;
  baseline?: Snapshot;
  isolatedBaseline?: string;
  desired?: "cancelled" | "failed";
  stopError?: string;
  failure?: ExecutionFailure;
  secrets: string[];
  finished?: Promise<void>;
  seen: Set<string>;
  approvedPermissions?: Set<string>;
  visibleSteps?: Map<string, string>;
  lastTextAt?: number;
  sourceObservation?: { version: string; at: number };
  commandObservations?: Map<string, { version: string; at: number }>;
};
export class RunController {
  private monitorProjection = new MonitorProjection();
  monitor(input: MonitorRequest) {
    const request = monitorRequestSchema.parse(input);
    this.store.project(request.projectId);
    const active = this.active?.run ?? null;
    const run =
      active?.projectId === request.projectId
        ? active
        : this.store.latestProjectRun(request.projectId);
    const key = this.readKey();
    const secrets = [...(this.active?.secrets ?? []), ...(key ? [key] : [])];
    // Reconcile question references once before projecting any of the views.
    const pendingQuestions = this.store.questions.pending(request.projectId);
    const reportStates = this.store.reports.states(request.projectId);
    const data = projectMonitor(
      request.projectId,
      this.store.settings(),
      run,
      active,
      secrets,
      run ? reportStates.get(run.id) : undefined,
    );
    const stateFor = (source: Run) =>
      workStateView(
        {
          ...source,
          error: redact(source.error, secrets, 240),
          tasks: source.tasks.map((task) => ({
            ...task,
            title: redact(task.title, secrets, 160),
          })),
        },
        {
          questionState: this.store.questions.stateForRun(source.id),
          report: reportStates.get(source.id),
        },
      );
    if (run) data.workState = stateFor(run);
    if (request.overview) {
      const recent = this.store.recentProjectRuns(request.projectId);
      if (active?.projectId === request.projectId) {
        const index = recent.findIndex((r) => r.id === active.id);
        if (index >= 0) recent[index] = active;
        else recent.unshift(active);
      }
      data.overview = projectOverview(
        request.projectId,
        recent,
        this.store.queue.list(),
        run,
        run ? this.store.events(run.id, true) : [],
        secrets,
      );
      data.overview.questions = pendingQuestions.map((q) => ({
        ...q,
        summary: redact(q.summary, secrets, 160),
      }));
      data.overview.reports = this.store.reports
        .pending(request.projectId)
        .map((r) => ({ ...r, title: redact(r.title, secrets, 160) }));
      for (const item of data.overview.runs) {
        item.questionState = this.store.questions.stateForRun(item.id);
        const source = recent.find((candidate) => candidate.id === item.id);
        if (source) item.workState = stateFor(source);
        item.verified =
          reportStates.get(item.id)?.report.verification === "pass" &&
          item.workState?.freshness !== "stale";
      }
    }
    if (request.board)
      data.board = projectBoard(
        this.store.board.summaries(request.projectId),
        this.store.board.projectionLinks(request.projectId),
        this.store.boardRuns(request.projectId),
        this.store.queue.list(),
        request.board,
        secrets,
      );
    return this.monitorProjection.snapshot(request, data);
  }
  submitBoard(
    input: import("zod").z.infer<typeof submitBoardItemSchema>,
  ): BoardSubmission {
    const request = submitBoardItemSchema.parse(input);
    if (this.shuttingDown || this.workspaceBusy)
      throw new Error("Ứng dụng đang đóng hoặc đang xử lý workspace.");
    const before = this.active;
    try {
      return this.store.board.submit(request, (item) => {
        this.store.project(item.projectId);
        const conversationId =
          request.conversationId ??
          item.conversationId ??
          this.store.conversations.create(item.projectId).id;
        this.store.conversations.context(conversationId, item.projectId);
        const prompt = `${item.code} · yêu cầu v${item.revision}\n${item.title}\n\n${item.body}${item.criteria.length ? `\n\nTiêu chí hoàn thành:\n${item.criteria.map((text) => `- ${text}`).join("\n")}` : ""}${item.suggestedRole && item.suggestedRole !== "lead" ? `\nRole gợi ý: ${item.suggestedRole.toUpperCase()}. Lead chọn role cần thiết theo yêu cầu.` : ""}`;
        const queued = !!this.active || this.store.queue.list().length > 0;
        const next = queued
          ? this.enqueue(item.projectId, conversationId, prompt, "lead", "team")
          : this.start(item.projectId, prompt, "lead", "team", conversationId);
        return {
          itemId: item.id,
          runId: queued ? null : next.id,
          followUpId: queued ? next.id : null,
          conversationId,
          queued,
          createdAt: new Date().toISOString(),
        };
      });
    } catch (error) {
      if (this.active !== before) this.active = before;
      throw error;
    }
  }
  private active?: Active;
  async workReport(input: import("../../shared/reports").ReportRef) {
    const report = this.store.reports.capture(input);
    const current = await snapshot(report.workspace);
    return {
      ...this.store.reports.view(input, sourceVersion(current) ?? null),
      availability: this.reportAvailability(),
    };
  }
  reportAvailability() {
    return {
      changeBlocked:
        this.shuttingDown || this.workspaceBusy
          ? "Ứng dụng đang đóng hoặc xử lý workspace."
          : undefined,
      acceptBlocked:
        this.active || this.store.queue.list().length
          ? "Chờ lượt chạy và hàng chờ kết thúc trước khi nghiệm thu."
          : undefined,
    };
  }
  async reportDecision(input: import("../../shared/reports").ReportDecision) {
    const data = reportDecisionSchema.parse(input);
    const report = this.store.reports.capture(data);
    const current = await snapshot(report.workspace);
    const before = this.active;
    if (this.shuttingDown || this.workspaceBusy)
      throw new Error("Ứng dụng đang đóng hoặc xử lý workspace.");
    try {
      return this.store.reports.decide(
        data,
        sourceVersion(current) ?? null,
        (source) =>
          this.sendChat({
            requestId: data.requestId,
            projectId: source.projectId,
            conversationId: source.conversationId!,
            prompt: `Yêu cầu sửa báo cáo ${source.id}, lượt ${source.runId}, phiên bản ${source.work!.revision}.\n\nYêu cầu ban đầu:\n${this.store.reports.snapshotRun(source.runId).prompt.slice(0, 16000)}\n\nKết quả trước:\n${source.summary.slice(0, 6000)}\n\nNội dung cần sửa:\n${data.comment}`,
            role: "lead",
            mode: "team",
            workContext: {
              itemId: source.work!.itemId,
              revision: source.work!.revision,
            },
          }),
        () => {
          if (
            data.action === "accept" &&
            (this.active || this.store.queue.list().length)
          )
            throw new Error(
              "Chờ lượt chạy và hàng chờ kết thúc trước khi nghiệm thu.",
            );
        },
      );
    } catch (error) {
      if (this.active !== before) this.active = before;
      throw error;
    }
  }
  answerQuestions(input: AnswerQuestions) {
    const data = answerQuestionsSchema.parse(input),
      before = this.active;
    if (this.shuttingDown || this.workspaceBusy)
      throw new Error("Ứng dụng đang đóng hoặc xử lý workspace.");
    try {
      return this.store.questions.submit(data, (set, answers) => {
        const source = this.store.run(set.sourceRunId);
        if (source.integration)
          throw new Error("Mở bản tích hợp làm dự án để tiếp tục.");
        return this.sendChat({
          requestId: set.id,
          projectId: set.projectId,
          conversationId: set.conversationId,
          prompt: answersPrompt(set, source.prompt, answers),
          role: "lead",
          mode: "team",
          ...(source.leadAdmission ? { admission: "lead" as const } : {}),
          ...(set.workItemId
            ? {
                workContext: {
                  itemId: set.workItemId,
                  revision: set.revision!,
                },
              }
            : {}),
        });
      });
    } catch (error) {
      if (this.active !== before) this.active = before;
      throw error;
    }
  }
  sendChat(input: ChatSend) {
    const request = chatSendSchema.parse(input),
      before = this.active;
    if (this.shuttingDown || this.workspaceBusy)
      throw new Error("Ứng dụng đang đóng hoặc xử lý workspace.");
    try {
      return this.store.sendChat(request, (snapshot) => {
        const queued = !!this.active || this.store.queue.list().length > 0;
        const result = queued
          ? this.enqueue(
              request.projectId,
              request.conversationId,
              request.prompt,
              request.role,
              request.mode,
              snapshot,
              request.imageIds,
              request.admission === "lead",
            )
          : this.start(
              request.projectId,
              request.prompt,
              request.role,
              request.mode,
              request.conversationId,
              undefined,
              undefined,
              snapshot,
              request.imageIds,
              request.admission === "lead",
            );
        return {
          runId: queued ? null : result.id,
          followUpId: queued ? result.id : null,
        };
      });
    } catch (error) {
      if (this.active !== before) this.active = before;
      throw error;
    }
  }
  private recoveryTickets = new Map<
    string,
    { runId: string; fingerprint: string; expires: number }
  >();
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
    return {
      run: this.store.run(id),
      events: this.store.events(id),
      reportState: this.store.reports.state(id),
    };
  }
  start(
    projectId: string,
    prompt: string,
    role: Role,
    mode: "direct" | "team" = "direct",
    conversationId?: string,
    retryOf?: string,
    settingsSnapshot?: Settings,
    workContext?: WorkChatSnapshot,
    imageIds?: string[],
    leadAdmission = false,
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
    const settings = settingsSchema.parse(
      settingsSnapshot ?? this.store.settings(),
    );
    const agent = settings.agents.find((a) => a.role === role);
    if (!settings.gatewayUrl)
      throw new Error("Cấu hình và lưu gateway trước khi chạy.");
    if (!agent?.enabled || !agent.model)
      throw new Error(
        `Bật và chọn model cho ${role.toUpperCase()} trong Đội agent.`,
      );
    const key = this.readKey();
    const history = conversationId
      ? this.store.conversations.context(conversationId, projectId)
      : undefined;
    const context = workContext
      ? withWorkContext(history, workContext)
      : history;
    if (imageIds?.length) {
      if (!conversationId) throw Error("Ảnh cần gắn với hội thoại.");
      this.store.images.refs(projectId, conversationId, imageIds);
    }
    const run: Run = {
      shellPolicy: "role-auto-v1",
      leadAdmission,
      imageIds,
      workContext,
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
      metrics: emptyMetrics(),
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
  private record(
    active: Active,
    type: string,
    text: string,
    taskId = active.run.currentTaskId,
  ): void {
    syncMetrics(active.run);
    for (const task of active.run.tasks) syncMetrics(active.run, task);
    const owner = active.run.tasks.find((task) => task.id === taskId);
    const observation = taskId ? owner?.observation : active.run.observation;
    this.store.updateRun(active.run, {
      type,
      text: redact((taskId ? `${taskId} · ` : "") + text, active.secrets),
      metadata: {
        version: 1,
        taskId: taskId ?? null,
        executionId: observation?.executionId,
        activity: active.run.endedAt
          ? "finished"
          : active.run.state === "cancelling"
            ? "stopping"
            : active.run.permissions.some(
                  (permission) =>
                    (permission.taskId ?? null) === (taskId ?? null),
                )
              ? "waiting_input"
              : observationActivity(observation, owner),
      },
    });
  }
  private check(active: Active): void {
    if (active.desired)
      throw new ExecutionStopped(active.desired, active.failure);
  }
  private async execute(
    active: Active,
    key: string | undefined,
  ): Promise<void> {
    const { run } = active;
    const deadline = setTimeout(() => {
      void this.stop(
        run.id,
        "failed",
        "Đã hết thời gian chạy.",
        failure("deadline-exceeded", "Đã hết thời gian chạy."),
      ).catch(() => {});
    }, run.settings.timeoutMinutes * 60000);
    try {
      const canonical = await canonicalDirectory(run.workspace);
      await recoverOwnedJobs(this.directory);
      const owned = await new Worktrees(this.directory).owner(canonical);
      if (owned) {
        run.workspaceOrigin = {
          id: owned.id,
          source: owned.source,
          baseHead: owned.head,
        };
        this.record(active, "WORKSPACE_OWNED", owned.id);
      }
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
      checkpoint(run, "before-run", active.baseline, gitBefore);
      if (run.mode === "team" && run.settings.teamExecution === "isolated-pair")
        active.isolatedBaseline = fingerprint(run.checkpoints!.at(-1)!);
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
          "incomplete-snapshot",
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
        const worktrees = new Worktrees(this.directory, (path) =>
          this.store.workspaceReferenced(path),
        );
        const baseline = active.isolatedBaseline;
        const createOwned = async () => {
          this.check(active);
          if (fingerprint(await inspectWorkspace(run)) !== baseline)
            throw new TeamBlocked(
              "Source gốc đã đổi trước thao tác tích hợp.",
              "workspace-changed",
            );
          const owned = await worktrees.create(run.projectId, run.workspace);
          this.check(active);
          if (fingerprint(await inspectWorkspace(run)) !== baseline)
            throw new TeamBlocked(
              "Source gốc đổi khi tạo workspace.",
              "workspace-changed",
            );
          return owned;
        };
        const integration = new Integration(
          this.store,
          worktrees,
          run,
          createOwned,
          () => this.check(active),
          (type, text) => this.record(active, type, text, null),
          active.secrets,
        );
        await coordinate(
          run,
          (task, prompt) => this.step(active, key, executable, task, prompt),
          (type, text, taskId) => this.record(active, type, text, taskId),
          () => this.check(active),
          this.store.evidence,
          active.secrets,
          async (phase, source, taskId) => {
            checkpoint(
              run,
              phase,
              source,
              await captureGit(
                run.tasks.find((task) => task.id === taskId)?.workspace ??
                  run.workspace,
              ),
              taskId,
            );
            this.record(active, "CHECKPOINT", `${phase} · ${taskId}`);
          },
          {
            prepare: async (task) => {
              if (!run.tasks.includes(task)) run.tasks.push(task);
              await integration.initialize();
              this.check(active);
              if (fingerprint(await inspectWorkspace(run)) !== baseline)
                throw new TeamBlocked(
                  "Source gốc đổi trước khi tạo workspace task.",
                  "workspace-changed",
                );
              const owned = await createOwned();
              task.workspace = owned.path;
              task.workspaceOrigin = {
                id: owned.id,
                source: owned.source,
                baseHead: owned.head,
              };
              this.record(active, "TASK_WORKSPACE", owned.id, task.id);
              await integration.seed(owned);
              this.check(active);
              if (fingerprint(await inspectWorkspace(run)) !== baseline)
                throw new TeamBlocked(
                  "Source gốc đổi khi tạo workspace task.",
                  "workspace-changed",
                );
            },
            integrate: (task) => integration.accept(task),
            currentWorkspace: () => run.integration?.workspace ?? run.workspace,
            stop: (error) => {
              const reason = classifyFailure(error, active.secrets);
              void this.stop(run.id, "failed", reason.message, reason).catch(
                () => {},
              );
            },
          },
          (plan) => {
            if (!run.leadAdmission) return;
            this.check(active);
            run.workContext = this.store.admitPlan(run, plan);
            this.record(
              active,
              "WORK_LINKED",
              `${run.workContext.code} · v${run.workContext.revision}`,
              null,
            );
          },
        );
        if (run.integration && ["completed"].includes(run.state)) {
          await integration.validate();
          run.integration.state = "verified";
          this.record(
            active,
            "INTEGRATION_VERIFIED",
            run.integration.sourceVersion,
            null,
          );
        }
      } else {
        run.summary = await this.step(active, key, executable);
        if (
          run.commands.some((c) => c.status !== "completed" || c.exitCode !== 0)
        )
          throw new WorkerError(
            failure(
              "tool-test-failure",
              "Có lệnh công cụ thất bại. Xem kết quả để xử lý hoặc thử lại.",
            ),
          );
        run.state = "completed";
      }
    } catch (error) {
      run.failure =
        active.failure ??
        (error instanceof ExecutionStopped
          ? error.failure
          : classifyFailure(error, active.secrets));
      run.state =
        active.desired ??
        (error instanceof TeamBlocked || run.failure.code === "configuration"
          ? "needs_input"
          : "failed");
      run.error = redact(
        active.stopError ??
          (error instanceof Error ? error.message : "Runtime thất bại."),
        active.secrets,
      );
    } finally {
      clearTimeout(deadline);
      try {
        if (active.executions) await active.executions.stop();
        else {
          await active.runtime?.close();
          await active.proxy?.close();
        }
      } catch {
        run.state = "cancelling";
        run.error =
          "Chưa xác nhận dừng được tiến trình. Bấm Dừng để thử lại; task mới đang bị khóa.";
        run.failure ??= failure("runtime", run.error);
        this.record(active, "STOP_FAILED", run.error);
        return;
      }
      if (active.desired) {
        run.state = active.desired;
        run.error = active.stopError ?? "";
        run.failure = active.failure;
      }
      if (active.baseline) {
        try {
          const after = await snapshot(run.workspace, true, active.secrets);
          const finalGit = await captureGit(
            run.workspace,
            true,
            active.secrets,
          );
          checkpoint(run, "after-run", after, finalGit);
          if (
            active.isolatedBaseline &&
            !active.desired &&
            fingerprint(run.checkpoints!.at(-1)!) !== active.isolatedBaseline
          ) {
            run.state = "needs_input";
            run.error =
              "Source gốc đã đổi trong lượt chạy cô lập. Giữ kết quả từng task để đối chiếu baseline trước khi tích hợp.";
            run.failure = failure("workspace-changed", run.error);
          }
          this.store.evidence.finish(run.id, after, finalGit);
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
          run.failure = failure(
            run.baselineComplete ? "workspace-changed" : "incomplete-snapshot",
            run.baselineComplete
              ? "Source thay đổi trong lúc agent chỉ đọc. Chưa xác định tiến trình tạo thay đổi; giữ phản hồi và diff để kiểm tra."
              : violation,
          );
          run.error = run.failure.message;
        }
      }
      run.permissions = [];
      run.currentTaskId = null;
      for (const task of run.tasks) {
        if (["running", "blocked"].includes(task.state) && active.desired)
          task.state = active.desired === "cancelled" ? "cancelled" : "failed";
        if (
          active.desired &&
          ["cancelled", "failed"].includes(task.state) &&
          !task.failure
        )
          task.failure = active.failure;
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
        if (run.state === "completed" && !run.integration) this.advance(run.id);
        else
          this.store.queue.hold(
            run.integration
              ? "Kết quả nằm trong workspace tích hợp. Mở làm dự án trước khi chạy tiếp."
              : "Lượt trước chưa hoàn tất. Kiểm tra kết quả rồi chọn Chạy tiếp.",
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
    const role = task?.role ?? run.role;
    const configured = run.settings.agents.find(
      (agent) => agent.role === role && agent.enabled,
    )?.model;
    if (!configured || configured !== (task?.model ?? run.model))
      throw new WorkerError(
        failure(
          "configuration",
          `Model của ${role.toUpperCase()} không khớp cấu hình đã lưu. Chọn lại model và tạo lượt mới.`,
        ),
      );
    const workspace = task?.workspace ?? run.workspace;
    if (task?.workspace) {
      const owned = await new Worktrees(this.directory).owner(workspace);
      if (
        !owned ||
        owned.id !== task.workspaceOrigin?.id ||
        owned.head !== task.workspaceOrigin.baseHead
      )
        throw new TeamBlocked(
          "Ownership workspace của task không còn khớp.",
          "configuration",
        );
      await new Worktrees(this.directory).verifyTask(owned.id, owned.head);
      this.check(active);
    }
    const context = runtimeContext(run, task, prompt);
    if (run.conversationId && (!task || task.kind === "plan"))
      context.images = this.store.images.parts(
        run.projectId,
        run.conversationId,
        run.imageIds,
      );
    const remaining = run.settings.maxRequests - run.requests;
    if (remaining <= 0)
      throw new WorkerError(
        failure("budget-exhausted", "Đã hết số request cho toàn bộ lượt chạy."),
      );
    const budget = (active.budget ??= new RequestBudget(
      run.settings.maxRequests,
    ));
    const model = task?.model ?? run.model;
    const executions = (active.executions ??= new Executions());
    const execution = executions.open(randomUUID(), task?.id);
    const lane: ExecutionContext = {
      id: execution.id,
      taskId: task?.id ?? null,
      workspace,
      seen: new Set(),
      approvedPermissions: new Set(),
      closed: false,
    };
    const observation = {
      executionId: execution.id,
      startedAt: new Date().toISOString(),
      at: new Date().toISOString(),
      pendingModels: 0,
      tools: {} as import("../../shared/monitor").ExecutionObservation["tools"],
      closed: false,
    };
    if (task) task.observation = observation;
    else run.observation = observation;
    const proxy = new ModelProxy(
      { ...run.settings, maxRequests: remaining },
      key,
      model,
      (count) => {
        if (lane.closed) return;
        observation.pendingModels++;
        observation.at = new Date().toISOString();
        run.requests = budget.requests;
        if (task?.metrics) task.metrics.requests = count;
        this.record(
          active,
          "MODEL_REQUEST",
          `Request ${run.requests}/${run.settings.maxRequests} · ${model} · ${task?.id ?? "direct"}`,
          lane.taskId,
        );
      },
      (error) => {
        if (lane.closed) return;
        void this.stop(run.id, "failed", error.message, error).catch(() => {});
      },
      budget,
      () => {
        if (lane.closed) return;
        observation.pendingModels = Math.max(0, observation.pendingModels - 1);
        observation.at = new Date().toISOString();
        this.record(
          active,
          "MODEL_REQUEST_FINISHED",
          "Request model đã kết thúc.",
          lane.taskId,
        );
      },
    );
    active.secrets.push(proxy.token);
    execution.proxy = proxy;
    try {
      const url = await proxy.start();
      this.check(active);
      const runtime = new OpenCodeRuntime(
        executable,
        join(this.directory, "runtime", run.id, task?.id ?? "direct"),
        {
          ...run,
          workspace,
          model,
          role: task?.role ?? run.role,
          settings: { ...run.settings, maxRequests: remaining },
        },
        { url, token: proxy.token },
        {
          text:
            task && !["work", "fix"].includes(task.kind)
              ? undefined
              : (text) => {
                  if (active.desired || lane.closed) return;
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
          event: (event, reconciled) =>
            this.onEvent(active, event, reconciled, lane),
          permission: (permission) =>
            this.onPermission(active, permission, lane),
          failure: (message, reason) => {
            if (lane.closed) return;
            void this.stop(run.id, "failed", message, reason).catch(() => {});
          },
        },
        context,
      );
      execution.runtime = lane.runtime = runtime;
      lane.sessionId = await runtime.start();
      if (task) task.sessionId = lane.sessionId;
      else run.sessionId = lane.sessionId;
      this.check(active);
      this.record(
        active,
        "SESSION_STARTED",
        `${task?.id ?? "direct"} · ${lane.sessionId}`,
        lane.taskId,
      );
      const source = sourceVersion(
        await snapshot(workspace, true, active.secrets),
      );
      lane.sourceObservation = source
        ? { version: source, at: Date.now() }
        : undefined;
      this.check(active);
      const result = await runtime.prompt();
      this.check(active);
      if (result.error) throw new WorkerError(result.error);
      if (!result.text.trim())
        throw new Error("Runtime kết thúc nhưng không có báo cáo cuối.");
      return redact(result.text, active.secrets);
    } catch (error) {
      if (error instanceof ExecutionStopped || error instanceof TeamBlocked)
        throw error;
      const reason =
        error instanceof WorkerError
          ? classifyFailure(error, active.secrets)
          : (lane.runtime?.errorInfo(error) ??
            classifyFailure(error, active.secrets));
      throw new WorkerError(
        failure(reason.code, reason.message, active.secrets),
      );
    } finally {
      lane.closed = true;
      await executions.close(execution.id);
      observation.closed = true;
      observation.pendingModels = 0;
      observation.tools = {};
      observation.at = new Date().toISOString();
      this.check(active);
      if (task?.workspaceOrigin) {
        try {
          await new Worktrees(this.directory).verifyTask(
            task.workspaceOrigin.id,
            task.workspaceOrigin.baseHead,
          );
        } catch {
          throw new TeamBlocked(
            "Ownership hoặc HEAD của task workspace đã đổi; giữ kết quả để kiểm tra.",
            "workspace-changed",
          );
        }
      }
      if (
        [...(active.permissionRoutes?.values() ?? [])].some(
          (route) => route.execution === lane,
        )
      )
        throw new Error("Session kết thúc khi còn yêu cầu quyền.");
    }
  }
  private onPermission(
    active: Active,
    permission: Permission,
    lane?: ExecutionContext,
  ): void {
    if (this.active !== active || active.desired || lane?.closed) return;
    const taskId = lane ? lane.taskId : active.run.currentTaskId;
    const owner = active.run.tasks.find((t) => t.id === taskId);
    const runtime = lane ? lane.runtime : active.runtime;
    if (!runtime) return;
    if (
      permission.permission === "doom_loop" ||
      (permission.permission === "bash" &&
        !rolePolicy(owner?.role ?? active.run.role).allowShell)
    ) {
      const reason =
        permission.permission === "doom_loop"
          ? failure(
              "tool-loop",
              "Agent lặp công cụ mà không có tiến triển. Lượt chạy đã dừng; xem hoạt động và điều chỉnh yêu cầu trước khi thử lại.",
            )
          : failure(
              "permission-denied",
              "Vai trò này không được chạy Bash. Lead cần giao tác vụ cho role thực thi.",
            );
      active.desired = "failed";
      active.failure = reason;
      active.stopError = reason.message;
      this.record(active, "PERMISSION_AUTO_DENIED", reason.message, taskId);
      // Do not wait for a native reply to stop the owned process tree.
      void runtime.reply(permission.id, false).catch(() => {});
      void this.stop(active.run.id, "failed", reason.message, reason).catch(
        () => {},
      );
      return;
    }
    if (
      [...(active.permissionRoutes?.values() ?? [])].some(
        (route) =>
          route.runtime === runtime && route.nativeId === permission.id,
      )
    )
      return;
    if (
      autoApproves(permission.permission, {
        ...rolePolicy(owner?.role ?? active.run.role),
      })
    ) {
      const approved =
        lane?.approvedPermissions ?? (active.approvedPermissions ??= new Set());
      const permissionKey = `${owner?.id ?? "direct"}:${permission.id}`;
      if (approved.has(permissionKey)) return;
      approved.add(permissionKey);
      this.record(
        active,
        "PERMISSION_AUTO_APPROVED",
        `${permission.permission} · Tự động theo vai trò`,
        taskId,
      );
      void runtime?.reply(permission.id, true).catch((error) => {
        if (
          this.active === active &&
          (lane
            ? !lane.closed && lane.runtime === runtime
            : active.runtime === runtime) &&
          !active.desired
        )
          void this.stop(
            active.run.id,
            "failed",
            "Không thể tự duyệt quyền công cụ.",
            classifyFailure(error, active.secrets),
          ).catch(() => {});
      });
      return;
    }
    active.permissionRoutes ??= new Map();
    if (
      [...active.permissionRoutes.values()].some(
        (route) =>
          route.runtime === runtime && route.nativeId === permission.id,
      )
    )
      return;
    const ticket = active.executions ? randomUUID() : permission.id;
    active.permissionRoutes.set(ticket, {
      runtime,
      nativeId: permission.id,
      taskId: owner?.id ?? null,
      execution: lane,
    });
    active.run.permissions.push({
      ...permission,
      id: ticket,
      taskId: owner?.id,
      patterns: permission.patterns.map((p) => redact(p, active.secrets)),
    });
    active.run.state = "blocked";
    const task = owner;
    if (task) task.state = "blocked";
    this.record(
      active,
      "PERMISSION_REQUESTED",
      `${permission.permission}: ${permission.patterns.join("; ")}`,
      taskId,
    );
  }
  private async onEvent(
    active: Active,
    event: Event,
    reconciled = false,
    lane?: ExecutionContext,
  ): Promise<void> {
    const { run } = active;
    if (active.desired || lane?.closed) return;
    const taskId = lane ? lane.taskId : run.currentTaskId;
    const owner = run.tasks.find((task) => task.id === taskId);
    const sessionId = lane
      ? lane.sessionId
      : (owner?.sessionId ?? run.sessionId);
    const runtime = lane ? lane.runtime : active.runtime;
    if (
      sessionId &&
      "sessionID" in event.properties &&
      event.properties.sessionID !== sessionId
    )
      return;
    if (event.type === "session.error") {
      const message =
        runtime?.errorText(event.properties.error) ?? "Runtime báo lỗi.";
      void this.stop(
        run.id,
        "failed",
        message,
        runtime?.errorInfo(event.properties.error),
      ).catch(() => {});
      return;
    }
    if (event.type !== "message.part.updated") return;
    const part = event.properties.part;
    if (sessionId && part.sessionID !== sessionId) return;
    if (part.type === "reasoning" || part.type === "text") return; // Never store reasoning or raw streamed prompt fragments.
    const state = part.type === "tool" ? part.state.status : part.type;
    const key = `${taskId ?? "direct"}:${part.sessionID}:${part.id}:${state}`;
    const seen = lane?.seen ?? active.seen;
    if (seen.has(key)) return;
    seen.add(key);
    if (part.type === "step-finish") {
      run.inputTokens += part.tokens.input;
      run.outputTokens += part.tokens.output;
      if (run.metrics)
        addUsage(run.metrics, part.tokens.input, part.tokens.output);
      const task = owner;
      if (task?.metrics)
        addUsage(task.metrics, part.tokens.input, part.tokens.output);
      this.record(
        active,
        "MODEL_STEP",
        `Kết thúc bước model · input ${part.tokens.input}, output ${part.tokens.output}`,
        taskId,
      );
    }
    if (part.type === "tool") await this.tool(active, part, reconciled, lane);
  }
  private async tool(
    active: Active,
    part: ToolPart,
    reconciled: boolean,
    lane?: ExecutionContext,
  ): Promise<void> {
    const { run } = active;
    const workspace = lane?.workspace ?? run.workspace;
    const taskId = lane ? lane.taskId : run.currentTaskId;
    const observation = lane ?? active;
    const state = part.state;
    if (state.status === "pending") return;
    const task = run.tasks.find((t) => t.id === taskId);
    const monitor =
      task?.observation ?? (!taskId ? run.observation : undefined);
    if (monitor)
      observeTool(
        monitor,
        `${part.sessionID}:${part.callID}`,
        toolActivity(part.tool, task),
        state.status,
        reconciled,
      );
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
    const commandKey = `${taskId ?? "direct"}:${part.sessionID}:${part.callID}`;
    if (
      part.tool === "bash" &&
      state.status === "running" &&
      !reconciled &&
      observation.sourceObservation
    ) {
      // Parallel tool calls need the observation that preceded their own start,
      // not the observation updated when another command finishes.
      const observations = (observation.commandObservations ??= new Map());
      if (!observations.has(commandKey))
        observations.set(commandKey, { ...observation.sourceObservation });
    }
    const before =
      part.tool === "bash"
        ? (observation.commandObservations?.get(commandKey) ??
          observation.sourceObservation)
        : observation.sourceObservation;
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
        observed = await snapshot(workspace, true, active.secrets);
      const version = observed && sourceVersion(observed);
      if (lane?.closed || active.desired) return;
      observation.sourceObservation = version
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
      const attemptId = taskId ?? "direct";
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
        cwd: redact(String(input.workdir ?? workspace), active.secrets),
        startedAt: state.time.start,
        endedAt: "end" in state.time ? state.time.end : undefined,
        outputTruncated: fullOutput.length > 16000 || rawOutput.length > 256000,
        taskId: taskId ?? undefined,
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
    if (part.tool === "bash" && ["completed", "error"].includes(state.status))
      observation.commandObservations?.delete(commandKey);
    this.record(
      active,
      state.status === "completed"
        ? "TOOL_COMPLETED"
        : state.status === "error"
          ? "TOOL_FAILED"
          : "TOOL_STARTED",
      `${part.tool} · ${title}${state.status === "error" ? " · " + state.error : ""}`,
      taskId,
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
    const route = active.permissionRoutes?.get(requestId);
    const runtime =
      route?.runtime ?? (!active.executions ? active.runtime : undefined);
    if (
      !runtime ||
      active.desired ||
      route?.execution?.closed ||
      route?.resolving
    )
      throw new Error("Phiên yêu cầu quyền không còn hoạt động.");
    const nativeId = route?.nativeId ?? requestId;
    if (route) route.resolving = true;
    if (!allow) {
      const reason = failure(
        "permission-denied",
        "Quyền công cụ đã bị từ chối. Lượt chạy dừng để không tự thử cách khác.",
      );
      active.desired ??= "failed";
      active.failure ??= reason;
      active.stopError ??= reason.message;
      try {
        await runtime.reply(nativeId, false);
      } finally {
        if (this.active === active)
          await this.stop(runId, "failed", reason.message, reason);
      }
      return;
    }
    try {
      await runtime.reply(nativeId, true);
    } catch (error) {
      if (route) route.resolving = false;
      throw error;
    }
    if (this.active !== active || active.desired || route?.execution?.closed)
      return;
    const owner = active.run.tasks.find(
      (t) => t.id === (route?.taskId ?? active.run.currentTaskId),
    );
    const permission = active.run.permissions.find((p) => p.id === requestId);
    if (
      permission &&
      autoApproves(permission.permission, {
        ...rolePolicy(owner?.role ?? active.run.role),
      })
    ) {
      (
        route?.execution?.approvedPermissions ??
        (active.approvedPermissions ??= new Set())
      ).add(`${owner?.id ?? "direct"}:${nativeId}`);
    }
    active.run.permissions = active.run.permissions.filter(
      (p) => p.id !== requestId,
    );
    active.permissionRoutes?.delete(requestId);
    active.run.state = active.run.permissions.length ? "blocked" : "running";
    const task = active.run.tasks.find(
      (t) => t.id === (route?.taskId ?? active.run.currentTaskId),
    );
    if (task)
      task.state = [...(active.permissionRoutes?.values() ?? [])].some(
        (pending) => pending.taskId === task.id,
      )
        ? "blocked"
        : "running";
    this.record(
      active,
      "PERMISSION_RESOLVED",
      allow ? "Cho phép công cụ một lần." : "Đã từ chối công cụ.",
      route?.taskId ?? null,
    );
  }
  async stop(
    id: string,
    desired: "cancelled" | "failed" = "cancelled",
    error = "",
    reason?: ExecutionFailure,
  ): Promise<void> {
    const active = this.active;
    if (!active && desired === "cancelled") {
      const stored = this.store.run(id);
      if (stored.state === "interrupted") {
        stored.state = "cancelled";
        stored.endedAt = new Date().toISOString();
        stored.failure = failure(
          "cancelled",
          "Đã kết thúc lượt bị gián đoạn theo yêu cầu.",
        );
        stored.error = "";
        stored.permissions = [];
        this.store.updateRun(stored);
        this.store.event(id, "RUN_CANCELLED", stored.failure.message);
        this.recoveryTickets.clear();
        return;
      }
    }
    if (!active || active.run.id !== id)
      throw new Error("Lượt chạy không còn hoạt động.");
    active.desired ??= desired;
    active.failure ??= reason
      ? failure(reason.code, reason.message, active.secrets)
      : desired === "cancelled"
        ? failure("cancelled", "Đã dừng theo yêu cầu.")
        : classifyFailure(error, active.secrets);
    this.store.queue.hold(
      "Lượt trước đã dừng. Kiểm tra kết quả rồi chọn Chạy tiếp.",
      id,
    );
    active.stopError ??= redact(error, active.secrets);
    active.run.failure = active.failure;
    active.run.state = "cancelling";
    this.record(
      active,
      "RUN_CANCELLING",
      error || "Đang dừng runtime và tiến trình con.",
    );
    if (active.executions) await active.executions.stop();
    else {
      await active.runtime?.close();
      await active.proxy?.close();
    }
    await active.finished;
    // Retry path when a previous process-tree termination could not be confirmed.
    if (this.active === active) {
      active.run.state = active.desired;
      active.run.error = active.stopError ?? "";
      active.run.failure = active.failure;
      active.run.permissions = [];
      active.run.endedAt = new Date().toISOString();
      this.record(
        active,
        `RUN_${active.desired.toUpperCase()}`,
        active.stopError || "Đã dừng.",
      );
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
    workContext?: WorkChatSnapshot,
    imageIds?: string[],
    leadAdmission = false,
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
    this.store.images.refs(projectId, conversationId, imageIds);
    return this.store.queue.add({
      leadAdmission,
      imageIds,
      workContext,
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
    if (
      JSON.stringify(settingsSchema.parse(item.settings)) !==
      JSON.stringify(this.store.settings())
    )
      throw new Error(
        "Cấu hình đã thay đổi. Xóa yêu cầu và gửi lại với cấu hình mới.",
      );
    this.store.project(item.projectId);
    if (item.afterRunId && this.store.run(item.afterRunId).integration)
      throw new Error(
        "Mở bản tích hợp làm dự án để tiếp tục trên kết quả, hàng chờ cũ vẫn trỏ source gốc.",
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
          q.workContext,
          q.imageIds,
          q.leadAdmission,
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
    if (
      previous.integration ||
      previous.failure?.code === "integration-pending"
    )
      throw new Error(
        "Kết quả nằm trong workspace riêng. Mở Workspace để xem bản tích hợp; không phát lại lên source gốc.",
      );
    if (["queued", "running", "blocked", "cancelling"].includes(previous.state))
      throw new Error("Lượt này chưa kết thúc.");
    return this.start(
      previous.projectId,
      previous.prompt,
      previous.role,
      previous.mode,
      previous.conversationId ?? undefined,
      previous.id,
      undefined,
      previous.workContext,
      previous.imageIds,
      previous.leadAdmission,
    );
  }
  async recovery(id: string): Promise<RecoveryPreview> {
    return this.workspaceAction(() => this.inspectRecovery(id));
  }
  private async inspectRecovery(id: string): Promise<RecoveryPreview> {
    const run = this.store.run(id);
    if (run.integration || run.failure?.code === "integration-pending")
      throw new Error(
        "Kết quả nằm trong workspace riêng. Mở Workspace để xem và tiếp tục trên bản tích hợp; không phục hồi lên source gốc.",
      );
    if (
      !["interrupted", "failed", "needs_input", "cancelled"].includes(run.state)
    )
      throw new Error("Chỉ phục hồi lượt đã dừng hoặc bị gián đoạn.");
    if (
      (await canonicalDirectory(run.workspace)) !==
      this.store.project(run.projectId).path
    )
      throw new Error("Workspace không còn khớp dự án.");
    await recoverOwnedJobs(this.directory);
    const current = await inspectWorkspace(run);
    const last = run.checkpoints?.at(-1) ?? null;
    const token = randomUUID();
    this.recoveryTickets.clear();
    this.recoveryTickets.set(token, {
      runId: id,
      fingerprint: fingerprint(current),
      expires: Date.now() + 60000,
    });
    return {
      token,
      runId: id,
      checkpoint: last,
      changed: !last || fingerprint(last) !== fingerprint(current),
      complete: current.complete,
      message:
        "Tiếp tục tạo attempt mới, đọc source hiện tại và đánh giá lại phần còn lại. Không nối lại session hoặc chạy lại lệnh dang dở.",
    };
  }
  async continueRecovery(token: string): Promise<Run> {
    const previous = await this.workspaceAction(async () => {
      const ticket = this.recoveryTickets.get(token);
      this.recoveryTickets.delete(token);
      if (!ticket || ticket.expires < Date.now())
        throw new Error("Phiên kiểm tra phục hồi đã hết hạn. Kiểm tra lại.");
      const previous = this.store.run(ticket.runId);
      if (
        (await canonicalDirectory(previous.workspace)) !==
        this.store.project(previous.projectId).path
      )
        throw new Error("Workspace không còn khớp dự án.");
      await recoverOwnedJobs(this.directory);
      const current = await inspectWorkspace(previous);
      if (
        !current.complete ||
        fingerprint(current) !== ticket.fingerprint ||
        ticket.expires < Date.now()
      )
        throw new Error(
          "Source/Git đã đổi hoặc snapshot chưa đủ. Kiểm tra lại trước khi tiếp tục.",
        );
      return previous;
    });
    const next = this.start(
      previous.projectId,
      previous.prompt,
      previous.role,
      previous.mode,
      previous.conversationId ?? undefined,
      previous.id,
      undefined,
      previous.workContext,
      previous.imageIds,
      previous.leadAdmission,
    );
    const active = this.active!;
    active.run.recoveryOf = previous.id;
    const context = `Phục hồi có chủ đích từ ${previous.id}. Đây là attempt mới, không replay lệnh/session cũ. Đọc source hiện tại, xác minh phần đã làm rồi chỉ thực hiện phần còn thiếu. Lệnh trước có thể đã tạo side effect; không tự chạy lại chỉ vì bị gián đoạn.\nKết quả trước: ${previous.summary.slice(0, 4000)}\nLỗi trước: ${previous.error.slice(0, 1600)}\nTask trước: ${JSON.stringify(previous.tasks.map((t) => ({ id: t.id, role: t.role, state: t.state, summary: t.summary.slice(0, 1200) }))).slice(0, 8000)}`;
    active.run.context = {
      text: (context + "\n" + (active.run.context?.text ?? "")).slice(0, 14000),
      runIds: [
        ...new Set([previous.id, ...(active.run.context?.runIds ?? [])]),
      ],
    };
    this.record(active, "RECOVERY_STARTED", previous.id);
    return { ...next, recoveryOf: previous.id };
  }
}
