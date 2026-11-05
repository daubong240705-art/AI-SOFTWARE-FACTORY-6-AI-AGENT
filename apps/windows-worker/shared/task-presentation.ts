import { leadDecisionSchema, type TeamTask } from "./team";
import { attentionTitle } from "./attention";

export function taskTitle(task: Pick<TeamTask, "kind" | "title">): string {
  return task.kind === "plan"
    ? "Lập kế hoạch"
    : task.kind === "review"
      ? "Đánh giá kết quả"
      : attentionTitle(task.title);
}

export function taskDescription(
  task: Pick<TeamTask, "kind" | "instructions">,
): string {
  if (task.kind === "plan")
    return "Đọc yêu cầu, làm rõ thông tin còn thiếu và phân công công việc cho các agent.";
  if (task.kind === "review")
    return "Đối chiếu kết quả thực hiện với tiêu chí công việc, xác định phần chưa đạt hoặc cần bổ sung bằng chứng.";
  return task.instructions.trim();
}

export function taskCriteria(task: TeamTask): string[] {
  if (task.kind === "plan")
    return [
      "Làm rõ mục tiêu và thông tin cần bổ sung.",
      "Chia nhiệm vụ với phạm vi và tiêu chí cụ thể.",
    ];
  if (task.kind === "review")
    return [
      "Đối chiếu từng tiêu chí với bằng chứng đã lưu.",
      "Nêu rõ phần đạt, chưa đạt và chưa kiểm chứng.",
    ];
  return task.acceptance;
}

const opaque = (text: string) =>
  /^\s*(?:\{|\[\s*(?:[\[\]{}"\d-]|true\b|false\b|null\b)|```json\b|```\s*[\[{])/i.test(
    text,
  );
const cleanJSON = (text: string) =>
  text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

/** Presentation only: agent output is a claim, never evidence verification. */
export function taskResult(task: TeamTask): {
  text: string;
  unreadable: boolean;
} {
  const raw = task.summary.trim();
  if (!raw)
    return { text: "Chưa có báo cáo kết quả của task này.", unreadable: false };
  const sections = raw.match(
    /^Trạng thái:\s*(done|done_with_concerns|blocked|needs_context)\r?\nKết quả:\s*([\s\S]*?)\r?\nBlocker:\s*([\s\S]*?)\r?\nChưa xác minh:\s*([\s\S]*)$/,
  );
  if (sections) {
    const note = (label: string, value: string) =>
      value.trim() && value.trim() !== "—"
        ? `\n\n**${label}**\n\n${value.trim()}`
        : "";
    return {
      text:
        sections[2].trim() +
        note("Vướng mắc", sections[3]) +
        note("Chưa xác minh", sections[4]),
      unreadable: false,
    };
  }
  if (!opaque(raw)) return { text: raw, unreadable: false };
  try {
    const value: unknown = JSON.parse(cleanJSON(raw));
    if (task.kind === "plan") {
      const parsed = leadDecisionSchema.safeParse(value);
      if (parsed.success) {
        const data = parsed.data;
        if ("reply" in data) return { text: data.reply, unreadable: false };
        if ("questions" in data)
          return { text: data.summary, unreadable: false };
        return {
          text:
            data.blockedReason ||
            data.tasks
              .map((t) => `- **${t.role.toUpperCase()}** · ${t.title}`)
              .join("\n") ||
            "Lead chưa phân công công việc.",
          unreadable: false,
        };
      }
    }
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "summary" in value &&
      typeof value.summary === "string" &&
      "status" in value &&
      [
        "completed",
        "fix",
        "blocked",
        "done",
        "done_with_concerns",
        "needs_context",
      ].includes(String(value.status))
    ) {
      const lists = (key: string, label: string) => {
        const entries = (value as Record<string, unknown>)[key];
        return Array.isArray(entries) &&
          entries.some((e) => typeof e === "string")
          ? `\n\n**${label}**\n` +
              entries
                .filter((e): e is string => typeof e === "string")
                .slice(0, 8)
                .map((e) => `- ${e}`)
                .join("\n")
          : "";
      };
      return {
        text:
          value.summary +
          lists("blockers", "Vướng mắc") +
          lists("unverified", "Chưa xác minh") +
          lists("limitations", "Giới hạn"),
        unreadable: false,
      };
    }
  } catch {
    /* Partial/legacy JSON stays available in technical details. */
  }
  return {
    text: "Phản hồi chưa có bản tóm tắt đọc được. Mở dữ liệu kỹ thuật để xem nội dung gốc.",
    unreadable: true,
  };
}

export function taskScope(task: TeamTask): string {
  if (task.kind === "plan" || task.kind === "review")
    return "Chỉ đọc và đánh giá";
  return task.allowedPaths.join(", ") || "Chưa có phạm vi";
}
