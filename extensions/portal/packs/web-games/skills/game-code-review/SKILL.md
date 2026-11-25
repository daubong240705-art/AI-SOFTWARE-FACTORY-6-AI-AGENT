---
name: game-code-review
description: Review the exact game diff for rules, client, security and bundle correctness; report the verdict required by the workflow.
---

# Game code review

1. Compare the diff and evidence with the agreed brief and parent task, including edge cases and regressions. No unreviewed scope or mutation of the project ID.
2. Verify legality and turn/terminal invariants; immutable transitions, reproducible seeded replays, hidden information boundaries, strong-enough legal bots and meaningful rule tests.
3. Verify SDK-only interaction, safe rendering of untrusted seat names/errors, no code evaluation, direct external requests, credentials or unsafe asset URLs. Check responsive layout, keyboard/touch and reduced motion for affected code.
4. Check the bundle root and relative references, build coverage and limitations. Report actionable findings with file/line, impact and fixes. Do not edit code.

Use `task.result` with `{"result":{"verdict":"accepted","notes":"…"}}` or `{"result":{"verdict":"changes-requested","notes":"…"}}`, with Vietnamese notes (up to 4000 characters). This is also the format for design/art review; replace the coding checklist with the parent task's design/art acceptance. Do not use the top-level `verdict: "approved"` form: Flow Agent reviews expect `accepted` in the result. A standalone review's Condition checks the same value before QA. Missing evidence that prevents review means changes requested, not accepted.
