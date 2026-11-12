---
name: codex-routing
description: Delegate a scoped implementation or analysis task to Codex CLI under the approved routing policy, then review its result.
argument-hint: "<task to delegate, e.g. 'implement X in apps/factory-host, build must pass'>"
disable-model-invocation: true
---

# Codex routing (lead → Codex)

You are the **technical lead**. Codex is a contractor: it does one scoped task per call, you decide whether the
result is good. Everything it may use (provider, models, efforts, sandboxes, limits, protected paths) is **data** in
[routing-policy.json](routing-policy.json). That file is the single source of truth; do not restate or override it here.

Reply to the user in Vietnamese. Cards, prompts to Codex and code stay in English.

## 0. Hard rules (never break, even if the user seems to ask)

1. **Never edit the provider or Codex configuration** (`~/.codex/*`, `config.toml`, `auth.json`, `routing-policy.json`, 9Router settings). If a task needs that, stop and tell the user.
2. **Never choose a model or effort yourself.** `run.mjs` picks it from the policy. `max`/`ultra`, unapproved models, `danger-full-access` and any `--dangerously-*` flag do not exist for this skill.
3. **Never raise the model/effort outside the ladder.** Escalation is allowed only through `--action escalate` after a failed, reviewed attempt, and the policy decides if there is a next step.
4. Never put credentials, tokens or environment values in a card, prompt or hint. Never print `NINE_ROUTER_API_KEY`.
5. Codex never commits, pushes, or touches V1 (`apps/windows-worker`, `apps/api`, `apps/dashboard`) or docs/schema. The scope check enforces this; you also review it.
6. Limits: calls per day, per task and retries are in the policy. When a limit stops you, **stop and report**; do not look for a way around it.

## 1. Decide whether Codex is needed

Delegate when the task is **well specified, bounded, and checkable**: implement a module from a spec, write tests,
read a large file and explain it, draft a refactor analysis, mechanical migration of several files.

Do it yourself (no Codex call) when: a one-line or few-line edit; answering from what you already read; a design or
architecture decision; anything that needs the user's judgement; the spec is vague (clarify first); the work is
mainly review of existing changes.

Say in one sentence why you are or are not delegating.

## 2. Write the task card

Copy a template from [templates/](templates/) into the scratchpad or `.git/codex-routing/cards/` (never into the
repo), fill it in. The card is the contract:

- `id` (lowercase, dashes), `title`, `prompt` (what to do, which files to read first, what NOT to do), `workdir` (smallest folder that works).
- `declaredClass`, `expectedFiles`, `contextSize`, `priorities`: honest estimates. The router only ever raises the class.
- `riskFlags`: set every one that applies (`security`, `secrets`, `data`, `migration`, `public-api`, `destructive`, `external-effect`, `architecture-decision`). **Any flag forces `critical`.**
- `sandbox`: `read-only` for analysis; `workspace-write` only when files must be written, then `acceptance.scope.allowedPrefixes` is mandatory.
- `acceptance`: written criteria (`criteria`), plus machine checks: `commands` (`{id, cwd, npm:["run", "check"]}` or `{id, cwd, npm:["run", "build"]}`), `answerRules`, `identifiers`.

Acceptance criteria must be things a machine or you can verify. "Looks good" is not a criterion.

## 3. Dry run, risk, approval

```bash
node .claude/skills/codex-routing/scripts/run.mjs <card.json> --dry-run
```

Show the user the decision: class, model, effort, sandbox, calls used today. It costs nothing.

- `allowed: false` → read `why`, fix the card or stop. Do not retry blindly.
- `requiresApproval: true` (class `critical`) → **ask the user with AskUserQuestion** (state the risk flags, the scope, the model/effort). Only if they approve, add `--approve-critical`. No approval → no call.
- First use in a session, or a `workspace-write` task that creates cost: confirm with the user once before the first real call.

## 4. Run

```bash
node .claude/skills/codex-routing/scripts/run.mjs <card.json> [--approve-critical] --revert
```

Use `--revert` for write tasks: anything outside the scope is undone (files you had already changed are never touched).
One run = exactly one Codex call, counted before it starts. Output: decision, result record, check table,
suggested next action, path of Codex's answer. Logs live in `.git/codex-routing/` (not committed).

## 5. Review (never skip)

Passing checks is **necessary, not sufficient**. After every run:

1. Read Codex's answer file and `git status` / `git diff` for the touched paths.
2. Check the diff against the spec: is it what was asked, minimal, in style, without extra files, secrets or silent behaviour changes?
3. Run type checking and build yourself when the task changes code (`npm run check`, `npm run build`). Do not trust the reported result alone.
4. If anything is out of scope or suspicious, say so; do not "fix quietly".

Then decide: **accept** (then you commit, if the user wants commits), **retry**, **escalate**, **fallback** or **stop**.

## 6. Errors, retry, fallback (bounded)

| What happened | Action |
|---|---|
| Checks pass, review OK | accept |
| Wrong/incomplete result, capability problem | `--action retry --hint "<concrete correction>"` once, or `--action escalate` (next ladder step). Never both in a row without reviewing |
| `model_unavailable` | `--action fallback` (only the policy's approved fallback) |
| `auth`, `config`, `rate_limit`, `timeout` | **stop**: more calls do not help. Report the cause. For `auth`/`config` ask the user to fix the environment; do not touch config yourself |
| Repeated failure or a limit reached | stop and report what was tried and why it failed |

Always tell the user: attempts used, model/effort used, tokens if reported (cost is **unknown** unless the user gives a price list; never invent a number).

## 7. Report to the user (Vietnamese, short)

today, anything unresolved, and what you need them to decide.

## Files

- [routing-policy.json](routing-policy.json): approved models, ladder per class, limits, protected paths (human-edited only)
- `scripts/run.mjs`: the only entry point · `router.mjs` (pure decisions) · `codex.mjs` (spawns `codex exec` without a shell, env allow-list, prompt on stdin) · `verify.mjs` (scope/test checks) · `budget.mjs` · `redact.mjs`
