import { taskProposeInputSchema, type TaskProposeInput } from "@factory/contracts";
import { z } from "zod";
import { normalizePlan, parseLenientJson } from "./normalize-plan.js";

export interface LeadCsv { fileName: string; text: string }
export const leadGameSchema = z.strictObject({
  mode: z.enum(["create", "update", "fix", "improve"]),
  request: z.string().min(1).max(500),
  touchRules: z.boolean().default(true),
  touchUi: z.boolean().default(true),
});
export type LeadGame = z.infer<typeof leadGameSchema>;
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

export function parseLeadOutput(text: string, intent: "discuss" | "delegate", protocol: "plan" | "game" = "plan"): {
  reply: string; plan: TaskProposeInput | null; note: string | null; csv: LeadCsv | null;
  game: LeadGame | null;
  /** Full task text per plan entry (goal plus anything shortened), stored as each task's brief. */
  briefs: string[];
} {
  const blocks: Array<{ start: number; end: number; json: string }> = [];
  const csvBlocks: Array<{ start: number; end: number; body: string }> = [];
  const gameBlocks: Array<{ start: number; end: number; json: string }> = [];
  let fence: { marker: string; length: number; start: number; body: number; plan: boolean; csv: boolean; game: boolean } | null = null;
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
        if (fence.game) gameBlocks.push({ start: fence.start, end: offset + match[0].length, json: text.slice(fence.body, offset) });
        fence = null;
      }
    } else {
      const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (open?.[1] !== undefined) fence = { marker: open[1][0] as string, length: open[1].length,
        start: offset, body: offset + match[0].length, plan: open[1].startsWith("`") && open[2] === "factory-plan",
        csv: open[1].startsWith("`") && open[2]?.trim() === "factory-csv",
        game: protocol === "game" && open[1].startsWith("`") && open[2]?.trim() === "factory-game" };
    }
  }
  let reply = "";
  let cursor = 0;
  const removed = [...blocks, ...csvBlocks, ...gameBlocks].sort((a, b) => a.start - b.start);
  for (const block of removed) { reply += text.slice(cursor, block.start); cursor = block.end; }
  reply += text.slice(cursor);
  reply = (removed.length ? reply.replace(/(?:\r?\n){3,}/g, "\n\n") : reply).trim();
  if (protocol === "game") {
    let game: LeadGame | null = null;
    let note: string | null = null;
    const block = gameBlocks.at(-1);
    if (block) {
      const json = parseLenientJson(block.json);
      const parsed = json === null ? null : leadGameSchema.safeParse(json.value);
      if (!parsed?.success) note = "Game request rejected: invalid game block. No workflow was started.";
      else if (intent !== "delegate") note = "Game request ignored: switch to Delegate and ask again to start a build.";
      else game = parsed.data;
    }
    return { reply: (reply || (game ? "I sent the game request to the Host." : "I have no answer for that.")).slice(0, 60_000),
      plan: null, briefs: [], csv: null, game, note };
  }
  let csv: LeadCsv | null = null;
  let csvNote: string | null = null;
  if (csvBlocks.length > 1) csvNote = "multiple plan files ignored";
  else if (csvBlocks[0]) { const read = readCsv(csvBlocks[0].body); if (typeof read === "string") csvNote = read; else csv = read; }
  let plan: TaskProposeInput | null = null;
  let note: string | null = null;
  let briefs: string[] = [];
  // Several plan blocks: the last one is taken (models often restate a corrected plan after a first attempt).
  const block = blocks.at(-1);
  if (block) {
    const json = parseLenientJson(block.json);
    if (json === null) note = "plan rejected, no task was created: the plan block is not valid JSON. Ask the Lead to send it again.";
    else {
      const normalized = normalizePlan(json.value);
      const fixes = [...(blocks.length > 1 ? [`used the last of ${blocks.length} plan blocks`] : []),
        ...(json.fixed ? ["repaired the JSON (trailing commas or comments)"] : []), ...normalized.fixes];
      const parsed = taskProposeInputSchema.safeParse(normalized.value);
      if (!parsed.success) note = "plan rejected, no task was created: " + parsed.error.issues.slice(0, 3)
        .map((issue) => `${issue.path.map(String).join(".") || "(root)"} (${issue.message.slice(0, 120)})`).join("; ");
      else if (intent === "discuss") note = "plan ignored: the message was a discussion. Switch to Delegate and ask again to create the tasks.";
      else {
        plan = parsed.data; briefs = normalized.briefs;
        if (fixes.length) note = `Host adjusted the plan: ${fixes.join("; ")}.`;
      }
    }
  }
  if (!reply) reply = plan ? `I proposed ${plan.tasks.length} task(s) for your review.` : csv ? `I wrote the plan file ${csv.fileName}.` : "I have no answer for that.";
  return { reply: reply.slice(0, 60_000), plan, briefs, note: [note, csvNote].filter((value) => value !== null).join("; ") || null, csv, game: null };
}
