---
name: workflow-verdict
description: Report a structured accessibility and handoff decision without overstating implementation evidence.
version: 1.0.0
source: Original Factory pack guidance.
---

# Design workflow verdicts

For the accessibility review, call `task.result` with `{"result":{"verdict":"pass","notes":"..."}}` or use `fail`. A prose-only response does not drive the workflow. Pass if the spec covers the required accessible behavior and identifies checks that need a rendered implementation. Fail for design defects or missing specifications that prevent an accessible handoff. In no more than 2,400 characters in the operator's language, name affected screens or components and distinguish written evidence from implementation checks.

For the automatic UX peer review, return `accepted` or `changes-requested` under `result.verdict` instead. Neither decision replaces operator sign-off.
