// Free tests: no model, no network, no codex process.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildArgs, buildEnv, classifyError, parseEvents } from "./codex.mjs";
import { findSecrets, redact } from "./redact.mjs";
import { advance, classify, decide, suggestAction, validatePolicy } from "./router.mjs";
import { checkAnswerRules, checkIdentifiers, checkScope, diffSnapshots, parseTap } from "./verify.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(readFileSync(path.join(here, "..", "routing-policy.json"), "utf8"));
const fresh = { callsTotal: 0, taskCalls: 0, retries: 0, stepIndex: null, model: null };
const card = (over = {}) => ({ id: "x", declaredClass: "simple", expectedFiles: 1, contextSize: "small", riskFlags: [], sandbox: "read-only", ...over });

test("the shipped policy is valid and never allows max/ultra or full access", () => {
  assert.deepEqual(validatePolicy(policy), []);
  assert.ok(!policy.allowedSandboxes.includes("danger-full-access"));
  for (const m of Object.values(policy.models)) for (const e of m.efforts) assert.ok(!["max", "ultra"].includes(e));
});

test("a policy that lists a forbidden effort or an unapproved ladder model is rejected", () => {
  const bad = structuredClone(policy);
  bad.models["gpt-6.1-sol"].efforts.push("ultra");
  bad.classes.simple.ladder.push({ model: "ds/deepseek-v4-flash", effort: "low" });
  const problems = validatePolicy(bad).join(" | ");
  assert.match(problems, /forbidden effort ultra/);
  assert.match(problems, /not in the approved list/);
});

test("classification uses signals and never lowers the declared class", () => {
  assert.equal(classify(card(), policy).class, "simple");
  assert.equal(classify(card({ expectedFiles: 5 }), policy).class, "medium");
  assert.equal(classify(card({ expectedFiles: 12, contextSize: "large" }), policy).class, "complex");
  assert.equal(classify(card({ declaredClass: "complex" }), policy).class, "complex"); // signals say simple, declared wins
});

test("any risk flag forces critical, and unknown flags are refused", () => {
  const r = classify(card({ riskFlags: ["security"] }), policy);
  assert.equal(r.class, "critical");
  assert.ok(r.forced);
  assert.throws(() => classify(card({ riskFlags: ["made-up"] }), policy), /unknown risk flags/);
});

test("simple tasks start on the lightest approved step", () => {
  const d = decide(card(), fresh, policy);
  assert.equal(d.allowed, true);
  assert.deepEqual([d.model, d.effort, d.modelStatus], ["gpt-6-luna", "low", "listed"]);
});

test("critical tasks do not run without explicit human approval", () => {
  const d = decide(card({ riskFlags: ["data"] }), fresh, policy);
  assert.equal(d.allowed, false);
  assert.equal(d.requiresApproval, true);
  assert.equal(decide(card({ riskFlags: ["data"], approvedCritical: true }), fresh, policy).allowed, true);
});

test("sandbox outside the allowlist is refused", () => {
  const d = decide(card({ sandbox: "danger-full-access" }), fresh, policy);
  assert.equal(d.allowed, false);
  assert.match(d.why, /not allowed/);
});

test("escalation moves one ladder step at a time and then stops", () => {
  let state = { ...fresh, taskCalls: 1, stepIndex: 0, model: "gpt-6-luna" };
  const step1 = advance(card(), state, { action: "escalate" }, policy);
  assert.equal(step1.done, false);
  assert.equal(step1.state.stepIndex, 1);
  const d = decide(card(), { ...state, ...step1.state }, policy);
  assert.deepEqual([d.model, d.effort], ["gpt-6.1-sol", "medium"]);
  state = { ...state, ...step1.state };
  const step2 = advance(card(), state, { action: "escalate" }, policy);
  assert.equal(step2.done, true);
  assert.match(step2.why, /ladder exhausted/);
});

test("retry is allowed once per task", () => {
  let state = { ...fresh, taskCalls: 1, stepIndex: 0 };
  const first = advance(card(), state, { action: "retry" }, policy);
  assert.equal(first.done, false);
  state = { ...state, ...first.state };
  assert.equal(advance(card(), state, { action: "retry" }, policy).done, true);
});

test("fallback only goes to an approved same-provider model", () => {
  const state = { ...fresh, taskCalls: 1, stepIndex: 0, model: "gpt-6.1-sol" };
  const medium = card({ declaredClass: "medium" });
  const fb = advance(medium, state, { action: "fallback" }, policy);
  assert.equal(fb.state.model, "gpt-6-sol");
  const d = decide(medium, { ...state, ...fb.state }, policy);
  assert.deepEqual([d.provider, d.model, d.effort], ["9router", "gpt-6-sol", "medium"]);
  assert.equal(advance(medium, { ...state, model: "gpt-6-sol" }, { action: "fallback" }, policy).done, true); // no chain
});

