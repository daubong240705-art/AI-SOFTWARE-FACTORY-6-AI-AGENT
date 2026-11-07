import { planNeedsTestingReason, taskProposeInputSchema, type TaskProposeInput } from "@factory/contracts";

export function parseLeadOutput(text: string, intent: "discuss" | "delegate"): {
  reply: string; plan: TaskProposeInput | null; note: string | null;
} {
  const blocks: Array<{ start: number; end: number; json: string }> = [];
  let fence: { marker: string; length: number; start: number; body: number; plan: boolean } | null = null;
  // Track all outer fences so examples inside longer fences are ordinary reply text.
  for (const match of text.matchAll(/[^\n]*(?:\n|$)/g)) {
    const line = match[0].replace(/\r?\n$/, "");
    const offset = match.index;
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close?.[1]?.startsWith(fence.marker) && close[1].length >= fence.length) {
        if (fence.plan) blocks.push({ start: fence.start, end: offset + match[0].length,
          json: text.slice(fence.body, offset) });
        fence = null;
      }
    } else {
      const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (open?.[1] !== undefined) fence = { marker: open[1][0] as string, length: open[1].length,
        start: offset, body: offset + match[0].length, plan: open[1].startsWith("`") && open[2] === "factory-plan" };
    }
  }
  let reply = "";
  let cursor = 0;
  for (const block of blocks) { reply += text.slice(cursor, block.start); cursor = block.end; }
  reply += text.slice(cursor);
  reply = (blocks.length ? reply.replace(/(?:\r?\n){3,}/g, "\n\n") : reply).trim();
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
  if (!reply) reply = plan ? `I proposed ${plan.tasks.length} task(s) for your review.` : "I have no answer for that.";
  return { reply: reply.slice(0, 60_000), plan, note };
}
