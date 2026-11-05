import { createHash, randomUUID } from "node:crypto";
import { roles } from "../../shared/defaults";
import type { Settings } from "../../shared/contracts";
import type { Run } from "../../shared/runs";
import type { TeamTask } from "../../shared/team";
import type {
  AgentActivity,
  AgentExecution,
  AgentStatus,
  ExecutionObservation,
  MonitorReply,
  MonitorRequest,
  MonitorSnapshot,
} from "../../shared/monitor";
import { redact } from "../runtime/security";
import { workStateView } from "../../shared/work-state";
import type { ReportState } from "../../shared/reports";

const live = (state: string) =>
  ["queued", "running", "blocked", "cancelling"].includes(state);
const terminal = (state: string) =>
  ["completed", "failed", "cancelled", "skipped"].includes(state);

export function toolActivity(tool: string, task?: TeamTask): AgentActivity {
  if (["read", "glob", "grep", "list"].includes(tool)) return "reading";
  if (["write", "edit", "apply_patch", "patch", "multiedit"].includes(tool))
    return "editing";
  if (tool === "bash")
    return task?.workType === "testing" || task?.role === "test"
      ? "testing"
      : "command";
  return "running";
}

export function observationActivity(
  observation?: ExecutionObservation,
  task?: TeamTask,
): AgentActivity {
  if (!observation) return "preparing";
  if (observation.closed) return "finished";
  const tools = Object.values(observation.tools);
  if (tools.length) return tools.at(-1)!.activity;
  if (observation.pendingModels > 0) return "waiting_model";
  return task?.kind === "review" ? "reviewing" : "running";
}

// Reconciliation is evidence, not a live tool start. A late end closes only its own call.
export function observeTool(
  observation: ExecutionObservation,
  key: string,
  activity: AgentActivity,
  state: string,
  reconciled: boolean,
  at = new Date().toISOString(),
): void {
  if (observation.closed) return;
  if (state === "running" && observation.finishedCalls?.includes(key)) return;
  if (state === "running" && !reconciled && !observation.tools[key])
    observation.tools[key] = { activity, at };
  else if (["completed", "error"].includes(state)) {
    delete observation.tools[key];
    observation.finishedCalls = [
      ...new Set([...(observation.finishedCalls ?? []), key]),
    ].slice(-2000);
  }
  observation.at = at;
}

function execution(
  run: Run,
  task: TeamTask | undefined,
  secrets: string[],
): AgentExecution {
  const o = task?.observation ?? (!task ? run.observation : undefined);
  const taskId = task?.id ?? null;
  const permission = run.permissions.some((p) => (p.taskId ?? null) === taskId);
  return {
    executionId: o?.executionId ?? `${run.id}:${taskId ?? "direct"}:preparing`,
    runId: run.id,
    taskId,
    logicalTaskKey: `${run.id}:${task?.originalTaskId ?? taskId ?? "direct"}`,
    attemptKey: `${run.id}:${taskId ?? "direct"}`,
    title: redact(task?.title ?? run.prompt, secrets, 160),
    model: redact(task?.model ?? run.model, secrets, 200),
    activity:
      run.state === "cancelling"
        ? "stopping"
        : permission
          ? "waiting_input"
          : observationActivity(o, task),
    observedFrom: o ? "runtime" : "derived",
    startedAt: task?.startedAt ?? run.startedAt,
    activityAt: o?.at ?? task?.startedAt ?? run.startedAt,
  };
}