test("global and per-task call limits stop the router", () => {
  assert.match(decide(card(), { ...fresh, callsTotal: policy.limits.maxCallsPerDay }, policy).why, /daily call budget/);
  assert.match(decide(card(), { ...fresh, taskCalls: 2 }, policy).why, /per-task call limit/);
});

test("suggestions never spend calls on non-capability failures", () => {
  assert.equal(suggestAction({ errorKind: "config", checksPassed: false, attempt: 1 }).action, "stop");
  assert.equal(suggestAction({ errorKind: "rate_limit", checksPassed: false, attempt: 1 }).action, "stop");
  assert.equal(suggestAction({ errorKind: "model_unavailable", checksPassed: false, attempt: 1 }).action, "fallback");
  assert.equal(suggestAction({ errorKind: null, checksPassed: false, attempt: 1 }).action, "escalate");
  assert.equal(suggestAction({ errorKind: null, checksPassed: false, attempt: 2 }).action, "stop");
  assert.equal(suggestAction({ errorKind: null, checksPassed: true, attempt: 1 }).action, "accept");
});

test("codex arguments: no shell tricks, prompt from stdin, user config ignored, no dangerous flags", () => {
  const d = decide(card(), fresh, policy);
  const args = buildArgs({ policy, decision: d, workdir: "C:/w", lastMessageFile: "C:/w/last.md" });
  assert.equal(args[0], "exec");
  assert.ok(args.includes("--ignore-user-config") && args.includes("--ephemeral") && args.includes("--json"));
  assert.equal(args.at(-1), "-");
  assert.ok(args.includes('model_reasoning_effort="low"'));
  assert.ok(!args.some((a) => a.includes("dangerously") || a.includes("danger-full-access")));
  assert.throws(() => buildArgs({ policy, decision: { ...d, sandbox: "danger-full-access" }, workdir: "x", lastMessageFile: "y" }), /sandbox not allowed/);
  assert.throws(() => buildArgs({ policy, decision: { ...d, effort: "ultra" }, workdir: "x", lastMessageFile: "y" }), /effort not allowed/);
  assert.ok(!args.join(" ").includes("sk-"));
});

test("the child environment is an allowlist that carries only the provider key by name", () => {
  const env = buildEnv(policy, { PATH: "p", SystemRoot: "s", NINE_ROUTER_API_KEY: "k", OPENAI_API_KEY: "other", OPENPROJECT_API_TOKEN: "t", RANDOM: "r" });
  assert.deepEqual(Object.keys(env).sort(), ["NINE_ROUTER_API_KEY", "PATH", "SystemRoot"]);
});

test("secrets are detected in prompts and redacted in logs", () => {
  const env = { NINE_ROUTER_API_KEY: "abcdef1234567890SECRETVALUE" };
  assert.deepEqual(findSecrets("hello world", env), []);
  assert.ok(findSecrets("token = abcdefghijklmnop1234", env).length > 0);
  assert.ok(findSecrets("use sk-abcdefghijklmnopqrstuvwx now", env).includes("sk-token"));
  assert.ok(findSecrets("key is abcdef1234567890SECRETVALUE", env).includes("env:NINE_ROUTER_API_KEY"));
  const out = redact("Authorization: Bearer abcdefghijklmnopqrstuvwxyz and abcdef1234567890SECRETVALUE", env);
  assert.ok(!out.includes("abcdef1234567890SECRETVALUE") && !out.includes("abcdefghijklmnopqrstuvwxyz"));
});

test("event parsing is tolerant and extracts usage, answer and errors when present", () => {
  const jsonl = [
    '{"type":"thread.started","thread_id":"t1"}',
    '{"type":"turn.started"}',
    '{"type":"item.started","item":{"type":"command_execution","command":"ls"}}',
    '{"type":"item.completed","item":{"type":"command_execution","command":"ls"}}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}',
    '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":4,"output_tokens":3}}',
    "not json",
  ].join("\n");
  const s = parseEvents(jsonl);
  assert.equal(s.turnCompleted, true);
  assert.equal(s.lastAgentMessage, "done");
  assert.equal(s.commandCount, 1);
  assert.deepEqual(s.usage, { input_tokens: 10, cached_input_tokens: 4, output_tokens: 3 });
  assert.equal(s.parseErrors, 1);
  assert.equal(parseEvents("").usage, null);
});

test("error classification separates config, auth, model and timeout problems", () => {
  const none = parseEvents("");
  assert.equal(classifyError({ exitCode: 1, timedOut: false, stderr: "unknown provider", summary: none }), "config");
  assert.equal(classifyError({ exitCode: 1, timedOut: false, stderr: "HTTP 401 unauthorized", summary: none }), "auth");
  assert.equal(classifyError({ exitCode: 1, timedOut: false, stderr: "model gpt-x not found", summary: none }), "model_unavailable");
  assert.equal(classifyError({ exitCode: null, timedOut: true, stderr: "", summary: none }), "timeout");
  assert.equal(classifyError({ exitCode: 0, timedOut: false, stderr: "", summary: parseEvents('{"type":"turn.started"}\n{"type":"turn.completed"}') }), null);
});

