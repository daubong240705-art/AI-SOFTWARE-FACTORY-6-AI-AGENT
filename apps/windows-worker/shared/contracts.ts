import { z } from "zod";
import { roles } from "./defaults";

export { roles, defaultSettings } from "./defaults";
export type Role = (typeof roles)[number];
export const agentSchema = z
  .object({
    role: z.enum(roles),
    enabled: z.boolean(),
    model: z.string().trim().max(200),
  })
  .strict();
export const settingsSchema = z
  .object({
    gatewayUrl: z
      .string()
      .trim()
      .max(2048)
      .refine((value) => {
        if (!value) return true;
        try {
          const url = new URL(value);
          return (
            ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash
          );
        } catch {
          return false;
        }
      }, "URL phải là HTTP/HTTPS, không chứa key hoặc query."),
    caPath: z.string().max(4096),
    runtimePath: z.string().trim().max(4096),
    timeoutMinutes: z.number().int().min(1).max(240),
    maxRequests: z.number().int().min(1).max(1000),
    maxFixRounds: z.number().int().min(0).max(2),
    agents: z
      .array(agentSchema)
      .length(7)
      .refine(
        (items) => new Set(items.map((a) => a.role)).size === 7,
        "Mỗi role chỉ xuất hiện một lần.",
      )
      .refine(
        (items) => items.find((a) => a.role === "lead")?.enabled,
        "Lead luôn phải bật.",
      ),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;
export const saveSettingsSchema = z
  .object({
    settings: settingsSchema,
    keyAction: z.enum(["keep", "replace", "remove"]),
    apiKey: z.string().max(8192).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.keyAction === "replace" &&
      (!value.apiKey?.trim() || /[\r\n]/.test(value.apiKey))
    ) {
      context.addIssue({
        code: "custom",
        message: "API key không hợp lệ.",
        path: ["apiKey"],
      });
    }
    if (value.keyAction !== "replace" && value.apiKey) {
      context.addIssue({
        code: "custom",
        message: "Không gửi key khi giữ hoặc xóa key.",
        path: ["apiKey"],
      });
    }
  });
export type SaveSettings = z.infer<typeof saveSettingsSchema>;
export const idSchema = z.string().uuid();
export type Project = {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: string;
  draft: string;
};
export type ProjectStatus = {
  gitRoot: string | null;
  branch: string | null;
  changedFiles: number;
  error?: string;
};
export type ToolStatus = {
  name: string;
  available: boolean;
  version: string;
  path: string;
};
export type Bootstrap = {
  settings: Settings;
  projects: Project[];
  models: string[];
  hasKey: boolean;
  secureStorage: boolean;
};
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };
export interface WorkerAPI {
  bootstrap(): Promise<Reply<Bootstrap>>;
  chooseProject(): Promise<Reply<Project | null>>;
  openProject(id: string): Promise<Reply<Project>>;
  removeProject(id: string): Promise<Reply<void>>;
  projectStatus(id: string): Promise<Reply<ProjectStatus>>;
  revealProject(id: string): Promise<Reply<void>>;
  saveDraft(input: { id: string; draft: string }): Promise<Reply<void>>;
  saveSettings(input: SaveSettings): Promise<Reply<Bootstrap>>;
  chooseFile(kind: "ca" | "runtime"): Promise<Reply<string | null>>;
  fetchModels(): Promise<Reply<string[]>>;
  checkTools(): Promise<Reply<ToolStatus[]>>;
}
export { channels } from "./channels";
