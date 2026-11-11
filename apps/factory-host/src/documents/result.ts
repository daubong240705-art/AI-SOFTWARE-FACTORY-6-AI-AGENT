import { z } from "zod";
import { sanitizeAgentText } from "../mcp/security.js";

export const MAX_TEXT = 2_000_000;
const title = z.string().max(MAX_TEXT).transform((value) => sanitizeAgentText(value).slice(0, 200));
export const outlineEntrySchema = z.strictObject({
  level: z.number().int().min(1).max(6), title, page: z.number().int().min(1).max(100000).nullable(),
  offset: z.number().int().min(0).max(MAX_TEXT),
});
export const workerResultSchema = z.strictObject({
  markdown: z.string().max(MAX_TEXT), pages: z.number().int().min(0).max(100000).nullable(),
  outline: z.array(outlineEntrySchema).max(500),
  metadata: z.strictObject({ title: title.nullable(), author: title.nullable(), language: z.null() }),
  warnings: z.array(z.enum(["truncated-pages", "truncated-text"])).max(2),
}).superRefine((value, ctx) => {
  if (value.outline.some((entry) => entry.offset > value.markdown.length ||
    (entry.page !== null && (value.pages === null || entry.page > value.pages))))
    ctx.addIssue({ code: "custom", message: "invalid outline" });
});
export type WorkerResult = z.infer<typeof workerResultSchema>;
export type OutlineEntry = z.infer<typeof outlineEntrySchema>;
export const workerErrorSchema = z.strictObject({ error: z.enum(["too-large", "unsupported", "corrupt", "encrypted", "failed"]) });
export class ExtractionError extends Error {
  constructor(readonly code: string) { super(code); }
}

/** Keep Markdown line boundaries while applying the shared secret/path/control scrubber. */
export const cleanDocumentText = (text: string): string => text.split("\n").map(sanitizeAgentText).join("\n");

export function fitResult(result: WorkerResult, maxBytes: number): WorkerResult {
  const bytes = Buffer.from(result.markdown);
  if (bytes.length <= maxBytes) return result;
  let end = Math.max(0, maxBytes);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let markdown = "";
  for (;;) {
    try { markdown = decoder.decode(bytes.subarray(0, end)); break; } catch { end--; }
  }
  return { ...result, markdown, outline: result.outline.filter((entry) => entry.offset < markdown.length),
    warnings: [...new Set([...result.warnings, "truncated-text" as const])] };
}
