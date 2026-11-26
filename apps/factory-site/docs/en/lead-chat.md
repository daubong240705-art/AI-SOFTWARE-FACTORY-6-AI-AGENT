---
title: Lead chat
section: concepts
order: 5
---

Lead chat follows “agree first, run after”: discuss, decide explicitly, record a versioned brief, then start the workflow. The Host validates the proposed action, workflow, and inputs.

## When to use it

Use chat when the work needs clarification. For `Recipe Box`, agree on the empty-state text, the two acceptance tests, and the no-deployment constraint.

![Overview request composer with a project selector](/images/docs/overview.png)

*Check the project context first; inside the project, use Ask Lead.*

## Turn an agreement into a run

1. Open **Ask Lead** in the project. Ensure the Lead model is configured and **Software Delivery** is published if following the [quickstart](./quickstart.md).
2. Ask: “Propose the smallest change that shows ‘No recipes yet’ on an empty list. Preserve the populated list and test both states. Don't start yet.” Discuss the plan until the scope is clear.
3. Confirm in your own words: “I approve that plan. Start Software Delivery with those acceptance criteria. Do not deploy.” Check the **Decision brief** version and open the workflow run from the reply.
4. If no run appeared, check the project, publication state, and required inputs before confirming again. Review the outcome against the brief the run actually used.

> **Note:** Under **How to work with Lead**, classic mode keeps discussion separate from explicit delegation, which can propose tasks for **Board**. Switching modes does not bypass approval.

## Common mistakes

- Saying “looks good” while still comparing options, without identifying what to run.
- Using chat confirmation to try to clear a downstream approval.

## Next steps

[Watch the run and handle sign-off](./run-approve.md).
