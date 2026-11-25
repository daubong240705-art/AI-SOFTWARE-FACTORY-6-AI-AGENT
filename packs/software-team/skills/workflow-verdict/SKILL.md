---
name: workflow-verdict
description: Report test and reproduction decisions in the structured format used by software workflows.
version: 1.0.0
source: Original Factory pack guidance.
---

# Software workflow verdicts

Call `task.result` with `{"result":{"verdict":"pass","notes":"..."}}` or the same shape with `fail`. A final message or JSON fence is not enough. Pass only when the required checks ran against the exact candidate and all passed. Use `fail` for a reproduced failure or a required check you could not run. In `notes` (at most 2,400 characters), give check commands, real exit codes, the tested candidate, and failures or gaps. Write the notes in the operator's language.

For the reproduction task use `{"result":{"verdict":"reproduced","area":"frontend","notes":"..."}}`. Use `reproduced` only after the unchanged product fails the new test for the reported reason; otherwise use `not-reproduced`. The accepted areas are `frontend`, `backend`, and `unknown`. Do not guess the area. Preserve the regression and register a handoff when reproduced.

A peer review task is different: use `{"result":{"verdict":"accepted"}}` or `{"result":{"verdict":"changes-requested"}}`. Use the attached handoff and report findings to the author; neither verdict is operator sign-off.
