import type { Run, RunEvent } from "../../shared/runs";
import type { FollowUp } from "../../shared/chat";
import type { ProjectOverviewData } from "../../shared/overview";
import { compactTimeline } from "../../shared/inspector";
import { projectMonitor } from "./monitor";
import { redact } from "../runtime/security";

export function projectOverview(
  projectId: string,
  runs: Run[],
  queue: FollowUp[],
  timelineRun: Run | null,
  events: RunEvent[],
  secrets: string[] = [],
): ProjectOverviewData {
  return {
    runs: runs
      .filter((run) => run.projectId === projectId)
      .slice(0, 12)
      .map((run) => {
        const progress = projectMonitor(
          projectId,
          run.settings,
          run,
          null,
        ).progress;
        return {
          id: run.id,
          projectId,
          projectName: redact(run.projectName, secrets, 160),
          prompt: redact(run.prompt, secrets, 160),
          role: run.role,
          model: redact(run.model, secrets, 200),
          state: run.state,
          createdAt: run.createdAt,
          endedAt: run.endedAt,
          conversationId: run.conversationId,
          summary: redact(run.summary, secrets, 320),
          error: redact(run.error, secrets, 240),
          permissions: ["running", "blocked", "queued"].includes(run.state)
            ? run.permissions.length
            : 0,
          integrationState: run.integration?.state ?? null,
          verified:
            progress.currentTasks > 0 &&
            progress.verifiedTasks === progress.currentTasks,
          changes: run.changes.length,
          hasWork:
            run.tasks.some((task) => ["work", "fix"].includes(task.kind)) ||
            run.changes.length > 0 ||
            run.commands.length > 0,
        };
      }),
    queue: queue
      .filter((q) => q.projectId === projectId)
      .slice(0, 50)
      .map((q) => ({
        id: q.id,
        conversationId: q.conversationId,
        prompt: redact(q.prompt, secrets, 160),
        state: q.state,
        reason: redact(q.reason, secrets, 240),
        createdAt: q.createdAt,
      })),
    timelineRunId: timelineRun?.projectId === projectId ? timelineRun.id : null,
    timeline:
      timelineRun?.projectId === projectId
        ? compactTimeline({
            run: timelineRun,
            events: events.filter(
              (e) => e.runId === timelineRun.id && e.type !== "TOOL_STARTED",
            ),
          })
            .slice(-12)
            .reverse()
        : [],
  };
}
