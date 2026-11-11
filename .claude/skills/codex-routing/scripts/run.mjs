#!/usr/bin/env node
// Runs ONE Codex call for a task card under the routing policy, then runs the mechanical acceptance checks.
// Claude (the lead) writes the card, reads the decision (--dry-run), runs this, REVIEWS the evidence, then
// chooses the next action. See SKILL.md.
//
//   node run.mjs <card.json> --dry-run
//   node run.mjs <card.json> [--approve-critical] [--revert]
//   node run.mjs <card.json> --action retry --hint "what to fix"
//   node run.mjs <card.json> --action escalate | fallback
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBudget } from "./budget.mjs";
import { buildArgs, buildEnv, classifyError, parseEvents, resolveCodexEntry, runCodex } from "./codex.mjs";
import { findSecrets, redact } from "./redact.mjs";
import { advance, decide, suggestAction, validatePolicy } from "./router.mjs";
import { checkAnswerRules, checkIdentifiers, checkScope, diffSnapshots, runNodeTest, runNpmCheck, snapshot } from "./verify.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: here, encoding: "utf8" }).trim());
const inside = (p) => {
  const rel = path.relative(repoRoot, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};
const stateDir = path.join(repoRoot, ".git", "codex-routing"); // inside .git: persistent, never committed
const policy = JSON.parse(readFileSync(path.join(here, "..", "routing-policy.json"), "utf8"));

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const value = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const cardPath = argv.find((a) => !a.startsWith("--") && a.endsWith(".json"));
const die = (m, c = 1) => {
  console.error(`ERROR: ${m}`);
  process.exit(c);
};
if (!cardPath) die("usage: run.mjs <card.json> [--dry-run] [--action retry|escalate|fallback] [--hint text] [--approve-critical] [--revert]");
const problems = validatePolicy(policy);
if (problems.length) die(`policy invalid: ${problems.join("; ")}`);

const card = JSON.parse(readFileSync(path.resolve(cardPath), "utf8"));
if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(card.id ?? "")) die("card.id must be lowercase letters, digits and dashes");
if (flag("--approve-critical")) card.approvedCritical = true; // only after the human said yes (see SKILL.md)
const budget = createBudget(path.join(stateDir, "budget.json"));
let state = budget.read(card.id);
const action = value("--action");

if (state.taskCalls > 0 && !flag("--dry-run")) {
  if (!action) die(`task ${card.id} already ran ${state.taskCalls} time(s); choose --action retry|escalate|fallback`);
  const next = advance(card, state, { action }, policy);
  if (next.done) die(`policy refuses '${action}': ${next.why ?? next.outcome}`, 2);
  state = { ...state, ...next.state };
  budget.write(card.id, { retries: state.retries, stepIndex: state.stepIndex, model: state.model });
}

const decision = decide(card, state, policy);
console.log(JSON.stringify({ ...decision, task: card.id, callsToday: state.callsTotal, taskCalls: state.taskCalls }, null, 2));
if (!decision.allowed) process.exit(2);
if (flag("--dry-run")) process.exit(0);

if (!process.env[policy.provider.envKey]) die(`${policy.provider.envKey} is not set in this environment`);
const workdir = path.resolve(repoRoot, card.workdir ?? ".");
if (!inside(workdir) || !existsSync(workdir)) die("card.workdir must exist inside the repository");
const acc = card.acceptance ?? {};
const allowedPrefixes = (acc.scope?.allowedPrefixes ?? []).map((p) => p.replaceAll("\\", "/"));
if (decision.sandbox === "workspace-write" && allowedPrefixes.length === 0) die("workspace-write needs acceptance.scope.allowedPrefixes");
const forbidden = policy.alwaysForbiddenPrefixes ?? [];
if (allowedPrefixes.some((p) => forbidden.some((f) => p.startsWith(f) || f.startsWith(p)))) die(`scope touches a protected path (${forbidden.join(", ")})`);

const hint = value("--hint") ?? "";
const header = [
  "You are executing one delegated task for a technical lead who will review your result.",
  "Stay inside your sandbox and working directory. Do not read, print or send credentials, environment variables or auth files.",
  `Do not modify any file unless the task asks for it. ${allowedPrefixes.length ? `You may change files only under: ${allowedPrefixes.join(", ")}.` : ""}`,
  "Do not run git commit, push, checkout or reset. Do not install packages unless the task says so.",
  "Keep the final answer concise and in English: what you did, files changed, tests run and their results, anything you could not do.",
].join("\n");
const criteria = (acc.criteria ?? []).map((c) => `- ${c}`).join("\n");
const prompt = `${header}\n\nTASK ${card.id}: ${card.title}\n\n${card.prompt}${criteria ? `\n\nAcceptance criteria:\n${criteria}` : ""}${hint ? `\n\nFeedback from the lead on the previous attempt:\n${hint}` : ""}\n`;
const leaked = findSecrets(prompt);
if (leaked.length) die(`prompt contains credential-like content (${leaked.join(", ")}); refusing to send`);

