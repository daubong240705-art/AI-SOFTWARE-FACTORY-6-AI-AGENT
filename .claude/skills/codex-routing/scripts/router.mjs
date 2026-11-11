// Pure routing logic: no IO, no process spawning. Everything is decided from the
// policy (data) and the task card, so decisions are deterministic and auditable.

export const CLASS_ORDER = ["simple", "medium", "complex", "critical"];
const CONTEXT_ORDER = ["small", "medium", "large"];

const rank = (cls) => CLASS_ORDER.indexOf(cls);
const maxClass = (a, b) => (rank(a) >= rank(b) ? a : b);

export function validatePolicy(policy) {
  const problems = [];
  const forbidden = new Set(policy.forbiddenEfforts ?? []);
  const sandboxes = policy.allowedSandboxes ?? [];
  if (sandboxes.includes("danger-full-access")) problems.push("danger-full-access must never be allowed");
  for (const [name, model] of Object.entries(policy.models)) {
    for (const effort of model.efforts) {
      if (forbidden.has(effort)) problems.push(`${name}: forbidden effort ${effort}`);
    }
  }
  for (const [cls, def] of Object.entries(policy.classes)) {
    for (const step of def.ladder) {
      const model = policy.models[step.model];
      if (!model) problems.push(`${cls}: model ${step.model} is not in the approved list`);
      else if (!model.efforts.includes(step.effort)) problems.push(`${cls}: ${step.model} does not allow effort ${step.effort}`);
    }
  }
  for (const [from, to] of Object.entries(policy.fallbacks ?? {})) {
    if (!policy.models[from] || !policy.models[to]) problems.push(`fallback ${from} -> ${to} uses an unapproved model`);
  }
  return problems;
}

// classify never lowers: the result is the highest of the declared class, the class
// implied by the measurable signals, and "critical" when any risk flag is present.
export function classify(card, policy) {
  const reasons = [];
  const declared = card.declaredClass ?? "simple";
  if (rank(declared) < 0) throw new Error(`unknown declaredClass: ${declared}`);
  let result = declared;
  reasons.push(`declared=${declared}`);

  const files = Number(card.expectedFiles ?? 1);
  const context = card.contextSize ?? "small";
  if (!CONTEXT_ORDER.includes(context)) throw new Error(`unknown contextSize: ${context}`);
  const { simple, medium } = policy.classification;
  let computed = "complex";
  if (files <= simple.maxFiles && CONTEXT_ORDER.indexOf(context) <= CONTEXT_ORDER.indexOf(simple.maxContext)) computed = "simple";
  else if (files <= medium.maxFiles && CONTEXT_ORDER.indexOf(context) <= CONTEXT_ORDER.indexOf(medium.maxContext)) computed = "medium";
  reasons.push(`signals(files=${files}, context=${context})=>${computed}`);
  result = maxClass(result, computed);

  const known = new Set(policy.riskFlags);
  const flags = card.riskFlags ?? [];
  const unknown = flags.filter((f) => !known.has(f));
  if (unknown.length) throw new Error(`unknown risk flags: ${unknown.join(", ")}`);
  if (flags.length) {
    reasons.push(`risk flags force critical: ${flags.join(", ")}`);
    result = "critical";
  }
  return { class: result, reasons, forced: flags.length > 0 };
}

function startIndex(card, ladder) {
  // Priority shifts the start by at most one step and never below the class floor.
  const p = card.priorities ?? {};
  const quality = Number(p.quality ?? 3);
  const cost = Number(p.cost ?? 3);
  const speed = Number(p.speed ?? 3);
  if (quality >= 5 && cost <= 3) return Math.min(1, ladder.length - 1);
  if ((cost >= 4 || speed >= 4) && quality <= 3) return 0;
  return 0;
}

