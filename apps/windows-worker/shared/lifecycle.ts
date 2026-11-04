export type Checkpoint = {
  id: string;
  at: string;
  phase: string;
  taskId?: string;
  source: string | null;
  head: string | null;
  index: string | null;
  gitRoot: string | null;
  complete: boolean;
};
export type RecoveryPreview = {
  token: string;
  runId: string;
  checkpoint: Checkpoint | null;
  changed: boolean;
  complete: boolean;
  message: string;
};
export type ProjectCommand = { id: string; title: string; script: string };
export type LocalCommand = {
  id: string;
  projectId: string;
  title: string;
  startedAt: string;
  endedAt?: string;
  state: "running" | "stopping" | "completed" | "failed" | "interrupted";
  exitCode: number | null;
  output: string;
  url?: string;
};
export type RetentionPreview = {
  token: string;
  runIds: string[];
  count: number;
  protected: number;
};
