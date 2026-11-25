---
name: game-playtest
description: Collect seeded bot matches and report seat balance, length and reliability without changing or publishing the game.
---

# Bot playtest

Run the requested integer count (default 50; maximum 500). Use a shipped simulation script if present. Otherwise use a local harness over the starter's named rules exports (or built `dist/rules.js`): call `setup`, then obtain the active seat, call `bot`, validate via `move`, and stop when `result` is non-null or at a declared cap (at most 500 moves). Don't change game code to playtest. If bots are disabled or unavailable, report that explicitly instead of simulating nonexistent matches. Rotate seat assignments; record player count, seeds, tested ref, bot policy, cap and actual sample size.

Count completed, illegal-action, crashed and capped matches separately. Report win counts/rates by seat, draws, median and longest or p95 match length, with denominators; keep caps out of completed-match rates. Include seed and minimal replay for each distinct failure. A small deterministic sample is not evidence of human balance. If browser preview is available, add a manual vs-bot round and note friction distinct from rules failures.

QA sends metrics and evidence in `task.result.result.report` in Vietnamese, including unrun checks. Designer appends interpretation, limitations, at most three tuning hypotheses and a follow-up experiment with a measurable target. Designer sends the combined Markdown as `report`; the workflow saves it as an artifact. No release or balance edits in this workflow.
