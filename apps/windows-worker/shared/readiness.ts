import { z } from "zod";
import type { ProjectStatus, Settings, ToolStatus } from "./contracts";
export const readinessSchema = z
  .object({ projectId: z.string().uuid(), force: z.boolean().default(false) })
  .strict();
export type Readiness = {
  projectId: string;
  checkedAt: string;
  ready: boolean;
  checks: {
    id: string;
    label: string;
    level: "required" | "recommended";
    status: "pass" | "fail" | "unknown";
    detail: string;
  }[];
  slot: "available" | "occupied";
};
export function readinessResult(input: {
  projectId: string;
  settings: Settings;
  tools: ToolStatus[];
  git: ProjectStatus | null;
  folder: boolean;
  ca: boolean;
  credential: "available" | "unreadable" | "none";
  busy: boolean;
}): Readiness {
  const tool = (name: string) => input.tools.find((t) => t.name === name);
  const runtime = tool("OpenCode"),
    lead = input.settings.agents.find((a) => a.role === "lead");
  const isolated = input.settings.teamExecution === "isolated-pair";
  const gitReady =
    !!input.git?.gitRoot &&
    !input.git.error &&
    (!isolated || (!!input.git.branch && input.git.changedFiles === 0));
  const checks: Readiness["checks"] = [
    {
      id: "folder",
      label: "Thư mục source",
      level: "required",
      status: input.folder ? "pass" : "fail",
      detail: input.folder
        ? "Đọc được thư mục."
        : "Không đọc được thư mục dự án.",
    },
    {
      id: "gateway",
      label: "Gateway",
      level: "required",
      status: input.settings.gatewayUrl ? "pass" : "fail",
      detail: input.settings.gatewayUrl
        ? "Đã cấu hình URL; chưa kiểm tra kết nối."
        : "Cấu hình gateway trong Cài đặt.",
    },
    {
      id: "lead",
      label: "Model Lead",
      level: "required",
      status: lead?.enabled && lead.model ? "pass" : "fail",
      detail:
        lead?.enabled && lead.model ? lead.model : "Bật Lead và chọn model.",
    },
    {
      id: "runtime",
      label: "OpenCode 1.19.5",
      level: "required",
      status:
        runtime?.available && runtime.version === "1.19.5" ? "pass" : "fail",
      detail: runtime?.available
        ? runtime.version
        : "Chưa chạy được OpenCode native.",
    },
    {
      id: "ca",
      label: "Chứng chỉ CA",
      level: "required",
      status: input.ca ? "pass" : "fail",
      detail: input.ca
        ? input.settings.caPath
          ? "Đọc được CA đã cấu hình."
          : "Dùng chứng chỉ hệ thống."
        : "Không đọc được file CA đã cấu hình.",
    },
    {
      id: "credential",
      label: "API key",
      level: input.credential === "unreadable" ? "required" : "recommended",
      status:
        input.credential === "available"
          ? "pass"
          : input.credential === "unreadable"
            ? "fail"
            : "unknown",
      detail:
        input.credential === "available"
          ? "Đọc được key đã lưu."
          : input.credential === "unreadable"
            ? "Không giải mã được key; nhập lại trong Cài đặt."
            : "Chưa lưu key; cần bổ sung nếu gateway yêu cầu.",
    },
    {
      id: "git",
      label: "Git",
      level: isolated ? "required" : "recommended",
      status: gitReady ? "pass" : isolated ? "fail" : "unknown",
      detail: input.git?.gitRoot
        ? `${input.git.branch ?? "Chưa rõ branch"} · ${input.git.changedFiles} file thay đổi${isolated ? " · Hai lane cần repository sạch và có commit." : ""}`
        : isolated
          ? "Hai lane cần Git repository sạch và có commit; hoặc chọn chế độ tuần tự."
          : "Chưa có repository; vẫn dùng được chế độ tuần tự.",
    },
    ...["Node.js", "Python"].map((name) => ({
      id: name,
      label: name,
      level: "recommended" as const,
      status: tool(name)?.available ? ("pass" as const) : ("unknown" as const),
      detail: tool(name)?.available
        ? tool(name)!.version
        : "Chỉ cần nếu dự án sử dụng công cụ này.",
    })),
  ];
  return {
    projectId: input.projectId,
    checkedAt: new Date().toISOString(),
    ready: checks.every((c) => c.level !== "required" || c.status === "pass"),
    checks,
    slot: input.busy ? "occupied" : "available",
  };
}
