import { z } from "zod";
const hash = z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/);
const project = { projectId: z.string().uuid() };
export const gitSnapshotSchema = z
  .object({
    ...project,
    head: hash.optional(),
    offset: z.number().int().min(0).max(10000).default(0),
  })
  .strict();
export const gitDiffSchema = z
  .object({
    ...project,
    path: z.string().min(1).max(4096),
    comparison: z.enum(["staged", "unstaged"]),
  })
  .strict();
export type GitFile = { path: string; index: string; worktree: string };
export type GitCommit = {
  hash: string;
  subject: string;
  author: string;
  at: string;
  workItems: { id: string; code: string }[];
};
export type GitSnapshot = {
  projectId: string;
  checkedAt: string;
  available: boolean;
  reason: string;
  branch: string | null;
  head: string | null;
  files: GitFile[];
  filesTruncated: boolean;
  commits: GitCommit[];
  hasMore: boolean;
  nextOffset: number | null;
};
export type GitDiff = {
  path: string;
  checkedAt: string;
  patch: string;
  binary: boolean;
  reason: string;
};
export type GitSnapshotRequest = z.input<typeof gitSnapshotSchema>;
export type GitDiffRequest = z.infer<typeof gitDiffSchema>;