export function projectMonitor(
  projectId: string,
  settings: Settings,
  run: Run | null,
  active: Run | null,
  secrets: string[] = [],
  report?: ReportState,
): Omit<MonitorSnapshot, "epoch" | "revision" | "observedAt"> {
  // Latest attempt for each logical work item; plan/review and retries are not extra work.
  const current = new Map<string, TeamTask>();
  for (const task of run?.tasks ?? [])
    if (["work", "fix"].includes(task.kind))
      current.set(task.originalTaskId ?? task.id, task);
  const tasks = [...current.values()];
  const selectedActive = active?.projectId === projectId ? active : null;
  const verified =
    report?.report.runId === run?.id &&
    report?.report.projectId === projectId &&
    report?.report.verification === "pass" &&
    report.freshness !== "stale" &&
    run?.state === "completed" &&
    !!run.endedAt &&
    (!run.integration || run.integration.state === "verified") &&
    run.review?.status === "completed" &&
    "version" in run.review &&
    run.review.verification?.verified === true &&
    run.review.acceptance.every((a) => a.status === "passed") &&
    tasks.every((t) => t.state === "completed");
  const applicable = tasks.reduce((sum, t) => sum + t.acceptance.length, 0);
  const agents: AgentStatus[] = roles.map((role) => {
    const config = settings.agents.find((a) => a.role === role);
    const runningTasks =
      selectedActive?.tasks.filter(
        (t) => t.role === role && ["running", "blocked"].includes(t.state),
      ) ?? [];
    const executions = runningTasks.map((t) =>
      execution(selectedActive!, t, secrets),
    );
    // Direct runs and team preparation before Lead's first task also occupy a role.
    if (
      selectedActive &&
      !selectedActive.endedAt &&
      !selectedActive.tasks.length &&
      selectedActive.role === role
    )
      executions.push(execution(selectedActive, undefined, secrets));
    const finished = [...(run?.tasks ?? [])]
      .reverse()
      .find((t) => t.role === role && terminal(t.state));
    const directFinished =
      run?.mode === "direct" && run.role === role && !live(run.state);
    const waiting = (selectedActive?.tasks ?? [])
      .filter((t) => t.role === role && t.state === "queued")
      .map((t) => {
        const dependencies = t.dependsOn.map((id) =>
          id === t.originalTaskId
            ? selectedActive!.tasks.find((d) => d.id === id)
            : (current.get(id) ??
              selectedActive!.tasks.find((d) => d.id === id)),
        );
        const broken = dependencies.some(
          (d) =>
            !d ||
            ["failed", "cancelled", "skipped", "blocked"].includes(d.state),
        );
        const pending = dependencies.some((d) => d?.state !== "completed");
        const integration =
          selectedActive!.settings.teamExecution === "isolated-pair" &&
          dependencies.some(
            (dependency) =>
              !dependency ||
              !selectedActive!.integration?.taskIds.includes(dependency.id),
          );
        return {
          taskId: t.id,
          title: redact(t.title, secrets, 160),
          reason: broken
            ? "Dependency cần xử lý"
            : pending
              ? "Chờ dependency"
              : integration
                ? "Chờ tích hợp source"
                : "Chờ lượt",
        };
      });
    return {
      role,
      enabled: !!config?.enabled,
      configuredModel: config?.model
        ? redact(config.model, secrets, 200)
        : null,
      availability: executions.length
        ? "occupied"
        : !config?.enabled
          ? "disabled"
          : !config.model || !settings.gatewayUrl
            ? "unconfigured"
            : "available",
      executions,
      waiting,
      lastFinished: finished
        ? {
            taskId: finished.id,
            title: redact(finished.title, secrets, 160),
            at: finished.endedAt,
            outcome: finished.state,
          }
        : directFinished
          ? {
              taskId: null,
              title: redact(run!.prompt, secrets, 160),
              at: run!.endedAt,
              outcome: run!.state,
            }
          : null,
    };
  });
  return {
    projectId,
    workState: run
      ? workStateView(
          {
            ...run,
            error: redact(run.error, secrets, 240),
            tasks: run.tasks.map((task) => ({
              ...task,
              title: redact(task.title, secrets, 160),
            })),
          },
          { report },
        )
      : undefined,
    agents,
    activeRun: active
      ? {
          id: active.id,
          projectId: active.projectId,
          projectName: redact(active.projectName, secrets, 160),
          state: active.state,
        }
      : null,
    runId: run?.id ?? null,
    runState: run?.state ?? null,
    conversationId: run?.conversationId ?? null,
    progress: {
      currentTasks: run?.mode === "direct" ? 1 : tasks.length,
      executedTasks:
        run?.mode === "direct"
          ? Number(run.state === "completed")
          : tasks.filter((t) => t.state === "completed").length,
      verifiedTasks: verified ? tasks.length : 0,
      applicableCriteria: applicable,
      passedCriteria: verified ? applicable : 0,
      unverifiedCriteria: verified ? 0 : applicable,
    },
  };
}

export class MonitorProjection {
  readonly epoch = randomUUID();
  private revision = 0;
  private cache = new Map<string, { hash: string; revision: number }>();
  snapshot(
    request: MonitorRequest,
    data: ReturnType<typeof projectMonitor>,
  ): MonitorReply {
    const hash = createHash("sha256")
      .update(JSON.stringify(data))
      .digest("hex");
    const cacheKey = JSON.stringify([
      request.projectId,
      request.board ?? null,
      request.overview ?? false,
    ]);
    let entry = this.cache.get(cacheKey);
    if (!entry || entry.hash !== hash) {
      entry = { hash, revision: ++this.revision };
      if (this.cache.size >= 128)
        this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(cacheKey, entry);
    }
    const version = {
      epoch: this.epoch,
      revision: entry.revision,
      projectId: request.projectId,
      observedAt: new Date().toISOString(),
    };
    if (
      request.epoch === this.epoch &&
      request.sinceRevision === entry.revision
    )
      return { unchanged: true, ...version };
    return { unchanged: false, snapshot: { ...data, ...version } };
  }
}
