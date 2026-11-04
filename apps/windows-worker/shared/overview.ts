import type { RunSummary } from "./runs";
import type { TimelineEntry } from "./inspector";

export type OverviewRun = RunSummary & {
  endedAt: string | null;
  summary: string;
  error: string;
  permissions: number;
  integrationState: string | null;
  verified: boolean;
  changes: number;
};
export type OverviewQueued = {
  id: string;
  conversationId: string;
  prompt: string;
  state: "waiting" | "held";
  reason: string;
  createdAt: string;
};
export type ProjectOverviewData = {
  runs: OverviewRun[];
  queue: OverviewQueued[];
  timelineRunId: string | null;
  timeline: TimelineEntry[];
};
export type AttentionItem = {
  key: string;
  title: string;
  reason: string;
  label: string;
  action: string;
  runId: string | null;
  conversationId: string | null;
  at: string;
};

// Read-only navigation intents; runtime permissions and recovery stay in their
// existing Controller-backed views. Acknowledging/visiting never resolves an item.
export function attentionItems(data: ProjectOverviewData): AttentionItem[] {
  const runs = data.runs.flatMap((run): AttentionItem[] => {
    let label = "",
      action = "Xem chi tiết",
      reason = run.error;
    if (run.permissions && run.state !== "cancelling") {
      label = "Chờ cấp quyền";
      reason = `${run.permissions} yêu cầu quyền đang chờ`;
      action = "Xem quyền";
    } else if (run.state === "needs_input") {
      label = "Cần bổ sung";
      reason ||= "Lead cần thêm ngữ cảnh để tiếp tục.";
      action = "Bổ sung ngữ cảnh";
    } else if (run.integrationState === "conflict") {
      label = "Xung đột source";
      reason ||= "Cần xem xung đột trước khi tích hợp.";
    } else if (["failed", "interrupted", "blocked"].includes(run.state)) {
      label = run.state === "interrupted" ? "Bị gián đoạn" : "Cần xử lý";
      reason ||= "Mở chi tiết để xem lỗi và cách tiếp tục.";
    }
    if (!label) return [];
    return [
      {
        key: `run:${run.id}`,
        title: run.prompt,
        reason,
        label,
        action,
        runId: run.id,
        conversationId: run.conversationId ?? null,
        at: run.endedAt ?? run.createdAt,
      },
    ];
  });
  return [
    ...runs,
    ...data.queue
      .filter((q) => q.state === "held")
      .map((q) => ({
        key: `queue:${q.id}`,
        title: q.prompt,
        reason: q.reason || "Yêu cầu đang tạm giữ.",
        label: "Hàng đợi tạm giữ",
        action: "Mở hàng đợi",
        runId: null,
        conversationId: q.conversationId,
        at: q.createdAt,
      })),
  ].sort(
    (a, b) =>
      Number(b.label === "Chờ cấp quyền") -
        Number(a.label === "Chờ cấp quyền") || b.at.localeCompare(a.at),
  );
}
