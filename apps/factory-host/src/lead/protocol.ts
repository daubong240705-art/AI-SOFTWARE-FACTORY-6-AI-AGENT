import { portalBlockSchema, type PortalBlock, taskProposeInputSchema, type TaskProposeInput } from "@factory/contracts";
import { z } from "zod";
import { normalizePlan, parseLenientJson } from "./normalize-plan.js";

export interface LeadCsv { fileName: string; text: string }
export const leadGameSchema = z.strictObject({
  mode: z.enum(["create", "update", "fix", "improve"]),
  request: z.string().min(1).max(4000),
  touchRules: z.boolean().default(true),
  touchUi: z.boolean().default(true),
  stages: z.array(z.enum(["design", "rules", "art", "client"])).optional(),
  qa: z.enum(["full", "quick"]).optional(),
});
export type LeadGame = z.infer<typeof leadGameSchema>;
export const leadTaskSchema = z.strictObject({
  seat: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(160),
  goal: z.string().trim().min(1).max(500),
  acceptance: z.array(z.string().trim().min(1).max(500)).min(1).max(5),
});
export type LeadTask = z.infer<typeof leadTaskSchema>;

/** Host policy: never forward protocol-only fields to the workflow parameter validator. */
export function normalizeLeadGame(game: LeadGame) {
  const all = game.mode === "create" || game.stages === undefined;
  const stages = new Set(game.stages);
  const runDesign = all || stages.has("design");
  const runRules = all || stages.has("rules");
  const runArt = all || stages.has("art");
  const runClient = all || stages.has("client") || runRules || runArt;
  const touchRules = game.mode === "create" ? true : game.stages === undefined ? game.touchRules : runRules;
  const touchUi = game.mode === "create" ? true : game.stages === undefined ? game.touchUi : runArt;
  // Legacy fix mode bypasses the upstream tracks. Explicit scope must be able to select them.
  const mode = game.mode === "fix" && game.stages?.some((stage) => stage !== "client") ? "update" : game.mode;
  const qa = mode === "create" || game.stages?.length === 0 || (runRules && touchRules && mode !== "fix")
    ? "full" : game.qa ?? "full";
  return { mode, request: game.request, touchRules, touchUi, runDesign, runRules, runArt, runClient, qa };
}
export type LeadGameParams = ReturnType<typeof normalizeLeadGame>;

/** Describe the included stages, including the legacy mode/touch switches. */
export function leadGameStages(params: LeadGameParams): string {
  return [params.mode === "fix" && params.runClient && "Tái hiện lỗi",
    params.mode !== "fix" && params.runDesign && "Thiết kế",
    params.mode !== "fix" && params.runRules && params.touchRules && "Luật",
    params.mode !== "fix" && params.runArt && params.touchUi && "Mỹ thuật",
    params.runClient && "Ghép", params.qa === "quick" ? "Kiểm thử nhanh" : "Kiểm thử đầy đủ"]
    .filter(Boolean).join(", ");
}
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