test("verification helpers", () => {
  assert.deepEqual(diffSnapshots({ a: "1", b: "2" }, { a: "1", b: "3", c: "4" }), ["b", "c"]);
  assert.equal(checkScope(["x/src/a.mjs"], ["x/src/"]).pass, true);
  assert.equal(checkScope(["y/other.txt"], ["x/src/"]).pass, false);
  assert.equal(checkScope(["any"], []).pass, false);
  assert.deepEqual(parseTap("# tests 6\n# pass 5\n# fail 1\n"), { tests: 6, pass: 5, fail: 1 });
  const rules = checkAnswerRules("It uses blockedReason first", [{ id: "a", anyOf: ["blockedReason"] }, { id: "b", anyOf: ["testingReason"] }]);
  assert.deepEqual(rules.map((r) => r.pass), [true, false]);
  const src = path.join(here, "router.mjs");
  const ok = checkIdentifiers("`startIndex` `maxClass` `validatePolicy` `suggestAction` `requiresApproval` `madeUpThing`", src, { minRatio: 0.7, minCount: 5 });
  assert.equal(ok.pass, true);
  const bad = checkIdentifiers("`fakeOne` `fakeTwo` `fakeThree` `fakeFour` `fakeFive`", src, { minRatio: 0.7, minCount: 5 });
  assert.equal(bad.pass, false);
});

// ---- additions for the skill: daily budget, npm allowlist, protected paths ------------------------------
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createBudget } from "./budget.mjs";
import { runNpmCheck } from "./verify.mjs";

test("the call budget is per day, per-task state survives the day, and a limit stops the call", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "codex-routing-"));
  try {
    let day = "2026-11-07";
    const b = createBudget(path.join(dir, "budget.json"), () => day);
    const limits = { maxCallsPerDay: 2, maxCallsPerTask: 2 };
    assert.equal(b.reserveCall("t1", limits), 1);
    assert.equal(b.reserveCall("t2", limits), 2);
    assert.throws(() => b.reserveCall("t3", limits), /daily call budget/);
    assert.equal(b.read("t3").taskCalls, 0); // refused call is not counted
    day = "2026-11-08"; // new day: the daily counter resets, the task keeps its history
    assert.equal(b.read("t1").callsTotal, 0);
    assert.equal(b.read("t1").taskCalls, 1);
    assert.equal(b.reserveCall("t1", limits), 1);
    assert.throws(() => b.reserveCall("t1", limits), /per-task call limit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("only whitelisted npm scripts can be used as acceptance checks", () => {
  for (const npm of [["install"], ["run", "evil"], ["publish"], ["exec", "x"]])
    assert.throws(() => runNpmCheck({ id: "x", cwd: ".", npm }, process.cwd()), /not allowed/);
});

test("the policy protects V1 and the architecture docs from delegated writes", () => {
  for (const p of ["apps/windows-worker/", "apps/api/", "docs/", "schema/", ".git/", ".claude/"])
    assert.ok(policy.alwaysForbiddenPrefixes.includes(p), p);
});

test("a critical task never reaches Codex without explicit approval, and approval does not lower the effort", () => {
  const c = card({ riskFlags: ["security"], sandbox: "workspace-write" });
  const blocked = decide(c, fresh, policy);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.requiresApproval, true);
  const approved = decide({ ...c, approvedCritical: true }, fresh, policy);
  assert.equal(approved.allowed, true);
  assert.equal(approved.effort, "xhigh");
});

test("the model can only change by following the policy: no ad-hoc model, no max or ultra", () => {
  const d = decide(card({ model: "gpt-9-ultra", effort: "max" }), fresh, policy);
  assert.ok(["gpt-6-luna", "gpt-6.1-sol"].includes(d.model));
  assert.ok(!["max", "ultra"].includes(d.effort));
});

test("an allowed npm check really runs package scripts (needs ComSpec on Windows)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "codex-routing-npm-"));
  try {
    writeFileSync(path.join(dir, "pass.mjs"), ["# tests 2", "# pass 2", "# fail 0"].map((l) => `console.log(${JSON.stringify(l)});`).join(String.fromCharCode(10)));
    writeFileSync(path.join(dir, "fail.mjs"), "process.exit(1);");
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0", scripts: { test: "node pass.mjs", check: "node fail.mjs" } }));
    const ok = runNpmCheck({ id: "t", cwd: path.basename(dir), npm: ["test"], minTests: 2 }, path.dirname(dir));
    assert.equal(ok.pass, true, ok.detail);
    const bad = runNpmCheck({ id: "c", cwd: path.basename(dir), npm: ["run", "check"] }, path.dirname(dir));
    assert.equal(bad.pass, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
