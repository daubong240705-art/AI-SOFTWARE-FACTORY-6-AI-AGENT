import type { ActivitySeat, OrgActivity } from '@/api/activityModels';
import type { Interaction, Office } from '@/api/officeModels';
import type { OrgTeam } from '@/api/m3Models';
import type { GameReport, GameSummary, ReleaseView, PortalGame, PortalStats, Task } from '@factory/contracts';
import type { WorkflowDetail } from '@/api/readModels';
export type PodKey = 'lead' | 'design' | 'rules' | 'art' | 'client' | 'qa' | 'portal' | 'annex';
export type WorldAgent = {
  seatId: string;
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
export type Bug = {
  taskCode?: string;
  taskId?: string | null;
  id: string;
  projectId: string;
  criterion: string;
  evidence: string | null;
  state: 'open' | 'retesting';
};
export type GalleryItem = {
  projectId: string;
  gameId: string;
  name: string;
  version: number | null;
  playUrl: string | null;
  state: 'done' | 'pending' | 'failed';
  current: boolean;
  enabled: boolean | null;
  playing: number | null;
  releaseId: string;
};
export type TableStage = {
  key: string;
  state: string;
  loopCount: number;
};
export type PortalModel = {
  configured: boolean;
  onlineUsers: number | null;
  booths: {
    gameId: string;
    name: string;
    rooms: number;
    playing: number;
  }[];
};
export type ReleaseVersion = {
  projectId: string;
  version: number;
  releaseId: string;
  at: string;
};
export type WorldModel = {
  generatedAt: string;
  loaded: {
    activity: boolean;
    teams: boolean;
    games: boolean;
    interactions: string[];
    reports: string[];
    releases: string[];
  };
  agents: WorldAgent[];
  hotProjects: GameSummary[];
  games: GameSummary[];
  productionGames: number;
  focusProjectId: string | null;
  tasks: {
    columns: Record<TaskCard['column'], TaskCard[]>;
    overflow: Record<TaskCard['column'], number>;
  };
  stages: TableStage[];
  handoffs: Handoff[];
  bugs: Bug[];
  bugOverflow: number;
  /** All IDs prevent display limits from being mistaken for resolved bugs. */
  bugIds: string[];
  gallery: GalleryItem[];
  /** Latest completed publish per project, independent of the gallery's display cap. */
  releaseVersions: Record<string, ReleaseVersion>;
  portal: PortalModel;
};
export type WorldInputs = {
  activity?: OrgActivity;
  teams?: {
    teams: OrgTeam[];
  };
  games?: {
    games: GameSummary[];
  };
  interactions: Record<string, Office | undefined>;
  tasks: Record<string, Task[]>;
  /** Keyed by project ID. Details are checked against the game's instance ID. */
  workflows: Record<string, WorkflowDetail | undefined>;
  reports: Record<string, GameReport | undefined>;
  releases: Record<string, {
    enabled: boolean;
    releases: ReleaseView[];
  } | undefined>;
  portal?: {
    configured: boolean;
    projectId: string | null;
  };
  portalGames?: {
    games: PortalGame[];
  };
  portalStats?: PortalStats;
  serverNow?: string;
  focusProjectId?: string | null;
};
export type Assignments = Record<string, {
  podKey: PodKey;
  slotIndex: number;
  overflow: boolean;
}>;
