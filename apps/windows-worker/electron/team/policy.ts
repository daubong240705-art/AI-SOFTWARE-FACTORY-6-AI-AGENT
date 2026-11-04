import type { Role } from "../../shared/contracts";
import type { Run, ChangedFile } from "../../shared/runs";
import { inScope, type TeamTask } from "../../shared/team";
import type { RuntimeContext } from "../runtime/permissions";
import { rolePolicy } from "./role-policy";
import { selectedInstructions } from "./skills";
export { rolePolicy } from "./role-policy";

export function runtimeContext(
  run: Run,
  task?: TeamTask,
  prompt?: string,
): RuntimeContext {
  const role = task?.role ?? run.role;
  const profile = run.profiles.find((p) => p.role === role);
  if (!profile?.instructions.trim())
    throw new Error(`Thiếu profile snapshot cho ${role.toUpperCase()}.`);
  return {
    ...rolePolicy(role),
    permissionMode: run.settings.permissionMode ?? "ask",
    instructions: selectedInstructions(run, task, profile),
    allowedPaths: [...(task?.allowedPaths ?? ["."])],
    prompt: [
      run.context?.text,
      task ? (prompt ?? task.instructions) : "Yêu cầu hiện tại:\n" + run.prompt,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

export function sourcePolicyError(
  role: Role,
  allowedPaths: string[],
  changes: ChangedFile[],
  complete: boolean,
): string {
  if (
    !complete ||
    changes.some(
      (c) => rolePolicy(role).readOnly || !inScope(c.path, allowedPaths),
    )
  )
    return "Thay đổi ngoài phạm vi hoặc snapshot không đầy đủ. Kiểm tra diff; ứng dụng không tự hoàn tác.";
  return "";
}
