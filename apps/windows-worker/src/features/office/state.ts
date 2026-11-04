import type { Role } from "../../../shared/contracts";
import { roles } from "../../../shared/defaults";
import {
  activityLabels,
  availabilityLabels,
  type AgentStatus,
} from "../../../shared/monitor";
import type { MonitorState } from "../../lib/monitor-store";

export const officeTones = {
  available: "#88bfa3",
  busy: "#83b9d5",
  attention: "#e5b868",
  muted: "#777b86",
  unknown: "#999da8",
} as const;
export type OfficeAgent = {
  role: Role;
  label: string;
  tone: keyof typeof officeTones;
  executions: AgentStatus["executions"];
  waiting: AgentStatus["waiting"];
};

function waitingLabel(reason: string) {
  if (reason === "Chờ dependency") return "Chờ phụ thuộc";
  if (reason === "Dependency cần xử lý") return "Vướng phụ thuộc";
  if (reason === "Chờ tích hợp source") return "Chờ tích hợp";
  return reason;
}
function agentView(role: Role, agent?: AgentStatus): OfficeAgent {
  const base = { role, executions: [], waiting: [] };
  if (!agent) return { ...base, label: "Chưa đồng bộ", tone: "unknown" };
  const { executions, waiting, availability } = agent;
  const work = { role, executions, waiting };
  if (executions.length) {
    // Permission and stop must remain visible even with another live lane.
    const urgent = executions.some((e) => e.activity === "stopping")
      ? "stopping"
      : executions.some((e) => e.activity === "waiting_input")
        ? "waiting_input"
        : null;
    return {
      ...work,
      label:
        executions.length === 1
          ? activityLabels[executions[0].activity]
          : `${executions.length} tác vụ${urgent ? ` · ${activityLabels[urgent]}` : ""}`,
      tone: urgent ? "attention" : "busy",
    };
  }
  if (["disabled", "unconfigured", "unknown"].includes(availability))
    return {
      ...work,
      label: availabilityLabels[availability],
      tone: availability === "unknown" ? "unknown" : "muted",
    };
  if (waiting.length)
    return {
      ...work,
      label:
        waiting.length === 1
          ? waitingLabel(waiting[0].reason)
          : `${waiting.length} đang chờ`,
      tone: "attention",
    };
  return {
    ...work,
    label: availabilityLabels[availability],
    tone: availability === "available" ? "available" : "unknown",
  };
}

export function selectOffice(state: MonitorState, projectId: string) {
  const snapshot = state.snapshot;
  const reliable =
    !!snapshot &&
    !state.stale &&
    !state.error &&
    snapshot.projectId === projectId;
  const agents = roles.map((role) =>
    agentView(
      role,
      reliable ? snapshot.agents.find((a) => a.role === role) : undefined,
    ),
  );
  return {
    reliable,
    agents,
    busy: reliable ? agents.filter((a) => a.executions.length).length : null,
    executions: reliable
      ? agents.reduce((n, a) => n + a.executions.length, 0)
      : null,
    waiting: reliable ? agents.reduce((n, a) => n + a.waiting.length, 0) : null,
    // Never derive verified progress from seats becoming idle or tasks finishing.
    progress: reliable ? snapshot.progress : null,
    otherProject:
      reliable && snapshot.activeRun?.projectId !== projectId
        ? (snapshot.activeRun?.projectName ?? null)
        : null,
  };
}