export function parseLeadOutput(text: string, intent: "discuss" | "delegate", protocol: "plan" | "game" | "portal" = "plan"): {
  reply: string; plan: TaskProposeInput | null; note: string | null; csv: LeadCsv | null;
  game: LeadGame | null; task: LeadTask | null;
  /** Full task text per plan entry (goal plus anything shortened), stored as each task's brief. */
  briefs: string[];
  portal: PortalBlock[];
} {
  if (protocol === "portal") {
    const portal: PortalBlock[] = [], notes: string[] = [];
    let reply = "", cursor = 0, count = 0;
    // Reuse the outer-fence scan: embedded examples must never execute.
    let fence: { marker: string; length: number; start: number; body: number; portal: boolean } | null = null;
    for (const match of text.matchAll(/[^\n]*(?:\n|$)/g)) {
      const line = match[0].replace(/\r?\n$/, ""), offset = match.index;
      if (fence) {
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
        if (close?.[1]?.startsWith(fence.marker) && close[1].length >= fence.length) {
          if (fence.portal) {
            reply += text.slice(cursor, fence.start); cursor = offset + match[0].length;
            count++;
            try {
              const block = portalBlockSchema.parse(JSON.parse(text.slice(fence.body, offset)) as unknown);
              if (count <= 5) portal.push(block);
            } catch { notes.push(`Khối factory-portal thứ ${count} không hợp lệ; chưa thực hiện.`); }
          }
          fence = null;
        }
      } else {
        const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (open?.[1]) fence = { marker: open[1][0]!, length: open[1].length, start: offset, body: offset + match[0].length,
          portal: open[1].startsWith("`") && open[2]?.trim() === "factory-portal" };
      }
    }
    if (fence?.portal) { reply += text.slice(cursor, fence.start); cursor = text.length; notes.push("Khối factory-portal chưa đóng; chưa thực hiện."); }
    if (count > 5) { portal.length = 0; notes.push("Tối đa 5 khối factory-portal mỗi lượt; chưa thực hiện khối nào."); }
    reply += text.slice(cursor);
    return { reply: (reply.trim() || "Đã gửi yêu cầu Portal để Host kiểm tra.").slice(0, 60000), portal,
      plan: null, game: null, task: null, briefs: [], csv: null, note: notes.join("\n") || null };
  }
  const blocks: Array<{ start: number; end: number; json: string }> = [];
  const csvBlocks: Array<{ start: number; end: number; body: string }> = [];
  const gameBlocks: Array<{ start: number; end: number; json: string }> = [];
  const taskBlocks: Array<{ start: number; end: number; json: string }> = [];
  let fence: { marker: string; length: number; start: number; body: number; plan: boolean; csv: boolean; game: boolean; task: boolean } | null = null;
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
        if (fence.task) taskBlocks.push({ start: fence.start, end: offset + match[0].length, json: text.slice(fence.body, offset) });
        fence = null;
      }
    } else {
      const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (open?.[1] !== undefined) fence = { marker: open[1][0] as string, length: open[1].length,
        start: offset, body: offset + match[0].length, plan: open[1].startsWith("`") && open[2] === "factory-plan",
        csv: open[1].startsWith("`") && open[2]?.trim() === "factory-csv",
        game: protocol === "game" && open[1].startsWith("`") && open[2]?.trim() === "factory-game",
        task: open[1].startsWith("`") && open[2]?.trim() === "factory-task" };
    }
  }
  let reply = "";
  let cursor = 0;
  const removed = [...blocks, ...csvBlocks, ...gameBlocks, ...taskBlocks].sort((a, b) => a.start - b.start);
  for (const block of removed) { reply += text.slice(cursor, block.start); cursor = block.end; }
  reply += text.slice(cursor);
  reply = (removed.length ? reply.replace(/(?:\r?\n){3,}/g, "\n\n") : reply).trim();
  let task: LeadTask | null = null;
  let taskNote: string | null = null;
  const taskBlock = taskBlocks.at(-1);
  // A game block always wins, even if invalid: never fall back to doing unrelated work.
  if (taskBlock && gameBlocks.length === 0) {
    const json = parseLenientJson(taskBlock.json);
    const parsed = json === null ? null : leadTaskSchema.safeParse(json.value);
    if (!parsed?.success) taskNote = "Không thể giao việc: khối factory-task không hợp lệ. Chưa tạo công việc.";
    else if (intent !== "delegate") taskNote = "Chưa giao việc: hãy chuyển sang Giao việc và yêu cầu lại.";
    else task = parsed.data;
  }
  if (protocol === "game") {
    let game: LeadGame | null = null;
    let note: string | null = taskNote;
    const block = gameBlocks.at(-1);
    if (block) {
      const json = parseLenientJson(block.json);
      const parsed = json === null ? null : leadGameSchema.safeParse(json.value);
      if (!parsed?.success) note = "Game request rejected: invalid game block. No workflow was started.";
      else if (intent !== "delegate") note = "Game request ignored: switch to Delegate and ask again to start a build.";
      else game = parsed.data;
    }
    return { reply: (reply || (game || task ? "I sent the request to the Host." : "I have no answer for that.")).slice(0, 60_000),
      portal: [], plan: null, briefs: [], csv: null, game, task, note };
  }
  let csv: LeadCsv | null = null;
  let csvNote: string | null = null;
  if (csvBlocks.length > 1) csvNote = "multiple plan files ignored";
  else if (csvBlocks[0]) { const read = readCsv(csvBlocks[0].body); if (typeof read === "string") csvNote = read; else csv = read; }
  let plan: TaskProposeInput | null = null;
  let note: string | null = null;
  let briefs: string[] = [];
  // Several plan blocks: the last one is taken (models often restate a corrected plan after a first attempt).
  const block = taskBlocks.length ? undefined : blocks.at(-1);
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
  return { reply: reply.slice(0, 60_000), portal: [], plan, briefs, note: [note, csvNote, taskNote].filter((value) => value !== null).join("; ") || null, csv, game: null, task };
}
