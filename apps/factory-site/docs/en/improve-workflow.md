---
title: Improve a workflow with Insights
section: guides
order: 5
---

Use workflow Insights to investigate repeated failures, retries, and long waits. Applying a proposal changes the draft, not the published version.

## When to use it

Use this after you have runs to compare. For example, find out whether delays in Software Delivery came from tests or waiting for operator sign-off before raising a timeout.

![Workflow editor showing the Insights tab beside Editor](/images/docs/workflow-canvas.png)

*Open Insights from the workflow editor; return to Editor to test draft changes.*

## From findings to a tested revision

1. Open the workflow, select **Insights**, and choose a **Time range** that includes the [quickstart](./quickstart.md) run.
2. Compare **Per-node metrics** and **Findings**, then open **Evidence** links to see whether the same node shows a pattern across comparable runs.
3. Save or discard unsaved editor changes. Choose **Propose improvements**, inspect **Proposed changes**, and choose **Apply** only if the ready patch addresses the issue. If you use **Ask AI for suggestions**, inspect it separately with **Review AI proposal**.
4. Return to **Editor**. Recheck ports, inputs, and approval gates, then choose **Test run**. Use **Publish** only after verifying the revision.

> **Note:** Old runs keep their versions. Unknown usage is not zero; check coverage before comparing totals.

## Common mistakes

- Increasing a timeout to mask a wait that needs a person.
- Applying a stale proposal. Reload and create a new one for the current draft.

## Next steps

[Trace the underlying evidence](./trace.md) or [run the new version](./run-approve.md).
