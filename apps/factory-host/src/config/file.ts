import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { configKey, secretKey, type ConfigIssue } from "./schema.js";

const fileKey = "FACTORY_CONFIG";
const maxBytes = 1024 * 1024;
const unreadable: ConfigIssue = { code: "C-READ", key: fileKey, message: "Không đọc được file cấu hình.", fix: "Dùng file thường, có quyền đọc và không lớn hơn 1 MiB." };

export function parseConfigFile(text: string, mode: number): { values: Record<string, string>; issues: ConfigIssue[] } {
  const values: Record<string, string> = {};
  const issues: ConfigIssue[] = [];
  let hasSecret = false;
  for (const [index, raw] of text.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    const invalidLine = (): void => { issues.push({ code: "C-SYNTAX", key: fileKey,
      message: `Dòng ${index + 1} không đúng cú pháp KEY=VALUE.`, fix: "Kiểm tra dấu bằng, dấu nháy và ký tự điều khiển." }); };
    if (!match) { invalidLine(); continue; }
    const key = match[1]!;
    if (!configKey(key)) {
      issues.push({ code: "C-KEY", key: fileKey, message: `Dòng ${index + 1} có tên khóa không được hỗ trợ.`,
        fix: "Chỉ dùng khóa FACTORY_*, NINE_ROUTER_API_KEY hoặc NODE_EXTRA_CA_CERTS." });
      continue;
    }
    hasSecret ||= secretKey(key);
    const input = match[2]!;
    const quote = input[0];
    let value: string;
    if (quote === "'" || quote === '"') {
      const quoted = /^(?:"((?:[^"\\]|\\.)*)"|'([^']*)')(?:\s*#.*)?$/.exec(input);
      if (!quoted) { invalidLine(); continue; }
      value = quoted[2] ?? quoted[1]!.replace(/\\(["\\])/g, "$1");
    } else value = input.replace(/(?:^|\s+)#.*$/, "").trimEnd();
    if (/[\0\r\n]/.test(value)) { invalidLine(); continue; }
    values[key] = value;
  }
  if (hasSecret && (mode & 0o044) !== 0) issues.push({ code: "C-PERM", key: fileKey,
    message: "File chứa khóa bí mật nhưng nhóm hoặc người khác có quyền đọc.", fix: "Chạy chmod 600 cho file cấu hình." });
  return { values, issues };
}

export function readConfigFile(path: string): ReturnType<typeof parseConfigFile> & { text?: string } {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const file = fstatSync(fd);
    if (!file.isFile() || file.size > maxBytes) throw new Error();
    const text = readFileSync(fd, "utf8");
    return { ...parseConfigFile(text, file.mode), text };
  } catch (error) {
    return { values: {}, issues: fd === undefined && (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : [unreadable] };
  } finally { if (fd !== undefined) closeSync(fd); }
}

export function serializeConfig(values: Record<string, string>): string {
  return Object.entries(values).map(([key, value]) => `${key}="${value.replace(/["\\]/g, "\\$&")}"\n`).join("");
}

