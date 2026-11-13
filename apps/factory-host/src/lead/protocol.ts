import { planNeedsTestingReason, taskProposeInputSchema, type TaskProposeInput } from "@factory/contracts";

export interface LeadCsv { fileName: string; text: string }
const MAX_CSV_CHARS = 1_000_000;

/** A ```factory-csv block: first line `# file: <name>.csv`, then the CSV. Saving it creates no task. */
function readCsv(body: string): LeadCsv | string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const header = /^#\s*file:\s*(.+?)\s*$/i.exec(lines[0] ?? "");
  const base = (header?.[1] ?? "").toLowerCase().replace(/\.csv$/, "").replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 80);
  const text = (header ? lines.slice(1) : lines).join("\n").trim();
  if (!text) return "plan file ignored: it is empty";
  if (text.length > MAX_CSV_CHARS) return "plan file ignored: it is larger than 1,000,000 characters";
  if (text.includes("\0")) return "plan file ignored: it contains NUL characters";
  return { fileName: `${base || "plan"}.csv`, text: `${text}\n` };
}

export function parseLeadOutput(text: string, intent: "discuss" | "delegate"): {
  reply: string; plan: TaskProposeInput | null; note: string | null; csv: LeadCsv | null;
} {
  const blocks: Array<{ start: number; end: number; json: string }> = [];
  const csvBlocks: Array<{ start: number; end: number; body: string }> = [];
  let fence: { marker: string; length: number; start: number; body: number; plan: boolean; csv: boolean } | null = null;
  // Track all outer fences so examples inside longer fences are ordinary reply text.
  for (const match of text.matchAll(/[^\n]*(?:\n|$)/g)) {
    const line = match[0].replace(/\r?\n$/, "");
    const offset = match.index;
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close?.[1]?.startsWith(fence.marker) && close[1].length >= fence.length) {
        if (fence.plan) blocks.push({ start: fence.start, end: offset + match[0].length,
          json: text.slice(fence.body, offset) });
        if (fence.csv) csvBlocks.push({ start: fence.start, end: offset + match[0].length, body: text.slice(fence.body, offset) });
        fence = null;
      }
    } else {
      const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (open?.[1] !== undefined) fence = { marker: open[1][0] as string, length: open[1].length,
        start: offset, body: offset + match[0].length, plan: open[1].startsWith("`") && open[2] === "factory-plan",
        csv: open[1].startsWith("`") && open[2]?.trim() === "factory-csv" };
    }
  }
  let reply = "";
  let cursor = 0;
  const removed = [...blocks, ...csvBlocks].sort((a, b) => a.start - b.start);
  for (const block of removed) { reply += text.slice(cursor, block.start); cursor = block.end; }
  reply += text.slice(cursor);
  reply = (removed.length ? reply.replace(/(?:\r?\n){3,}/g, "\n\n") : reply).trim();
  let csv: LeadCsv | null = null;
  let csvNote: string | null = null;
  if (csvBlocks.length > 1) csvNote = "multiple plan files ignored";
  else if (csvBlocks[0]) { const read = readCsv(csvBlocks[0].body); if (typeof read === "string") csvNote = read; else csv = read; }
  let plan: TaskProposeInput | null = null;
  let note: string | null = null;
  if (blocks.length > 1) note = "multiple plan blocks ignored";
  else if (blocks[0]) {
    let value: unknown;
    try { value = JSON.parse(blocks[0].json); }
    catch { note = "plan is not valid JSON"; }
    if (note === null) {
      const parsed = taskProposeInputSchema.safeParse(value);
      if (!parsed.success) note = "plan rejected: " + parsed.error.issues.slice(0, 3)
        .map((issue) => issue.path.map(String).join(".") || "(root)").join(", ");
      else if (planNeedsTestingReason(parsed.data)) note = "plan rejected: no test task and no testingReason";
      else if (intent === "discuss") note = "plan ignored: the message was a discussion";
      else plan = parsed.data;
    }
  }
  if (!reply) reply = plan ? `I proposed ${plan.tasks.length} task(s) for your review.` : csv ? `I wrote the plan file ${csv.fileName}.` : "I have no answer for that.";
  return { reply: reply.slice(0, 60_000), plan, note: [note, csvNote].filter((value) => value !== null).join("; ") || null, csv };
}
