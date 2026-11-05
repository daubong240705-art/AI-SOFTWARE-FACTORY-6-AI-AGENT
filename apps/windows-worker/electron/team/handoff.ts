import { z } from "zod";
import type { CommandResult, Run } from "../../shared/runs";
import { parseJSON, type TeamTask } from "../../shared/team";

const reportSchema = z
  .object({
    status: z.enum(["done", "done_with_concerns", "blocked", "needs_context"]),
    summary: z.string().min(1).max(6000),
    blockers: z.array(z.string().min(1).max(800)).max(8),
    unverified: z.array(z.string().min(1).max(800)).max(8),
  })
  .strict();

export function taskReport(text: string) {
  try {
    // Human-readable sections keep streamed task reports useful in chat.
    // JSON is also accepted for existing adapters; neither format is evidence.
    const sections = text
      .trim()
      .match(
        /^Trạng thái:\s*(done|done_with_concerns|blocked|needs_context)\r?\nKết quả:\s*([\s\S]*?)\r?\nBlocker:\s*([\s\S]*?)\r?\nChưa xác minh:\s*([\s\S]*)$/,
      );
    const list = (value: string) =>
      value.trim() === "—"
        ? []
        : value
            .split(/\r?\n/)
            .map((s) => s.replace(/^[-*]\s+/, "").trim())
            .filter(Boolean);
    const report = sections
      ? reportSchema.parse({
          status: sections[1],
          summary: sections[2].trim(),
          blockers: list(sections[3]),
          unverified: list(sections[4]),
        })
      : parseJSON(text, reportSchema);
    return {
      format: "structured" as const,
      ...report,
      verified: false as const,
    };
  } catch {
    return {
      format: "legacy" as const,
      status: null,
      summary: text,
      blockers: [],
      unverified: [],
      verified: false as const,
    };
  }
}

export const workReportInstructions =
  "Cuối task báo cáo theo bốn mục văn bản sau, mỗi nhãn bắt đầu một dòng, đúng thứ tự; không bọc code fence:\nTrạng thái: done|done_with_concerns|blocked|needs_context (chọn một giá trị)\nKết quả: việc đã làm, file liên quan, lệnh/exit code thực tế; tối đa 6000 ký tự\nBlocker: mỗi mục một dòng, tối đa 8 mục và 800 ký tự/mục; ghi — nếu không có\nChưa xác minh: mỗi mục một dòng, tối đa 8 mục và 800 ký tự/mục; ghi — nếu không có\nĐây là báo cáo tự khai, không thay command/file evidence; không bịa ID hoặc test pass.";

export const handoffMaxChars = 32000;
// Keep BA contracts available through intermediate implementation dependencies.
export function handoffTaskIds(
  latest: ReadonlyMap<string, TeamTask>,
  dependencies: readonly string[],
  plannedTasks: readonly TeamTask[] = [],
) {
  const ids = new Set(dependencies);
  const visited = new Set<string>();
  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const task = latest.get(id);
    if (!task) return;
    if (task.role === "ba") ids.add(id);
    for (const dependency of task.dependsOn) visit(dependency);
    // Fix attempts depend on their previous attempt, which replaces the same
    // latest-map key. Retain the original plan's upstream contracts as well.
    for (const dependency of plannedTasks.find((t) => t.id === id)?.dependsOn ??
      [])
      visit(dependency);
  }
  for (const id of dependencies) visit(id);
  return [...ids];
}
const maxTasks = 10;
// Progressively shorten optional context before blockers and failed evidence.
const budgets = [
  {
    summary: 6000,
    note: 600,
    notes: 8,
    output: 1200,
    command: 600,
    commands: 6,
    files: 12,
    scope: 12,
  },
  {
    summary: 600,
    note: 400,
    notes: 4,
    output: 800,
    command: 300,
    commands: 4,
    files: 6,
    scope: 6,
  },
  {
    summary: 200,
    note: 240,
    notes: 2,
    output: 400,
    command: 200,
    commands: 2,
    files: 2,
    scope: 3,
  },
  {
    summary: 0,
    note: 120,
    notes: 1,
    output: 160,
    command: 120,
    commands: 1,
    files: 0,
    scope: 0,
  },
  {
    summary: 0,
    note: 80,
    notes: 1,
    output: 0,
    command: 0,
    commands: 1,
    files: 0,
    scope: 0,
  },
] as const;

function excerpt(text: string, limit: number) {
  if (text.length <= limit)
    return { text, totalChars: text.length, truncated: false };
  const marker = "\n… [truncated] …\n";
  const size = Math.max(0, limit - marker.length);
  return {
    text:
      limit < marker.length
        ? ""
        : text.slice(0, Math.ceil(size / 2)) +
          marker +
          (Math.floor(size / 2) ? text.slice(-Math.floor(size / 2)) : ""),
    totalChars: text.length,
    truncated: true,
  };
}

