import type { ActivitySeat, OrgActivity } from '@/api/activityModels';
import type { Interaction, Office } from '@/api/officeModels';
import type { FlowRunDetail, FlowRunSummary, GroupsResponse, Project, Task } from '@factory/contracts';
import type { AgentProjectResponse } from '@/api/agentModels';
import type { Desk, FlowList, ProjectAttempt, ProjectInbox, nodeProgress } from '../../office/liveModel';
export type PodKey = 'lead' | 'a' | 'b' | 'c' | 'd' | 'east' | 'annex';
export type WorldAgent = {
  projectId: string;
  desk: Desk;
  projectColor: string;
  collaborationAt: string | null;
  workflowTask: boolean;
  seatId: string;
  ownerSeatId: string;
  seatName: string;
  slot: number;
  teamId: string;
  teamName?: string;
  paused?: boolean;
  name: string;
  role: string;
  isLead: boolean;
  slots: number;
  status: ActivitySeat['status'];
  pose: 'idle' | 'thinking' | 'working' | 'attention' | 'success' | 'error' | 'resting';
  podKey: PodKey;
  slotIndex: number;
  runs: ActivitySeat['runs'];
  queued: number;
  needsYou: ActivitySeat['needsYou'];
  lastFinished: ActivitySeat['lastFinished'];
  overflow: boolean;
  compact?: boolean;
};
export type TaskCard = {
  id: string;
  projectId: string;
  taskId: string;
  code: string;
  title: string;
  column: 'todo' | 'doing' | 'review' | 'failed' | 'done';
};
export type Endpoint = {
  kind: 'seat';
  seatId: string;
} | {
  kind: 'owner';
} | {
  kind: 'knowledge';
};
export type Handoff = {
  taskId?: string | null;
  id: string;
  at: string;
  kind: Interaction['kind'];
  from: Endpoint;
  to: Endpoint;
  code: string | null;
  text: string;
  projectId: string;
};
export type WorldModel = {
  generatedAt: string;
  loaded: {
    activity: boolean;
    projects: boolean;
    interactions: string[];
  };
  agents: WorldAgent[];
  hotProjects: Project[];
  recentProjects: Project[];
  groups?: GroupsResponse;
  projects: Project[];
  buildings: { id: string; name: string | null; rooms: Project[] }[];
  floorSouth: number;
  workflows: WorldRun[];
  workflowLoaded: boolean;
  stations: Record<string, { workflows?: WorldRun[]; approvalCount?: number }>;
  focusProjectId: string | null;
  tasks: {
    columns: Record<TaskCard['column'], TaskCard[]>;
    overflow: Record<TaskCard['column'], number>;
  };
  handoffs: Handoff[];
};
export type WorldRun = { run: FlowRunSummary; title: string; progress?: ReturnType<typeof nodeProgress> };
export type WorldInputs = {
  activity?: OrgActivity;
  projects?: Project[];
  interactions: Record<string, Office | undefined>;
  tasks: Record<string, Task[]>;
  rosters?: Record<string, AgentProjectResponse>;
  attempts?: Record<string, ProjectAttempt[]>;
  inboxes?: Record<string, ProjectInbox>;
  flows?: Record<string, FlowList>;
  runDetails?: Record<string, FlowRunDetail>;
  groups?: GroupsResponse;
  serverNow?: string;
  focusProjectId?: string | null;
};
export type Assignments = Record<string, {
  podKey: PodKey;
  slotIndex: number;
  overflow: boolean;
}>;
