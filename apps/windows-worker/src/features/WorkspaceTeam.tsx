import { AgentMonitor } from "./AgentMonitor";
import type { WorkspaceState } from "../lib/workspace-store";

export function WorkspaceTeam({
  state,
  onRefresh,
  onInspect,
  onSettings,
}: {
  state: WorkspaceState;
  onRefresh: () => void;
  onInspect: (
    projectId: string,
    runId: string,
    taskId?: string | null,
    executionId?: string,
  ) => void;
  onSettings: () => void;
}) {
  const data = state.data,
    active = data?.active;
  return (
    <section className="workspace-team" aria-label="Đội ngũ · Mọi dự án">
      {active && (
        <div className="workspace-team-active">
          <strong>
            {active.projectName} · {active.title}
          </strong>
          <span className="small muted">
            {active.workState.label}
            {active.workState.reason ? ` · ${active.workState.reason}` : ""}
          </span>
        </div>
      )}
      <AgentMonitor
        projectName="Mọi dự án"
        state={{
          error: state.error,
          stale: state.stale,
          snapshot: data
            ? {
                projectId: active?.projectId ?? "all-projects",
                observedAt: data.observedAt,
                activeRun: active ? { ...active, state: active.state } : null,
                runId: active?.id ?? null,
                runState: active?.state ?? null,
                conversationId: active?.conversationId ?? null,
                workState: active?.workState,
                agents: data.agents,
                progress: data.progress,
              }
            : null,
        }}
        onRefresh={onRefresh}
        onSettings={onSettings}
        onInspect={(runId, taskId, executionId) => {
          if (active && !state.stale && !state.error)
            onInspect(active.projectId, runId, taskId, executionId);
        }}
        onOpenRun={(runId) => {
          if (active && !state.stale && !state.error)
            onInspect(active.projectId, runId);
        }}
      />
    </section>
  );
}
