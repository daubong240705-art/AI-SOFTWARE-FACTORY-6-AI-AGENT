import type { Config } from "@opencode-ai/sdk/v2/client";
import { editScopes } from "./scope";

export type RuntimeContext = {
  images?: { type: "file"; mime: string; filename: string; url: string }[];
  prompt: string;
  instructions: string;
  readOnly: boolean;
  allowShell: boolean;
  allowedPaths: string[];
  permissionMode?: "ask" | "full-access";
};

export function autoApproves(
  permission: string,
  context: Pick<RuntimeContext, "allowShell" | "permissionMode">,
): boolean {
  return (
    context.permissionMode === "full-access" &&
    (permission === "doom_loop" ||
      (permission === "bash" && context.allowShell))
  );
}

export function runtimePermissions(workspace: string, context: RuntimeContext) {
  const filePolicy = {
    "*": "allow",
    "**/.env": "deny",
    "**/.env.*": "deny",
    ".env": "deny",
    ".env.*": "deny",
    "**/*.pem": "deny",
    "**/*.key": "deny",
    "**/*.pfx": "deny",
    "**/*.p12": "deny",
    "*.pem": "deny",
    "*.key": "deny",
    "*.pfx": "deny",
    "*.p12": "deny",
    "auth.json": "deny",
    "credentials.json": "deny",
    "**/credentials.json": "deny",
    "**/auth.json": "deny",
    "**/.git/**": "deny",
    ".git": "deny",
    ".git/**": "deny",
    "**/.git": "deny",
  } as const;
  return {
    "*": "deny",
    read: filePolicy,
    edit: context.readOnly
      ? "deny"
      : {
          ...editScopes(workspace, context.allowedPaths),
          // OpenCode resolves the last matching rule: secret denies stay last.
          ...Object.fromEntries(
            Object.entries(filePolicy).filter(([key]) => key !== "*"),
          ),
        },
    glob: "allow",
    grep: "allow",
    list: "allow",
    bash: context.allowShell
      ? autoApproves("bash", context)
        ? "allow"
        : "ask"
      : "deny",
    external_directory: "deny",
    todowrite: "allow",
    question: "deny",
    task: "deny",
    webfetch: "deny",
    websearch: "deny",
    skill: "deny",
    lsp: "deny",
    doom_loop: autoApproves("doom_loop", context) ? "allow" : "ask",
  } satisfies NonNullable<Config["permission"]>;
}
