import { leadBriefSchema, leadCancelSchema, leadDecisionSchema, leadRunSchema, taskProposeInputSchema,
  type LeadBrief, type TaskProposeInput } from "@factory/contracts";
import type { z } from "zod";
import { normalizePlan, parseLenientJson } from "./normalize-plan.js";

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

type Intent = "discuss" | "delegate" | "auto";
export type LeadAction = { kind: "plan"; decision: z.infer<typeof leadDecisionSchema> }
  | { kind: "run"; data: z.infer<typeof leadRunSchema> }
  | { kind: "cancel"; data: z.infer<typeof leadCancelSchema> };

export function parseLeadOutput(text: string, intent: Intent): {
  reply: string; plan: TaskProposeInput | null; note: string | null; csv: LeadCsv | null;
  brief: LeadBrief | null; action: LeadAction | null; requested: LeadAction["kind"] | null;
  /** Full task text per plan entry (goal plus anything shortened), stored as each task's brief. */
  briefs: string[];
} {
  const blocks: Array<{ start: number; end: number; json: string }> = [];
  const csvBlocks: Array<{ start: number; end: number; body: string }> = [];
  const extra: Array<{ start: number; end: number; body: string; tag: string }> = [];
  let fence: { marker: string; length: number; start: number; body: number; tag: string } | null = null;
  // Track all outer fences so examples inside longer fences are ordinary reply text.
  for (const match of text.matchAll(/[^\n]*(?:\n|$)/g)) {
    const line = match[0].replace(/\r?\n$/, "");
    const offset = match.index;
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close?.[1]?.startsWith(fence.marker) && close[1].length >= fence.length) {
        const block = { start: fence.start, end: offset + match[0].length, body: text.slice(fence.body, offset), tag: fence.tag };
        if (fence.tag === "factory-plan") blocks.push({ ...block, json: block.body });
        if (fence.tag.trim() === "factory-csv") csvBlocks.push(block);
        if (["factory-brief", "factory-run", "factory-cancel"].includes(fence.tag)) extra.push(block);
        fence = null;
      }
    } else {
      const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (open?.[1] !== undefined) fence = { marker: open[1][0] as string, length: open[1].length,
        start: offset, body: offset + match[0].length, tag: open[1].startsWith("`") ? open[2]?.trim() ?? "" : "" };
    }
  }
  let reply = "";
  let cursor = 0;
  const removed = [...blocks, ...csvBlocks, ...extra].sort((a, b) => a.start - b.start);
  if (fence?.tag.trim().match(/^factory-(plan|csv|brief|run|cancel)$/)) removed.push({ start: fence.start, end: text.length, body: "" });
  for (const block of removed) { reply += text.slice(cursor, block.start); cursor = block.end; }
  reply += text.slice(cursor);
  let csv: LeadCsv | null = null;
  let csvNote: string | null = null;
  if (intent !== "auto") {
    if (csvBlocks.length > 1) csvNote = "multiple plan files ignored";
    else if (csvBlocks[0]) { const read = readCsv(csvBlocks[0].body); if (typeof read === "string") csvNote = read; else csv = read; }
  }
  let plan: TaskProposeInput | null = null;
  let note: string | null = null;
  let briefs: string[] = [];
  let brief: LeadBrief | null = null;
  let requested: LeadAction["kind"] | null = null;
  let action: LeadAction | null = null;
  // Several plan blocks: the last one is taken (models often restate a corrected plan after a first attempt).
  const block = blocks.at(-1);
  if (block) {
    const json = parseLenientJson(block.json);
    if (json === null) {
      if (intent === "auto") requested = "plan";
      note = "plan rejected, no task was created: the plan block is not valid JSON. Ask the Lead to send it again.";
    }
    else {
      const { decision, ...planJson } = json.value && typeof json.value === "object" && !Array.isArray(json.value)
        ? json.value as Record<string, unknown> : { decision: undefined, tasks: json.value };
      if (intent === "auto" && decision !== undefined) requested = "plan";
      const normalized = normalizePlan(decision === undefined ? json.value : planJson);
      const fixes = [...(blocks.length > 1 ? [`used the last of ${blocks.length} plan blocks`] : []),
        ...(json.fixed ? ["repaired the JSON (trailing commas or comments)"] : []), ...normalized.fixes];
      const parsed = taskProposeInputSchema.safeParse(normalized.value);
      if (!parsed.success) note = "plan rejected, no task was created: " + parsed.error.issues.slice(0, 3)
        .map((issue) => `${issue.path.map(String).join(".") || "(root)"} (${issue.message.slice(0, 120)})`).join("; ");
      else if (intent === "discuss") note = "plan ignored: the message was a discussion. Switch to Delegate and ask again to create the tasks.";
      else {
        plan = parsed.data; briefs = normalized.briefs;
        const checked = leadDecisionSchema.safeParse(decision);
        if (requested === "plan" && checked.success) action = { kind: "plan", decision: checked.data };
        if (fixes.length) note = `Host adjusted the plan: ${fixes.join("; ")}.`;
      }
    }
  }
  if (intent === "auto") {
    const briefBlocks = extra.filter(({ tag }) => tag === "factory-brief");
    const actions = extra.filter(({ tag }) => tag !== "factory-brief");
    const strictJson = (body: string): unknown => { try { return JSON.parse(body); } catch { return null; } };
    if (briefBlocks.length === 1 && briefBlocks[0]) {
      const checked = leadBriefSchema.safeParse(strictJson(briefBlocks[0].body));
      if (checked.success) brief = checked.data;
    }
    const first = actions[0];
    if (first) {
      requested = first.tag === "factory-run" ? "run" : "cancel";
      action = null;
      if (actions.length === 1 && blocks.length === 0) {
        if (requested === "run") {
          const checked = leadRunSchema.safeParse(strictJson(first.body));
          if (checked.success) action = { kind: "run", data: checked.data };
        } else {
          const checked = leadCancelSchema.safeParse(strictJson(first.body));
          if (checked.success) action = { kind: "cancel", data: checked.data };
        }
      }
    } else if (blocks.length > 1) { requested = "plan"; action = null; }
    if (fence?.tag.match(/^factory-(plan|brief|run|cancel)$/)) {
      requested ??= fence.tag === "factory-run" ? "run" : fence.tag === "factory-cancel" ? "cancel" : "plan";
      action = null;
    }
    if (requested !== null && action?.kind !== "plan") plan = null;
  }
  if (!reply.trim()) reply = intent === "auto" ? "" : plan ? `I proposed ${plan.tasks.length} task(s) for your review.` : csv ? `I wrote the plan file ${csv.fileName}.` : "I have no answer for that.";
  return { reply: reply.slice(0, 32_000), plan, briefs, note: [note, csvNote].filter((value) => value !== null).join("; ") || null, csv, brief, action, requested };
}
