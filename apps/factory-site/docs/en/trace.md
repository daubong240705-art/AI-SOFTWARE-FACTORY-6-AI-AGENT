---
title: Trace, Monitor & Insights
section: concepts
order: 8
---

**Monitor** helps you find active or waiting work. A run and its trace show what happened; **Insights** shows patterns across runs.

## When to use it

Use these views when a run appears stuck or you need evidence for a decision. If `Recipe Box` is waiting at operator sign-off, find the question rather than starting a replacement run.

![Workflow run showing the graph, run status, and Node execution pane](/images/docs/workflow-run.png)

*Select a node to inspect its execution instead of guessing from the overall run status.*

## Follow the evidence

1. Open **Monitor** to check current work, or **Workflows** → **Recent runs** to find a specific run. Select the waiting or failed node on its graph.
2. Follow available evidence from request → run → node → task → attempt → tool call or artifact. Check which attempt produced the result; a retry can have its own record.
3. If the run is waiting for you, open **Needs attention** and match the item to the run. For patterns over time, open **Insights** on the workflow and choose a **Time range**.

![Needs attention showing a pending Portal approval and an operator sign-off](/images/docs/monitor.png)

*When a run waits on a human decision, review and submit the decision in Needs attention.*

> **Note:** Unknown token usage or cost is not zero. Compare coverage as well as totals.

## Common mistakes

- Reading a wait as a runtime failure without checking for a decision or dependency.
- Blaming a node based on a summary metric without opening the underlying evidence.

## Next steps

[Handle an approval](./run-approve.md) or [use Insights](./improve-workflow.md).