// state: { callsTotal, taskCalls, retries, stepIndex, model }  (stepIndex null before the first call)
export function decide(card, state, policy) {
  const problems = validatePolicy(policy);
  if (problems.length) return stop(`policy invalid: ${problems.join("; ")}`);

  const cls = classify(card, policy);
  const def = policy.classes[cls.class];
  const sandbox = card.sandbox ?? "read-only";
  if (!policy.allowedSandboxes.includes(sandbox)) return stop(`sandbox ${sandbox} is not allowed`, cls);

  if (state.callsTotal >= policy.limits.maxCallsPerDay) return stop("daily call budget exhausted", cls);
  if (state.taskCalls >= policy.limits.maxCallsPerTask) return stop("per-task call limit reached", cls);

  if (def.requiresApproval && card.approvedCritical !== true) {
    return { ...stop("critical task needs explicit human approval before Codex runs", cls), requiresApproval: true };
  }

  const index = state.stepIndex ?? startIndex(card, def.ladder);
  const step = def.ladder[index];
  if (!step) return stop("escalation ladder exhausted", cls);

  const model = state.model && state.stepIndex === index ? state.model : step.model;
  return allowed(card, cls, model, step.effort, sandbox, index, policy, state);
}

function allowed(card, cls, model, effort, sandbox, stepIndex, policy, state) {
  const def = policy.models[model];
  if (!def) return stop(`model ${model} is not in the approved list`, cls);
  if ((policy.forbiddenEfforts ?? []).includes(effort)) return stop(`effort ${effort} is forbidden`, cls);
  if (!def.efforts.includes(effort)) return stop(`${model} does not allow effort ${effort}`, cls);
  return {
    allowed: true,
    class: cls.class,
    classReasons: cls.reasons,
    provider: policy.provider.id,
    model,
    effort,
    sandbox,
    stepIndex,
    modelStatus: def.status,
    reason: `class=${cls.class}; ladder step ${stepIndex}; model status=${def.status}; ${cls.reasons.join("; ")}`,
    callNumber: state.callsTotal + 1,
  };
}

function stop(why, cls) {
  return { allowed: false, stop: true, why, class: cls?.class ?? null, classReasons: cls?.reasons ?? [] };
}

// Next state after a verdict. Claude supplies the verdict; the policy decides what is permitted.
//   accept    -> done
//   retry     -> same step, at most limits.maxRetriesPerTask times (needs a revised prompt)
//   escalate  -> next ladder step (effort or model), never skipping, never beyond the ladder
//   fallback  -> approved same-provider fallback model, only for "model_unavailable"
//   stop      -> done without success
export function advance(card, state, verdict, policy) {
  const cls = classify(card, policy);
  const ladder = policy.classes[cls.class].ladder;
  const next = { ...state };
  switch (verdict.action) {
    case "accept":
    case "stop":
      return { done: true, outcome: verdict.action, state: next };
    case "retry":
      if (state.retries >= policy.limits.maxRetriesPerTask) return { done: true, outcome: "stop", why: "retry limit reached", state: next };
      next.retries = state.retries + 1;
      return { done: false, state: next };
    case "escalate": {
      const target = (state.stepIndex ?? 0) + 1;
      if (target >= ladder.length) return { done: true, outcome: "stop", why: "escalation ladder exhausted", state: next };
      next.stepIndex = target;
      next.model = ladder[target].model;
      return { done: false, state: next };
    }
    case "fallback": {
      const current = state.model ?? ladder[state.stepIndex ?? 0].model;
      const to = policy.fallbacks?.[current];
      if (!to) return { done: true, outcome: "stop", why: `no approved fallback for ${current}`, state: next };
      next.model = to;
      return { done: false, state: next };
    }
    default:
      throw new Error(`unknown action: ${verdict.action}`);
  }
}

// Suggest (never apply) the next action from mechanical evidence. Claude may overrule after review.
export function suggestAction({ errorKind, checksPassed, attempt }) {
  if (checksPassed) return { action: "accept", because: "all automated acceptance checks passed (Claude must still review content)" };
  if (errorKind === "model_unavailable") return { action: "fallback", because: "model rejected by provider" };
  if (errorKind === "config" || errorKind === "auth" || errorKind === "rate_limit" || errorKind === "timeout")
    return { action: "stop", because: `${errorKind}: not a capability problem, do not spend more calls` };
  if (attempt === 1) return { action: "escalate", because: "acceptance failed; try the next ladder step" };
  return { action: "stop", because: "repeated failure" };
}
