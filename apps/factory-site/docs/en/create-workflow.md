---
title: Create a workflow on the canvas
section: guides
order: 2
---

## Build a minimal workflow

Open **Workflow**, create a new draft, and add Trigger, Agent, and Output nodes. Choose a role or agent for the Agent node, then describe the task and expected output. Connect the Trigger's `out` port to the Agent, then connect the Agent's `out` port to the Output. Add an `error` path if failures need a separate outcome.

## Test before publishing

Define the required inputs, fix any validation errors, and save the draft. Choose **Test run** with mock agents to preview the execution path and output. Add an Approval node before any action that affects an external system. Connect rejection and expiration branches if you want to handle those outcomes separately. When the draft is ready, choose **Publish** to create a version.
