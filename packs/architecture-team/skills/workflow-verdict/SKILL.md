---
name: workflow-verdict
description: Report whether an ADR or API contract is ready for operator sign-off.
version: 1.0.0
source: Original Factory pack guidance.
---

# Architecture workflow verdicts

For the final technical review, call `task.result` with `{"result":{"verdict":"pass","notes":"..."}}` or use `fail`. A prose-only response does not drive the workflow. Pass only when the decision or contract is coherent, satisfies the stated constraints, and calls out assumptions and validation gaps. Use `fail` for a material contradiction, unsupported choice, or missing invariant. In no more than 2,400 characters in the operator's language, cite affected sections and distinguish blocking corrections from follow-up checks.

For an automatic peer review of an upstream artifact, return `accepted` or `changes-requested` under `result.verdict` instead. Save significant findings with the reviewed artifact version.
