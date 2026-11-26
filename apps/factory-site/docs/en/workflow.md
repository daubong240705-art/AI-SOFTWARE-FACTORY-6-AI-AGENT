---
title: Workflow v2
section: concepts
order: 4
---

Workflow v2 is a validated graph. Each edge connects a named output port to another node. Edit a draft and publish it when ready; each normal run pins its definition and inputs.

## When to use it

Use a graph when routes matter. For example, a checklist agent can hand its result to an **Approval**: `approved` leads to a signed-off output, while `rejected` and `timeout` lead to a separate result.

![Workflow canvas with connected steps, Add nodes, and Inspector](/images/docs/workflow-canvas.png)

*The Inspector shows the selected node or edge; Issues shows validation problems.*

## Read a graph and its run

1. Open a definition in **Workflows**. Start at **Trigger** and follow **Next** (`out`). An **Agent** delegates work; an **Action** performs a declared operation; **Output** collects the result.
2. Trace every branch. **Condition** selects a route, **Loop** repeats within a bound, and **Approval** routes a decision or timeout. Check **Issues** for unreachable nodes or missing connections.
3. Check **Versions** to distinguish a published version from the draft. Open a run and inspect what it used. If the Host restarts, it checks outstanding work rather than assuming an interrupted attempt succeeded.

> **Warning:** **Mock agents (no tokens)** replaces model calls for agents; it does not disable every Action. Test a graph without external writes first.

## Common mistakes

- Saving a draft and assuming **Run** picks up the edit before **Publish**.
- Routing rejection or timeout to the same successful output as approval.

## Next steps

[Build a draft graph](./create-workflow.md) or [follow a run](./trace.md).