function failed(command: CommandResult) {
  return command.status !== "completed" || command.exitCode !== 0;
}

function entry(
  run: Run,
  taskId: string,
  task: TeamTask,
  budget: (typeof budgets)[number],
) {
  const report = taskReport(task.summary);
  // Never infer command ownership from a call ID alone: IDs can repeat across sessions.
  const commands = run.commands.filter((c) => c.taskId === task.id);
  const ordered = [
    ...commands.filter(failed),
    ...commands.filter((c) => !failed(c)),
  ];
  const selected = ordered.slice(0, budget.commands);
  const blockers = report.blockers
    .slice(0, budget.notes)
    .map((s) => excerpt(s, budget.note));
  const unverified = report.unverified
    .slice(0, budget.notes)
    .map((s) => excerpt(s, budget.note));
  const summary = excerpt(
    report.summary,
    task.role === "ba" ? budget.summary : Math.min(1800, budget.summary),
  );
  const error = excerpt(task.error, Math.max(budget.note, budget.output));
  const commandEntries = selected.map((c) => {
    const output = excerpt(
      c.output,
      failed(c) ? budget.output : Math.min(budget.summary, budget.output),
    );
    return {
      callId: c.callId,
      source: { runId: run.id, taskId: task.id, callId: c.callId },
      command: excerpt(c.command, budget.command),
      state: c.status,
      exitCode: c.exitCode,
      output,
      outputTruncated: !!c.outputTruncated || output.truncated,
    };
  });
  return {
    taskId,
    attemptId: task.id,
    round: task.round,
    kind: task.kind,
    role: task.role,
    state: task.state,
    source: { runId: run.id, taskId: task.id },
    dependsOn: task.dependsOn,
    scope: {
      items: task.allowedPaths.slice(0, budget.scope),
      omitted: Math.max(0, task.allowedPaths.length - budget.scope),
    },
    error,
    report: {
      format: report.format,
      status: report.status,
      verified: report.verified,
      blockers,
      blockersOmitted: report.blockers.length - blockers.length,
      unverified,
      unverifiedOmitted: report.unverified.length - unverified.length,
      summary,
    },
    files: {
      items: task.changes.slice(0, budget.files),
      omitted: Math.max(0, task.changes.length - budget.files),
    },
    commands: {
      items: commandEntries,
      omitted: commands.length - selected.length,
      failedTotal: commands.filter(failed).length,
      failedOmitted: ordered.slice(budget.commands).filter(failed).length,
    },
    truncated:
      summary.truncated ||
      error.truncated ||
      report.blockers.length > blockers.length ||
      report.unverified.length > unverified.length ||
      blockers.some((b) => b.truncated) ||
      unverified.some((u) => u.truncated) ||
      task.allowedPaths.length > budget.scope ||
      task.changes.length > budget.files ||
      commands.length > selected.length ||
      commandEntries.some((c) => c.outputTruncated || c.command.truncated),
  };
}

export function buildHandoff(
  run: Run,
  latest: ReadonlyMap<string, TeamTask>,
  taskIds: readonly string[],
) {
  const ids = [...new Set(taskIds)];
  // Keep failures first if a future caller exceeds the current ten-task plan limit.
  const priority = (id: string) => {
    const task = latest.get(id);
    const report = task && taskReport(task.summary);
    return !task ||
      task.state !== "completed" ||
      !!task.error ||
      report?.blockers.length ||
      ["blocked", "needs_context"].includes(report?.status ?? "") ||
      run.commands.some((c) => c.taskId === task.id && failed(c))
      ? 0
      : 1;
  };
  const selected = [...ids]
    .sort((a, b) => priority(a) - priority(b))
    .slice(0, maxTasks);
  const make = (budget: (typeof budgets)[number]) => {
    const tasks = selected.flatMap((id) => {
      const task = latest.get(id);
      return task ? [entry(run, id, task, budget)] : [];
    });
    return {
      schemaVersion: 1 as const,
      source: { runId: run.id },
      tasks,
      missingTaskIds: selected.filter((id) => !latest.has(id)),
      omittedTasks: ids.length - selected.length,
      truncated: ids.length > selected.length || tasks.some((t) => t.truncated),
    };
  };
  let packet = make(budgets[0]);
  for (const budget of budgets.slice(1)) {
    if (JSON.stringify(packet).length <= handoffMaxChars) return packet;
    packet = make(budget);
  }
  // Unusually long runtime IDs must not break the prompt budget or be clipped into false refs.
  while (
    packet.tasks.length &&
    JSON.stringify(packet).length > handoffMaxChars
  ) {
    packet.tasks.pop();
    packet.omittedTasks++;
    packet.truncated = true;
  }
  if (JSON.stringify(packet).length > handoffMaxChars)
    throw new Error(
      "Tham chiếu bàn giao vượt giới hạn context; không thể rút gọn an toàn.",
    );
  return packet;
}
