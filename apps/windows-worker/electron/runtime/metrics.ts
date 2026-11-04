import type { ExecutionMetrics } from "../../shared/execution";
import type { Run } from "../../shared/runs";
import type { TeamTask } from "../../shared/team";
export function emptyMetrics(): ExecutionMetrics {
  return {
    version: 1,
    requests: 0,
    inputTokens: null,
    outputTokens: null,
    usageSteps: 0,
    usageSource: null,
    durationMs: null,
    commands: { passed: 0, failed: 0, incomplete: 0 },
    cost: null,
  };
}
export function addUsage(
  metrics: ExecutionMetrics,
  input: number,
  output: number,
): void {
  if (
    !Number.isFinite(input) ||
    !Number.isFinite(output) ||
    input < 0 ||
    output < 0
  )
    return;
  metrics.inputTokens = (metrics.inputTokens ?? 0) + input;
  metrics.outputTokens = (metrics.outputTokens ?? 0) + output;
  metrics.usageSteps++;
  metrics.usageSource = "opencode";
}
export function syncMetrics(run: Run, task?: TeamTask): void {
  const target = task ?? run;
  if (!target.metrics) return; // Never invent measurements for legacy history.
  const metrics = target.metrics;
  if (!task) metrics.requests = run.requests;
  const commands = task
    ? run.commands.filter((c) => c.taskId === task.id)
    : run.commands;
  metrics.commands = { passed: 0, failed: 0, incomplete: 0 };
  for (const c of commands) {
    if (c.status === "completed" && c.exitCode === 0) metrics.commands.passed++;
    else if (c.status === "error" || (c.exitCode !== null && c.exitCode !== 0))
      metrics.commands.failed++;
    else metrics.commands.incomplete++;
  }
  const start = target.startedAt;
  metrics.durationMs =
    start && target.endedAt
      ? Math.max(0, Date.parse(target.endedAt) - Date.parse(start))
      : null;
}