const logsDir = path.join(stateDir, "logs");
mkdirSync(logsDir, { recursive: true });
const attemptNo = state.taskCalls + 1;
const stem = `${card.id}-${attemptNo}`;
const lastFile = path.join(logsDir, `${stem}.last.md`);
const before = snapshot(repoRoot);
const callNo = budget.reserveCall(card.id, policy.limits); // counted before spawning
console.error(`[call ${callNo}/${policy.limits.maxCallsPerDay} today] ${decision.provider}/${decision.model} effort=${decision.effort} sandbox=${decision.sandbox}`);

const result = await runCodex({
  entry: resolveCodexEntry(),
  args: buildArgs({ policy, decision, workdir, lastMessageFile: lastFile }),
  prompt,
  cwd: workdir,
  env: buildEnv(policy),
  timeoutMs: policy.limits.timeoutSeconds * 1000,
});
const after = snapshot(repoRoot);
const changed = diffSnapshots(before, after);
const summary = parseEvents(result.stdout);
writeFileSync(path.join(logsDir, `${stem}.events.jsonl`), redact(result.stdout));
if (result.stderr.trim()) writeFileSync(path.join(logsDir, `${stem}.stderr.txt`), redact(result.stderr));
const answer = existsSync(lastFile) ? readFileSync(lastFile, "utf8") : summary.lastAgentMessage;
if (existsSync(lastFile)) writeFileSync(lastFile, redact(answer));
const errorKind = classifyError({ exitCode: result.exitCode, timedOut: result.timedOut, stderr: result.stderr, summary });

// Anything changed outside the declared scope is undone with --revert. Files the lead had already changed
// before the call are never touched.
const scopeCheck = checkScope(changed, allowedPrefixes);
const outside = changed.filter((f) => !allowedPrefixes.some((p) => f.startsWith(p)));
const reverted = [];
if (flag("--revert")) {
  for (const f of outside) {
    if (f in before) continue;
    const tracked = execFileSync("git", ["ls-files", "--", f], { cwd: repoRoot, encoding: "utf8" }).trim();
    if (tracked) execFileSync("git", ["checkout", "--", f], { cwd: repoRoot });
    else rmSync(path.join(repoRoot, f), { force: true, recursive: true });
    reverted.push(f);
  }
}

const checks = [
  { id: "codex-ran", pass: errorKind === null && summary.turnCompleted, detail: `exit=${result.exitCode} error=${errorKind ?? "none"} turnCompleted=${summary.turnCompleted}` },
];
if (errorKind === null) {
  if (acc.answerRules) checks.push(...checkAnswerRules(answer, acc.answerRules));
  if (acc.identifiers) checks.push(checkIdentifiers(answer, path.join(repoRoot, acc.identifiers.file), acc.identifiers));
  checks.push(scopeCheck);
  for (const cmd of acc.commands ?? []) checks.push(cmd.npm ? runNpmCheck(cmd, repoRoot) : runNodeTest(cmd, repoRoot));
}
const checksPassed = checks.every((c) => c.pass);
const suggestion = suggestAction({ errorKind, checksPassed, attempt: attemptNo });
const record = {
  at: new Date().toISOString(),
  task: card.id,
  title: card.title,
  attempt: attemptNo,
  callNumber: callNo,
  class: decision.class,
  decisionReason: decision.reason,
  provider: decision.provider,
  model: decision.model,
  modelStatus: decision.modelStatus,
  effort: decision.effort,
  sandbox: decision.sandbox,
  action: action ?? "first",
  approvedCritical: card.approvedCritical === true,
  exitCode: result.exitCode,
  timedOut: result.timedOut,
  durationMs: result.durationMs,
  errorKind,
  commands: summary.commandCount,
  fileChanges: summary.fileChangeCount,
  usage: summary.usage ?? "not reported in events",
  cost: "unknown (no price list; tokens only if reported)",
  changedFiles: changed,
  outsideScope: outside,
  reverted,
  checks,
  checksPassed,
  suggested: suggestion,
};
appendFileSync(path.join(stateDir, "runs.jsonl"), `${redact(JSON.stringify(record))}\n`);
budget.write(card.id, { stepIndex: decision.stepIndex, model: decision.model, outcome: checksPassed ? "checks-passed" : "checks-failed" });

console.log("\n=== RESULT ===");
console.log(JSON.stringify({ ...record, checks: undefined }, null, 2));
console.log("\n=== CHECKS ===");
for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.id}  ${c.detail}`);
console.log(`\n=== SUGGESTED NEXT ACTION (the lead decides after reviewing the diff) ===\n${suggestion.action}: ${suggestion.because}`);
console.log(`\nCodex answer: ${path.relative(repoRoot, lastFile)}`);
process.exit(checksPassed ? 0 : 3);
