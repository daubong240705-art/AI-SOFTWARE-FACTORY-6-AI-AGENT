const entries = [
  ["application/pdf", ["pdf"], "binary", true],
  ["image/png", ["png"], "binary", true],
  ["image/jpeg", ["jpg", "jpeg"], "binary", true],
  ["image/gif", ["gif"], "binary", true],
  ["image/webp", ["webp"], "binary", true],
  ["image/svg+xml", ["svg"], "text", false],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ["docx"], "binary", false],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ["xlsx"], "binary", false],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", ["pptx"], "binary", false],
  ["text/plain", ["txt"], "text", false],
  ["text/markdown", ["md", "markdown"], "text", false],
  ["text/csv", ["csv"], "text", false],
  ["application/json", ["json"], "text", false],
] as const;
type Media = { extensions: readonly string[]; kind: "text" | "binary"; inline: boolean };
const table = new Map<string, Media>(entries.map(([type, extensions, kind, inline]) => [type, { extensions, kind, inline }]));
const byExtension = new Map<string, string>(entries.flatMap(([type, extensions]) => extensions.map((extension) => [extension, type] as const)));
const utf8 = (bytes: Uint8Array): string | null => {
  if (bytes.includes(0)) return null;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return null; }
};
const starts = (bytes: Uint8Array, prefix: readonly number[] | Uint8Array): boolean => prefix.every((value, index) => bytes[index] === value);
const ascii = (value: string): Uint8Array => new TextEncoder().encode(value);
const contains = (bytes: Uint8Array, needle: Uint8Array): boolean => {
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};
export function isAllowedMediaType(type: string): boolean { return table.has(type); }
export function previewable(type: string): boolean { return table.get(type)?.inline === true; }
export function extensionFor(type: string): string | null { return table.get(type)?.extensions[0] ?? null; }
export function mediaTypeFromFileName(name: string): string | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(name);
  return match?.[1] === undefined ? null : byExtension.get(match[1].toLowerCase()) ?? null;
}
export function sniffMedia(type: string, bytes: Uint8Array): boolean {
  const media = table.get(type); if (!media || bytes.length === 0) return false;
  if (media.kind === "text") {
    const text = utf8(bytes); if (text === null) return false;
    if (type === "application/json") { try { JSON.parse(text) as unknown; } catch { return false; } }
    return type !== "image/svg+xml" || text.includes("<svg");
  }
  if (type === "application/pdf") return starts(bytes, ascii("%PDF-"));
  if (type === "image/png") return starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (type === "image/jpeg") return starts(bytes, [0xff, 0xd8, 0xff]);
  if (type === "image/gif") return starts(bytes, ascii("GIF87a")) || starts(bytes, ascii("GIF89a"));
  if (type === "image/webp") return starts(bytes, ascii("RIFF")) && starts(bytes.subarray(8), ascii("WEBP"));
  const part = type.endsWith("wordprocessingml.document") ? "word/document.xml"
    : type.endsWith("spreadsheetml.sheet") ? "xl/workbook.xml" : "ppt/presentation.xml";
  return starts(bytes, [0x50, 0x4b, 0x03, 0x04]) && contains(bytes, ascii(part));
}
export function mediaKind(type: string): "text" | "binary" | null { return table.get(type)?.kind ?? null; }
