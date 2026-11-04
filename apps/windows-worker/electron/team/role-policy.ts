import type { Role } from "../../shared/contracts";

export function rolePolicy(role: Role) {
  return {
    readOnly: ["lead", "pm", "ba", "test"].includes(role),
    allowShell: !["lead", "pm", "ba"].includes(role),
  };
}
