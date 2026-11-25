import type { ActivitySeat, OrgActivity } from '@/api/activityModels';
import type { Interaction, Office } from '@/api/officeModels';
import type { Project, Task } from '@factory/contracts';
export type PodKey = 'lead' | 'design' | 'rules' | 'art' | 'client' | 'qa' | 'annex';
/** One character per seat slot. `seatId` is the unique worker key (slot 0 keeps the real seat id, later slots add `#2`, `#3`);
 * `ownerSeatId` is the real seat for panels and API calls, `seatName` its name (characters are chosen by it). */
export type WorldAgent = {
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
  projects: Project[];
  focusProjectId: string | null;
  tasks: {
    columns: Record<TaskCard['column'], TaskCard[]>;
    overflow: Record<TaskCard['column'], number>;
  };
  handoffs: Handoff[];
};
export type WorldInputs = {
  activity?: OrgActivity;
  projects?: Project[];
  interactions: Record<string, Office | undefined>;
  tasks: Record<string, Task[]>;
  serverNow?: string;
  focusProjectId?: string | null;
};
export type Assignments = Record<string, {
  podKey: PodKey;
  slotIndex: number;
  overflow: boolean;
  /** Attempt this worker showed on the last poll, so a run keeps its character when another run ends. */
  run?: string;
}>;
