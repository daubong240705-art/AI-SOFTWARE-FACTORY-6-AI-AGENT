export type FileVersion = {
  hash: string | null;
  size: number;
  mode: number;
  reason?: string;
  stamp?: string;
};
export type GitEntry = {
  index: string;
  worktree: string;
  originalPath?: string;
};
export type GitEvidence = {
  root: string;
  head: string | null;
  indexHash: string | null;
  status: Record<string, GitEntry>;
  complete: boolean;
  metadataComplete?: boolean;
};
export type EvidenceFile = {
  path: string;
  kind: "added" | "modified" | "deleted";
  preExisting: boolean;
  before: FileVersion | null;
  after: FileVersion | null;
  gitBefore?: GitEntry;
  gitAfter?: GitEntry;
  renamedFrom?: string;
  renamedTo?: string;
};
export type EvidenceView = {
  runId: string;
  complete: boolean;
  finished: boolean;
  beforeAt: string;
  afterAt?: string;
  headBefore: string | null;
  headAfter: string | null;
  indexChanged: boolean;
  preExistingCount: number;
  files: EvidenceFile[];
  existing: EvidenceFile[];
};
export type FileDiff = {
  path: string;
  patch: string;
  binary: boolean;
  reason: string;
  canRestore: boolean;
  comparison: "run" | "staged" | "unstaged";
  restoreAction: string;
};
export type RestorePreview = {
  token: string;
  path: string;
  patch: string;
  action: string;
  expiresAt: string;
};
