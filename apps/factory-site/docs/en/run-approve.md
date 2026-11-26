---
title: Run a workflow and handle approvals
section: guides
order: 3
---

Follow the `Recipe Box` run from confirmed brief to operator sign-off. Software Delivery only sends a passing candidate to sign-off and does not deploy.

## When to use it

Use this for a published workflow with a human gate. For an editor-only check, [test the draft](./create-workflow.md) instead.

## Watch and decide

1. Open the run link from **Ask Lead** or find it in **Workflows** → **Recent runs**. To start manually instead, open the published workflow, choose **Run**, and supply the agreed `brief`. Do not do both for the same request.
2. Select the current node in the run graph to inspect execution. Use **Monitor** to see live or waiting work. **Board** shows tasks, not the whole run.
3. In **Needs attention**, open **Operator sign-off**. Check evidence for the empty and populated list scenarios, then select **Approve** if both pass or choose rejection if the evidence falls short. Submit with **Answer**.
4. Return to the run to verify its branch and final output. Open **Insights** to compare this run with others.

![Needs attention displaying a release question and the Answer button](/images/docs/approvals.png)

*Review the question for your own run before selecting and submitting a decision.*

> **Warning:** For an external write with an unknown outcome, verify and reconcile it before choosing **Retry** or starting a replacement run.

## Common mistakes

- Approving because one task says **Done**, without checking the run's tests.
- Retrying work that is simply waiting on you.

## Next steps

[Investigate a run](./trace.md) or [compare results in Insights](./improve-workflow.md).
