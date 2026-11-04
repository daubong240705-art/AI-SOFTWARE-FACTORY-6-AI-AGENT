import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join, isAbsolute } from "node:path";
import { execFile } from "node:child_process";

export const SUPPORTED_VERSION = "1.19.5";
export function redact(
  text: string,
  secrets: string[] = [],
  limit = 16000,
): string {
  let result = text;
  for (const secret of secrets.filter(Boolean))
    result = result.split(secret).join("[REDACTED]");
  return result
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[IMAGE DATA]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "$1[REDACTED]")
    .replace(
      /((?:api[_-]?key|password|secret|token)\s*[=:]\s*["']?)[^\s"',}]+/gi,
      "$1[REDACTED]",
    )
    .slice(0, limit);
}
export function resolveRuntime(configured: string): string {
  const candidates = configured
    ? [configured]
    : [
        ...(process.env.PATH ?? "")
          .split(delimiter)
          .map((path) =>
            join(
              path,
              process.platform === "win32" ? "opencode.exe" : "opencode",
            ),
          ),
        join(
          process.env.APPDATA ?? "",
          "npm/node_modules/opencode-ai/bin/opencode.exe",
        ),
        join(process.env.USERPROFILE ?? "", ".opencode/bin/opencode.exe"),
      ];
  for (const path of candidates)
    if (isAbsolute(path) && !/\.(cmd|bat|ps1)$/i.test(path)) {
      try {
        accessSync(path, constants.R_OK);
        if (existsSync(path)) return path;
      } catch {
        /* try next */
      }
    }
  throw new Error(
    "Không tìm thấy opencode.exe. Chọn executable trong Cài đặt → Runtime.",
  );
}
export async function runtimeVersion(path: string): Promise<string> {
  const version = await new Promise<string>((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    execFile(
      path,
      ["--version"],
      { env, windowsHide: true, timeout: 7000, maxBuffer: 8192 },
      (error, stdout) =>
        error
          ? reject(new Error("Không đọc được phiên bản OpenCode."))
          : resolve(stdout.trim()),
    );
  });
  if (version !== SUPPORTED_VERSION)
    throw new Error(
      `OpenCode ${version.slice(0, 40)} chưa được hỗ trợ. Bản này dùng ${SUPPORTED_VERSION}.`,
    );
  return version;
}
