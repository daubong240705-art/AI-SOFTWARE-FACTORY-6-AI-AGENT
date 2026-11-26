---
title: Create a workflow on the canvas
section: guides
order: 2
---

Build a draft that turns a short brief into a checklist without changing files or calling an external service.

## When to use it

Start from a blank graph to learn ports or test a new route. Use **Import from template** when you want to start with a pack definition instead.

![Workflow editor with Add nodes, Issues, and Test run](/images/docs/workflow-canvas.png)

*Use Add nodes to build the graph, then inspect and test the connections.*

## Build, test, and publish

1. In **Workflows**, choose **Create workflow**. Use a key such as `checklist-preview`. The draft starts with a manual **Trigger** and an **Output**.
2. Under **Workflow settings** → **Workflow inputs**, add a required text input named `brief`. Use **Add nodes** to add an **Agent** and assign the [checklist reviewer](./create-agent.md). In the task instructions, use **Insert template path** to reference `brief` and ask for a checklist with evidence requirements.
3. Replace the direct Trigger-to-Output edge with **Trigger** → **Agent** → **Output**, using **Next** (`out`) on both source nodes. Check **Issues**, then choose **Save draft**.
4. Select **Test run**, enable **Mock agents (no tokens)**, and enter a sample `brief`. Open the run and confirm it visits the agent and reaches the output.
5. Use a small live test if you need to check the content the agent returns. Choose **Publish** when the graph is ready for regular runs.

> **Warning:** Mocking agents is not a dry run for every Action. Keep external writes out of this exercise. If you add one later, place an approval before it.

## Common mistakes

- Leaving the direct edge in place so the output can be reached without the agent.
- Using **Run** to test an unpublished edit or omitting required inputs.

## Next steps

[Run a published workflow and handle approval](./run-approve.md).
