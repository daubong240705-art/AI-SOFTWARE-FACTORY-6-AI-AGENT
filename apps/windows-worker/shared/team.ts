import { z } from "zod";
import type { Role, Settings } from "./contracts";
import type { ChangedFile } from "./runs";
import { evidenceRefSchema, type TaskEvidence } from "./evidence";
export type ProfileSnapshot = {
  role: Role;
  version: string;
  hash: string;
  instructions: string;
  skills: { name: string; version: string; hash: string }[];
};
export const workerRoles = ["pm", "ba", "be", "fe", "test", "devops"] as const;
export const safePath = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine(
    (path) =>
      !path.includes("..") &&
      !/^[\\/]|[\x00-\x1f:*?<>|]|^[a-z]:/i.test(path) &&
      !/(^|[\\/])(\.git|\.env(?:\.[^/\\]*)?|credentials\.json|auth\.json)([\\/]|$)/i.test(
        path,
      ),
    "Phạm vi phải là đường dẫn tương đối trong project, không chứa secret hoặc .git.",
  )
  .transform(
    (path) =>
      path
        .replaceAll("\\", "/")
        .split("/")
        .filter((segment) => segment && segment !== ".")
        .join("/") || ".",
  );
export const plannedTaskSchema = z
  .object({
    id: z.string().regex(/^t[1-9][0-9]?$/),
    role: z.enum(workerRoles),
    title: z.string().min(1).max(160),
    instructions: z.string().min(1).max(6000),
    allowedPaths: z.array(safePath).min(1).max(12),
    acceptance: z.array(z.string().min(1).max(400)).min(1).max(8),
    dependsOn: z.array(z.string()).max(12),
  })
  .strict();
export const planSchema = z
  .object({
    blockedReason: z.string().max(1200).nullable(),
    testingReason: z.string().max(800),
    tasks: z.array(plannedTaskSchema).max(10),
  })
  .strict();
export type TeamPlan = z.infer<typeof planSchema>;
export const legacyReviewSchema = z
  .object({
    status: z.enum(["completed", "fix", "blocked"]),
    summary: z.string().min(1).max(6000),
    acceptance: z
      .array(
        z
          .object({
            criterion: z.string().min(1).max(400),
            status: z.enum(["passed", "failed", "unverified"]),
            evidence: z.string().min(1).max(1000),
          })
          .strict(),
      )
      .min(1)
      .max(80),
    fixes: z
      .array(
        z
          .object({
            taskId: z.string(),
            instructions: z.string().min(1).max(4000),
          })
          .strict(),
      )
      .max(3),
    limitations: z.array(z.string().max(800)).max(10),
  })
  .strict();
export const reviewSchema = legacyReviewSchema
  .extend({
    version: z.literal(2),
    acceptance: z
      .array(
        z
          .object({
            criterionId: z.string().regex(/^t[1-9][0-9]?:ac[1-8]$/),
            criterion: z.string().min(1).max(400),
            status: z.enum(["passed", "failed", "unverified"]),
            evidence: z.string().min(1).max(1000),
            method: z.enum(["command", "source"]),
            refs: z.array(evidenceRefSchema).max(8),
          })
          .strict(),
      )
      .min(1)
      .max(80),
  })
  .strict();
export type EvidenceReview = z.infer<typeof reviewSchema> & {
  verification?: { verified: boolean; issues: string[] };
};
export type TeamReview = z.infer<typeof legacyReviewSchema> | EvidenceReview;
export type TaskState =
  | "queued"
  | "running"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";
export type TeamTask = {
  originalTaskId?: string;
  evidence?: TaskEvidence;
  id: string;
  role: Role;
  title: string;
  instructions: string;
  allowedPaths: string[];
  acceptance: string[];
  dependsOn: string[];
  state: TaskState;
  model: string;
  kind: "plan" | "work" | "review" | "fix";
  round: number;
  sessionId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  summary: string;
  error: string;
  changes: ChangedFile[];
  commandIds: string[];
};
export function validatePlan(plan: TeamPlan, settings: Settings): void {
  if (plan.blockedReason) {
    if (plan.tasks.length)
      throw new Error("Plan bị chặn không được kèm task thực thi.");
    return;
  }
  if (!plan.tasks.length) throw new Error("Lead chưa tạo công việc.");
  const seen = new Set<string>();
  for (const task of plan.tasks) {
    if (seen.has(task.id)) throw new Error("Task ID bị trùng.");
    if (task.dependsOn.some((id) => !seen.has(id)))
      throw new Error(
        "Dependency phải trỏ tới task trước đó, không có vòng lặp.",
      );
    const agent = settings.agents.find((a) => a.role === task.role);
    if (!agent?.enabled || !agent.model)
      throw new Error(
        `Role ${task.role.toUpperCase()} chưa bật hoặc chưa có model.`,
      );
    seen.add(task.id);
  }
  if (
    !plan.tasks.some((task) => task.role === "test") &&
    !plan.testingReason.trim()
  )
    throw new Error("Lead cần nêu lý do nếu không gọi TEST.");
}
export function parseJSON<T>(text: string, schema: z.ZodType<T>): T {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return schema.parse(JSON.parse(clean));
}
export function inScope(path: string, allowedPaths: string[]): boolean {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  return allowedPaths.some((scope) => {
    const base = scope.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
    return (
      base === "." || normalized === base || normalized.startsWith(base + "/")
    );
  });
}
