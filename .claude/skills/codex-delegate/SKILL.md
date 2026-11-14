---
name: codex-delegate
description: Hand a well-specified implementation, test or analysis task to Codex CLI in ANY git repository (not only this one), then review the diff. Use it to save Claude tokens on large mechanical work. No routing policy.
argument-hint: "<repo dir> <task to delegate>"
---

# Codex delegate (Claude specifies and reviews, Codex writes)

Goal: spend Codex tokens on writing code, spend Claude tokens only on the spec and the review. Reply to the user in Vietnamese; task files, code and commits stay in English.

Unlike `codex-routing` (a Windows PoC bound to the Factory repo and its model ladder), this skill has **no policy, ladder or call limits**. Codex runs with the operator's own `~/.codex/config.toml` defaults (model, provider, effort), so never choose a model unless the user asks. It works on any git repository.

Never edit `~/.codex/*`, `config.toml`, `auth.json` or `.claude/skills/codex-routing/routing-policy.json`. Never put credentials in a task file.

## What stays in place (the script enforces it)
- Sandbox `workspace-write` on `--repo` only (Codex protects `.git` itself). `--read-only` for analysis.
- No network unless `--network`. Install dependencies yourself first (`npm install`, free of Codex tokens).
- Environment allow-list, no shell, prompt on stdin, 30 minute timeout (`--timeout-min`).
- Codex is told never to commit, push or change git config. Commit only when the user asks.

## When to delegate
Delegate: implement a module from a written spec, write tests, a mechanical migration, read a large file and explain it.
Do it yourself: a few-line edit, a design or architecture decision, a vague spec (write the spec first), anything needing the user's judgement.

## Procedure
1. **Baseline.** In the target repo: install dependencies, then `git add -A` (a commit if the user allows commits; otherwise staging is enough). After the run, `git diff` (modified files) and the untracked list are exactly what Codex did. `repoDirtyBefore` in the output must be 0, otherwise the report mixes old and new changes.
2. **Task file** in the scratchpad, never in the repo. Keep it short and checkable:
   - `Goal`: one paragraph.
   - `Read first`: files that define interfaces and style.
   - `You own`: the exact paths Codex may create or change. Everything else is read-only.
   - `Interfaces`: signatures it must keep or implement (paste them).
   - `Acceptance`: commands with the expected result (`npm run check` exits 0, `npm test` passes, one named behaviour per line).
   - `Do not`: add dependencies, touch other paths, add features that were not asked for.
3. **Dry run** (free): `node .claude/skills/codex-delegate/scripts/delegate.mjs --repo <dir> --task <file> --dry-run`.
4. **Run:** same command without `--dry-run`. Use `run_in_background` for long tasks. Tasks that own **disjoint paths** may run in parallel, each with its own `--name`.
5. **Review, never skip.** Read `answer.md`, then `git status` and `git diff --stat`, then only the files that matter. Run the acceptance commands yourself. Check: only owned paths changed, no new dependency, no secret, no silent behaviour change, nothing claimed that was not run.
6. **Fix.** A small flaw: edit it yourself. A larger one: a second task file with concrete feedback ("function X returns Y for input Z, expected W"). After two rounds on the same task, stop and tell the user why.
7. **Commit** only when the user wants commits.

## Failure handling
- `auth` or "Missing environment variable: NINE_ROUTER_API_KEY": the script already falls back to the systemd user environment (`systemctl --user show-environment`), the one source the user allowed on 2026-11-14 (local 9router, they will rotate the key later). If it is still missing or rejected, stop and tell the user. Never print the key, never copy it into a file, and do not search other files for it.
- `timeout`, `rate_limit`: report; do not loop.
- Codex reports it could not verify something: treat it as unverified until you run it.

## Report to the user (Vietnamese, short)
What was delegated, which paths changed, which checks you ran yourself and their results, tokens if the script printed them (otherwise "không rõ"), and what needs their decision.
