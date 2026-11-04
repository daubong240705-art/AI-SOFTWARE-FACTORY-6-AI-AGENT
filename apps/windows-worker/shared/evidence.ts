import { z } from "zod";

const identity = {
  runId: z.string().min(1).max(200),
  taskId: z.string().regex(/^t[1-9][0-9]?$/),
  attemptId: z.string().min(1).max(200),
  sessionId: z.string().min(1).max(200),
  sourceVersion: z.string().regex(/^[a-f0-9]{64}$/),
};
const fileIdentity = {
  ...identity,
  path: z.string().min(1).max(4096),
  hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
};
export const evidenceRefSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...identity,
      kind: z.literal("command"),
      artifactId: z.string().regex(/^cmd-v1-[a-f0-9]{64}$/),
      callId: z.string().min(1).max(200),
    })
    .strict(),
  z.object({ ...fileIdentity, kind: z.literal("file") }).strict(),
  z
    .object({
      ...fileIdentity,
      kind: z.literal("artifact"),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
]);
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export type TaskEvidence = {
  sourceVersion: string;
  files: Record<string, FileVersion | null>;
};
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
