import { sanitizeAgentText } from "../mcp/security.js";
import { MAX_TEXT, type OutlineEntry, type WorkerResult } from "./result.js";

const textTypes = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);
const workerTypes = new Set(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation"]);
export const extractionPolicy = (media: string): "text" | "worker" | "skip" =>
  textTypes.has(media) ? "text" : workerTypes.has(media) ? "worker" : "skip";
export const converterFor = (media: string) => extractionPolicy(media) === "text"
  ? { converter: "utf8", version: "1" } : { converter: "markitdown-pdfplumber", version: "0.1.9-1" };

export function markdownOutline(text: string): OutlineEntry[] {
  const result: OutlineEntry[] = [];
  let offset = 0; let fence: string | undefined;
  for (const line of text.split(/(?<=\n)/)) {
    const token = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (token?.[1]) {
      if (!fence) fence = token[1];
      else if (token[1][0] === fence[0] && token[1].length >= fence.length && !line.slice(token[0].length).trim()) fence = undefined;
    } else if (!fence) {
      const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (heading?.[1] && heading[2]) result.push({ level: heading[1].length,
        title: sanitizeAgentText(heading[2]).slice(0, 200), page: null, offset });
    }
    offset += line.length;
    if (result.length >= 500) break;
  }
  return result;
}
export function extractText(bytes: Buffer): WorkerResult {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let markdown = text.slice(0, MAX_TEXT);
  if (/[\uD800-\uDBFF]$/.test(markdown)) markdown = markdown.slice(0, -1);
  return { markdown, pages: null, outline: markdownOutline(markdown), metadata: { title: null, author: null, language: null },
    warnings: text.length > markdown.length ? ["truncated-text"] : [] };
}
