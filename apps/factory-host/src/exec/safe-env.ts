import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { ExecError } from "./process-group.js";

/** The caller owns the generated HOME directory and should remove it after the execution. */
export function buildSafeEnv(extra: Record<string, string> = {}, allowNames: readonly string[] = []): Record<string, string> {
  if (!extra || typeof extra !== "object" || Array.isArray(extra) || !Array.isArray(allowNames)
    || allowNames.some((name) => typeof name !== "string")) throw new ExecError("invalid-options");
  const allowed = new Set(allowNames);
  const supplied: Record<string, string> = Object.create(null) as Record<string, string>;
  let bytes = 0;
  for (const [key, value] of Object.entries(extra)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string" || value.includes("\0")
      || (/KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE/i.test(key) && !allowed.has(key))) {
      throw new ExecError("invalid-options");
    }
    bytes += Buffer.byteLength(key) + Buffer.byteLength(value) + 2;
    if (bytes > 64 * 1024) throw new ExecError("invalid-options");
    supplied[key] = value;
  }
  if (supplied.HOME !== undefined && !isAbsolute(supplied.HOME)) throw new ExecError("invalid-options");
  return {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: supplied.HOME ?? mkdtempSync(join(tmpdir(), "factory-exec-home-")),
    LANG: "C.UTF-8",
    ...supplied,
  };
}

export function scrubForLog(text: string, secrets: readonly string[]): string {
  const spans: { start: number; end: number }[] = [];
  for (const secret of new Set(secrets)) {
    if (secret.length < 6) continue;
    for (let start = text.indexOf(secret); start !== -1; start = text.indexOf(secret, start + 1)) {
      spans.push({ start, end: start + secret.length });
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const parts: string[] = [];
  let cursor = 0;
  let end = 0;
  for (const span of spans) {
    // Merge overlapping occurrences before replacing anything: replacing one secret
    // first could otherwise hide an overlapping match and expose part of that secret.
    if (span.start < end) { end = Math.max(end, span.end); continue; }
    if (end > cursor) { parts.push("[redacted]"); cursor = end; }
    parts.push(text.slice(cursor, span.start));
    cursor = span.start;
    end = span.end;
  }
  if (end > cursor) parts.push("[redacted]");
  parts.push(text.slice(end));
  return parts.join("");
}
