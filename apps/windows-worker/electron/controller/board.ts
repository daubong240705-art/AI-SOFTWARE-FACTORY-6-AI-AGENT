import type {
  BoardCard,
  BoardColumn,
  BoardPage,
  BoardQuery,
  BoardRun,
  BoardLink,
  BoardItem,
} from "../../shared/board";
import { latestBoardTasks } from "../../shared/board";
import type { FollowUp } from "../../shared/chat";
import { redact } from "../runtime/security";
import { workStateFromFacts } from "../../shared/work-state";
import type { RunState } from "../../shared/runs";

function runCard(run: BoardRun, secrets: string[]): BoardCard {
  const report =
    run.reportState?.report.runId === run.id &&
    run.reportState.report.projectId === run.projectId
      ? run.reportState
      : undefined;
  const workState = workStateFromFacts(
    {
      ...run,
      projectId: run.projectId ?? "",
      state: run.state as RunState,
      mode: run.mode === "team" ? "team" : "direct",
      permissionCount: run.permissionCount ?? 0,
      hasWork:
        run.tasks.some((task) => ["work", "fix"].includes(task.kind)) ||
        run.changes > 0 ||
        (run.commandCount ?? 0) > 0,
      error: redact(run.error, secrets, 240),
      tasks: run.tasks.map((task) => ({
        ...task,
        title: redact(task.title, secrets, 160),
      })),
    },
    { questionState: run.questionState, report },
  );
  const tasks = latestBoardTasks(run.tasks);
  const stopped =
    ["cancelled"].includes(run.state) ||
    (!!tasks.length &&
      tasks.every((t) => ["cancelled", "skipped"].includes(t.state)));
  const problematic =
    ["needs_input", "failed", "interrupted", "blocked"].includes(run.state) ||
    run.integrationState === "conflict";
  const evidenceVerified =
    run.state === "completed" &&
    tasks.length > 0 &&
    tasks.every((task) => task.state === "completed") &&
    run.reviewVerified &&
    report?.report.verification === "pass" &&
    report.freshness !== "stale" &&
    !!run.endedAt &&
    (!run.integrationState || run.integrationState === "verified");
  let column: BoardColumn = "ready",
    reason = "Chờ lượt";
  if (problematic || stopped) {
    column = "blocked";
    reason = stopped
      ? "Đã dừng / bỏ qua"
      : redact(
          run.error ||
            (run.integrationState === "conflict"
              ? "Xung đột source"
              : "Cần xử lý"),
          secrets,
          240,
        );
  } else if (run.state === "completed") {
    const verified =
      evidenceVerified &&
      report &&
      report.decision?.action !== "request-fix" &&
      (!report.policy.required || report.decision?.action === "accept");
    column = verified ? "done" : "review";
    reason = verified
      ? "Đã xác minh"
      : run.mode === "direct"
        ? "Đã thực thi, chưa xác minh acceptance"
        : !tasks.length
          ? "Có phản hồi, chưa có task"
          : "Kết quả chưa được xác minh";
  } else if (run.state === "cancelling") {
    column = "in_progress";
    reason = "Đang dừng lượt chạy";
  } else if (
    run.tasks.some(
      (t) => t.kind === "review" && ["running", "blocked"].includes(t.state),
    ) ||
    (tasks.length && tasks.every((t) => t.state === "completed"))
  ) {
    column = "review";
    reason = "Chờ TEST / Lead xác minh";
  } else if (run.state === "running") {
    column = "in_progress";
    reason =
      run.integrationState === "applying"
        ? "Đang tích hợp source"
        : "Đang thực thi";
  }
  if (
    ["queued", "running", "blocked", "cancelling", "needs_input"].includes(
      run.state,
    ) ||
    run.integrationState === "conflict"
  )
    reason =
      workState.blockers.length ||
      ["blocked", "needs_input"].includes(run.state)
        ? [workState.label, workState.reason].filter(Boolean).join(" · ")
        : workState.reason || workState.label;
  const verified = evidenceVerified;
  if (run.state === "completed" && report) {
    reason = [workState.label, workState.reason].filter(Boolean).join(" · ");
  }
  const criteria = tasks.reduce((sum, t) => sum + t.acceptanceCount, 0);
  return {
    workState,
    key: `run:${run.rootId}`,
    itemId: null,
    version: null,
    kind: "runtime",
    title: redact(run.prompt, secrets, 160),
    column,
    reason,
    role: run.role,
    roles: [...new Set([run.role, ...tasks.map((t) => t.role)])],
    priority: 0,
    position: -Date.parse(run.createdAt),
    archived: false,
    updatedAt: run.createdAt,
    runId: run.id,
    conversationId: run.conversationId,
    followUpId: null,
    stopped,
    progress: {
      tasks: run.mode === "direct" ? 1 : tasks.length,
      executed:
        run.mode === "direct"
          ? Number(run.state === "completed")
          : tasks.filter((t) => t.state === "completed").length,
      verified: verified ? tasks.length : 0,
      criteria,
      passed: verified ? criteria : 0,
    },
    workTypes: [
      ...new Set(tasks.flatMap((t) => (t.workType ? [t.workType] : []))),
    ],
    changes: run.changes,
  };
}
export function projectBoard(
  items: Omit<BoardItem, "body">[],
  links: BoardLink[],
  runs: Iterable<BoardRun>,
  queue: FollowUp[],
  query: BoardQuery,
  secrets: string[] = [],
): BoardPage {
  const byRun = new Map(
    links.filter((link) => link.runId).map((link) => [link.runId!, link]),
  );
  const byItem = new Map(items.map((item) => [item.id, item]));
  const cards: BoardCard[] = [];
  const extraSearch = new Map<string, string>();
  const rootIds = new Map<string, string>();
  const queriedItems = new Set(
    query.runId
      ? links
          .filter((link) => link.runId === query.runId)
          .map((link) => link.itemId)
      : [],
  );
  for (const run of runs) {
    const link = byRun.get(run.id),
      item = link ? byItem.get(link.itemId) : undefined;
    if (link?.current === false) continue;
    const card = runCard(run, secrets);
    if (item) {
      Object.assign(card, {
        key: `item:${item.id}`,
        itemId: item.id,
        code: item.code,
        version: item.version,
        title: redact(item.title, secrets, 160),
        priority: item.priority,
        position: item.position,
        archived: !!item.archivedAt,
      });
      if (link?.revision && link.revision < item.revision) {
        if (
          [
            "completed",
            "failed",
            "cancelled",
            "interrupted",
            "needs_input",
          ].includes(run.state)
        ) {
          card.column = "ready";
          card.reason = "Yêu cầu mới chưa gửi Lead";
          card.stopped = false;
          card.progress.verified = 0;
          card.progress.passed = 0;
          card.workState = undefined;
        } else card.reason += ` · yêu cầu v${link.revision}`;
      }
    }
    cards.push(card);
    rootIds.set(card.key, run.rootId);
    extraSearch.set(
      card.key,
      run.tasks
        .map((task) => `${task.id} ${task.originalTaskId ?? ""} ${task.title}`)
        .join(" "),
    );
  }
  const linkedRunItems = new Set(
    cards.flatMap((card) => (card.itemId ? [card.itemId] : [])),
  );
  for (const item of items) {
    if (linkedRunItems.has(item.id)) continue;
    const link = links.find(
      (link) => link.itemId === item.id && link.current !== false,
    );
    const pending = link?.followUpId
      ? queue.find((q) => q.id === link.followUpId)
      : undefined;
    cards.push({
      key: `item:${item.id}`,
      itemId: item.id,
      code: item.code,
      version: item.version,
      kind: link ? "runtime" : "planning",
      title: redact(item.title, secrets, 160),
      column: link
        ? pending?.state === "waiting"
          ? "ready"
          : "blocked"
        : item.planningState,
      reason: link
        ? pending
          ? pending.state === "waiting"
            ? "Trong hàng chờ Lead"
            : redact(pending.reason, secrets, 240)
          : "Liên kết cần kiểm tra"
        : "",
      role: link ? "lead" : (item.suggestedRole ?? "lead"),
      roles: [
        ...new Set([
          ...(link ? ["lead" as const] : []),
          item.suggestedRole ?? "lead",
        ]),
      ],
      priority: item.priority,
      position: item.position,
      archived: !!item.archivedAt,
      updatedAt: item.updatedAt,
      runId: link?.runId ?? null,
      conversationId: pending?.conversationId ?? item.conversationId,
      followUpId: link?.followUpId ?? null,
      stopped: false,
      progress: { tasks: 0, executed: 0, verified: 0, criteria: 0, passed: 0 },
      workTypes: [],
      changes: 0,
    });
  }
  const normalize = (text: string) =>
    text
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase();
  const search = normalize(query.search ?? "");
  const filtered = cards.filter(
    (card) =>
      card.archived === !!query.archived &&
      (query.showStopped || !card.stopped) &&
      (!query.role || card.roles.includes(query.role)) &&
      (!query.column || card.column === query.column) &&
      (query.priority === undefined || card.priority === query.priority) &&
      (!query.conversationId || card.conversationId === query.conversationId) &&
      (!query.runId ||
        card.runId === query.runId ||
        (!!card.itemId && queriedItems.has(card.itemId)) ||
        rootIds.get(card.key) === query.runId) &&
      (!query.workType || card.workTypes.includes(query.workType)) &&
      (!search ||
        normalize(
          `${card.code ?? ""} ${card.title} ${extraSearch.get(card.key) ?? ""}`,
        ).includes(search)),
  );
  filtered.sort((a, b) =>
    a.kind !== b.kind
      ? a.kind === "planning"
        ? -1
        : 1
      : a.kind === "planning"
        ? a.position - b.position || a.key.localeCompare(b.key)
        : b.updatedAt.localeCompare(a.updatedAt) || a.key.localeCompare(b.key),
  );
  const offset = query.offset ?? 0,
    pageSize = 50;
  return {
    cards: filtered.slice(offset, offset + pageSize),
    total: filtered.length,
    offset,
    hasMore: offset + pageSize < filtered.length,
    pageSize,
  };
}
