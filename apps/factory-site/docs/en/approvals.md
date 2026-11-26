---
title: Approvals & policies
section: concepts
order: 6
---

An approval records a human decision and routes the run. It does not grant tools or expand the policy governing an external operation.

## When to use it

Put a gate where a person must own the decision, such as signing off on passing tests or authorizing a Portal release. For example, route only `approved` to the publish action, never rejection or timeout.

![Needs attention showing a Portal approval question with options and a note field](/images/docs/approvals.png)

*Read the selected question and its options before answering.*

## Review a decision

1. Open **Needs attention** and select the item for your project. Check the question and associated workflow.
2. Review the candidate or commit, checks, and expected effect. Use **Technical details** to identify the item if necessary.
3. For a question, select an option and submit with **Answer**. For a review, use the available review action, such as **Request changes**. Return to the run to confirm which branch executed.

> **Warning:** If an external write has an unknown outcome, verify it in the target system before retrying. Approval is not proof that the write succeeded.

## Common mistakes

- Approving the wrong project or run because two questions share a title.
- Treating timeout or missing evidence as approval.

## Next steps

[Follow a run through sign-off](./run-approve.md) or [scope an external connection](./integrations.md).
