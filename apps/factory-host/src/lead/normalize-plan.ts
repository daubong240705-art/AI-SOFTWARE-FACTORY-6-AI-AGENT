/**
 * Deterministic repair of a Lead plan before schema validation. The model proposes; this code only fixes format
 * problems it can fix without guessing intent (lengths, numbering, enum spelling, missing optional fields), keeps
 * every word it shortens in the task brief, and reports each repair so the operator sees what changed.
 * Anything it cannot repair still fails validation and creates no task.
 */
const MAX_TASKS = 30, MAX_TITLE = 160, MAX_GOAL = 500, MAX_CRITERION = 500, MAX_CRITERIA = 8, MAX_BRIEF = 32_000;
const CAPABILITY = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const placements = ["portable", "repo-bound", "node-bound", "session-bound"] as const;
const sideEffects = ["none", "artifact", "external-idempotent", "external-irreversible"] as const;
const reviewPolicies = ["human-final", "automatic", "hybrid"] as const;

export interface NormalizedPlan { value: unknown; briefs: string[]; fixes: string[] }

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : typeof value === "number" ? String(value) : "";
/** Cuts at a word boundary and marks the cut; the full text is kept elsewhere by the caller. */
function shorten(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): { value: T; fixed: boolean } => {
  const raw = text(value).toLowerCase().replace(/[\s_]+/g, "-");
  return (allowed as readonly string[]).includes(raw) ? { value: raw as T, fixed: raw !== value } : { value: fallback, fixed: true };
};
const integers = (value: unknown): number[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
  .map((item) => typeof item === "string" && /^\s*\d+\s*$/.test(item) ? Number(item) : item)
  .filter((item): item is number => typeof item === "number" && Number.isInteger(item));

/** JSON.parse first; on failure retry once without trailing commas and comment lines, which models often add. */
export function parseLenientJson(source: string): { value: unknown; fixed: boolean } | null {
  try { return { value: JSON.parse(source), fixed: false }; } catch { /* try the lenient form */ }
  const cleaned = source.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1")
    .replace(/[“”]/g, "\"");
  try { return { value: JSON.parse(cleaned), fixed: true }; } catch { return null; }
}

export function normalizePlan(input: unknown): NormalizedPlan {
  const fixes = new Set<string>();
  const root = Array.isArray(input) ? { tasks: input } : record(input);
  if (Array.isArray(input)) fixes.add("wrapped a bare task list");
  if (!root || !Array.isArray(root.tasks)) return { value: input, briefs: [], fixes: [] };
  let tasks = root.tasks.map(record).filter((task): task is Record<string, unknown> => task !== null);
  if (tasks.length !== root.tasks.length) fixes.add("dropped entries that were not tasks");
  if (tasks.length > MAX_TASKS) {
    fixes.add(`created the first ${MAX_TASKS} of ${tasks.length} tasks; ask the Lead to propose the rest`);
    tasks = tasks.slice(0, MAX_TASKS);
  }

  // Dependencies: the Lead often numbers tasks from 1. When every reference is >= 1 and some point at the task itself
  // or later, and shifting all of them by one makes every reference valid, the plan is 1-based: shift it.
  const deps = tasks.map((task) => [...new Set(integers(task.dependsOn ?? task.depends_on ?? task.dependencies))]);
  const flat = deps.flat();
  const broken = deps.some((list, index) => list.some((d) => d >= index || d < 0));
  const oneBased = broken && flat.length > 0 && flat.every((d) => d >= 1)
    && deps.every((list, index) => list.every((d) => d - 1 < index && d - 1 >= 0));
  if (oneBased) fixes.add("renumbered dependencies from 1-based to 0-based");
  let droppedDeps = 0;
  const dependsOn = deps.map((list, index) => {
    const shifted = oneBased ? list.map((d) => d - 1) : list;
    const valid = shifted.filter((d) => d >= 0 && d < index && d <= 29);
    droppedDeps += shifted.length - valid.length;
    return [...new Set(valid)];
  });
  if (droppedDeps) fixes.add(`dropped ${droppedDeps} dependency reference(s) to the same or a later task`);

  const counts = { title: 0, goal: 0, criteria: 0, extraCriteria: 0, enums: 0, capabilities: 0, keys: 0 };
  const briefs: string[] = [];
  const normalized = tasks.map((task, index) => {
    const extra: string[] = [];
    let goalFull = text(task.goal ?? task.description ?? task.summary);
    let title = text(task.title ?? task.name);
    if (!title) title = shorten(goalFull || `Task ${index + 1}`, 80);
    if (title.length > MAX_TITLE) { counts.title++; extra.push(`Full title: ${title}`); title = shorten(title, MAX_TITLE); }
    if (!goalFull) goalFull = title;
    let goal = goalFull;
    if (goal.length > MAX_GOAL) { counts.goal++; goal = shorten(goal, MAX_GOAL); }

    const rawCriteria = Array.isArray(task.acceptance) ? task.acceptance : typeof task.acceptance === "string" ? task.acceptance.split(/\n+/) : [];
    const criteria = rawCriteria.map(text).map((line) => line.replace(/^[-*•]\s*/, "")).filter(Boolean);
    const long = criteria.filter((line) => line.length > MAX_CRITERION);
    if (long.length) { counts.criteria += long.length; extra.push(...long.map((line) => `Full criterion: ${line}`)); }
    let acceptance = criteria.map((line) => shorten(line, MAX_CRITERION));
    if (acceptance.length > MAX_CRITERIA) {
      counts.extraCriteria++;
      extra.push("Further acceptance criteria:", ...acceptance.slice(MAX_CRITERIA - 1).map((line) => `- ${line}`));
      acceptance = [...acceptance.slice(0, MAX_CRITERIA - 1), "All further acceptance criteria listed in the brief are met."];
    }
    if (!acceptance.length) acceptance = ["The goal is met and shown by a command or test with its exit code."];

    const placement = pick(task.placement, placements, "repo-bound");
    const sideEffect = pick(task.sideEffect ?? task.side_effect, sideEffects, "none");
    const reviewPolicy = pick(task.reviewPolicy ?? task.review_policy, reviewPolicies, "automatic");
    counts.enums += Number(placement.fixed && task.placement !== undefined) + Number(sideEffect.fixed && (task.sideEffect ?? task.side_effect) !== undefined)
      + Number(reviewPolicy.fixed && (task.reviewPolicy ?? task.review_policy) !== undefined);

    const capabilityInput = Array.isArray(task.requiredCapabilities) ? task.requiredCapabilities
      : Array.isArray(task.capabilities) ? task.capabilities : [];
    const capabilities = [...new Set(capabilityInput.map((c) => text(c).toLowerCase()).filter((c) => c.length >= 3 && c.length <= 80 && CAPABILITY.test(c)))].slice(0, 10);
    if (capabilities.length !== capabilityInput.length) counts.capabilities++;

    const ownerRaw = text(task.ownerSeat ?? task.owner ?? task.owner_seat);
    const owner = ownerRaw.length > 0 && ownerRaw.length <= 40 ? ownerRaw : null;
    const inputs = (Array.isArray(task.inputs) ? task.inputs : []).map(text).filter((id) => ID.test(id)).slice(0, 10);
    const expected = typeof task.expectedFiles === "number" && Number.isFinite(task.expectedFiles) ? Math.round(task.expectedFiles) : 0;

    const known = new Set(["title", "goal", "acceptance", "expectedFiles", "requiredCapabilities", "placement", "sideEffect",
      "reviewPolicy", "ownerSeat", "dependsOn", "inputs"]);
    const unknown = Object.keys(task).filter((key) => !known.has(key));
    for (const key of unknown) {
      const value = text(task[key]) || (Array.isArray(task[key]) ? (task[key] as unknown[]).map(text).filter(Boolean).join(", ") : "");
      if (value && !["description", "summary", "name", "owner", "owner_seat", "side_effect", "review_policy", "depends_on", "dependencies", "capabilities"].includes(key))
        extra.push(`${key}: ${value}`);
    }
    if (unknown.length) counts.keys++;

    briefs.push([goalFull, ...extra].join("\n").slice(0, MAX_BRIEF));
    return {
      title, goal, acceptance, expectedFiles: Math.min(200, Math.max(0, expected)), requiredCapabilities: capabilities,
      placement: placement.value, sideEffect: sideEffect.value, reviewPolicy: reviewPolicy.value,
      ...(owner === null ? {} : { ownerSeat: owner }), dependsOn: dependsOn[index] ?? [], ...(inputs.length ? { inputs } : {}),
    };
  });
  if (counts.title) fixes.add(`shortened ${counts.title} title(s)`);
  if (counts.goal) fixes.add(`shortened ${counts.goal} goal(s) to 500 characters (full text kept in the task brief)`);
  if (counts.criteria) fixes.add(`shortened ${counts.criteria} acceptance criterion(s) (full text kept in the brief)`);
  if (counts.extraCriteria) fixes.add(`moved criteria beyond 8 into the brief of ${counts.extraCriteria} task(s)`);
  if (counts.enums) fixes.add("corrected placement, side effect or review values");
  if (counts.capabilities) fixes.add("dropped invalid capability names");
  if (counts.keys) fixes.add("moved unknown task fields into the brief");

  const hasTest = normalized.some((task) => task.requiredCapabilities.some((c) => c.startsWith("test.")));
  let testingReason = text(root.testingReason).slice(0, 1_000);
  if (!hasTest && !testingReason) {
    testingReason = "No test task in this plan (added by the Host; the Lead gave no reason).";
    fixes.add("the plan has no test task");
  }
  return { value: { tasks: normalized, ...(testingReason ? { testingReason } : {}) }, briefs, fixes: [...fixes] };
}
