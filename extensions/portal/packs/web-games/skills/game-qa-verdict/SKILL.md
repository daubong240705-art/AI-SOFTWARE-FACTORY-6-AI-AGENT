---
name: game-qa-verdict
description: Send machine-checked QA results with Vietnamese evidence and bug references so the workflow can route failures safely.
---

# Structured QA verdict

Call `task.result` with exactly this shape for QA verification; a text-only JSON fence or final summary does not count:

```json
{"result":{"verdict":"fail","area":"rules","reasons":["npm test: mã 1; seed 31 tái hiện lượt sai."],"bugs":["FL-017: lượt đổi sau nước đi bị từ chối"]}}
```

- `verdict`: `pass` or `fail`. Pass only when every required check was executed successfully; an unchecked required gate counts as failure. For pass, use `area: "none"`, `bugs: []` and list evidence in `reasons`.
- `area`: `rules`, `client` or `unknown` on fail. For both areas, report the first blocking defect and list others; use `unknown` when you lack evidence to assign it. `reasons` and `bugs` are arrays of Vietnamese strings (up to 12 entries each, 500 characters per entry).
- Include exit codes, used seed or browser viewport, any unverified cases and relevant task/evidence references. For each confirmed bug record expected vs. actual, ordered repro steps and environment in the task; don't use `bugs` as a substitute for reproduction details.

The workflow reads `nodes.<qa-node>.output.verdict` and `.area`, which the engine copies from `task.result.result`. Do not use the top-level MCP review-verdict form here.

For the separate bug reproduction step return `{"result":{"verdict":"reproduced","notes":"…"}}` only after a regression test fails for the reported reason; otherwise use `not-reproduced` and describe what was tried. Preserve the regression for the fix and rerun it during verification.
