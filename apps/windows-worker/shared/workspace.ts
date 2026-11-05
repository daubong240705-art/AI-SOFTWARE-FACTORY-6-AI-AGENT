import { z } from "zod";
import type { InboxItem } from "./inbox";
import type { AgentStatus, MonitorSnapshot } from "./monitor";
import type { WorkStateView } from "./work-state";
import type { ReportState, ReportStatus } from "./reports";

export const resultQuerySchema = z
  .object({
    projectId: z.string().uuid().optional(),
    search: z.string().trim().max(200).default(""),
    includeHistory: z.boolean().default(false),
    verification: z.enum(["pass", "fail", "not-run", "unknown"]).optional(),
    before: z
      .object({ at: z.string().max(80), id: z.string().uuid() })
      .strict()
      .optional(),
  })
  .strict();
export type ResultQuery = z.input<typeof resultQuerySchema>;
export type ResultEntry = {
  id: string;
  runId: string;
  projectId: string;
  projectName: string;
  itemId: string | null;
  code: string | null;
  title: string;
  summary: string;
  at: string;
  verification: ReportStatus;
  state: ReportState;
};
export type ResultPage = {
  items: ResultEntry[];
  hasMore: boolean;
  next: { at: string; id: string } | null;
};
export type WorkspaceSummary = {
  scope: "all-projects";
  observedAt: string;
  attentionCount: number;
  attention: InboxItem[];
  results: ResultEntry[];
  active: {
    id: string;
    state: import("./runs").RunState;
    projectId: string;
    projectName: string;
    title: string;
    workState: WorkStateView;
    conversationId: string | null;
  } | null;
  agents: AgentStatus[];
  progress: MonitorSnapshot["progress"];
};
