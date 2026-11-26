---
title: Create an agent
section: guides
order: 1
---

Add a `Checklist Reviewer` to `Recipe Box`. Its job is to report which acceptance criteria have evidence and which remain unverified, without editing files.

## When to use it

Create a separate agent when a responsibility needs its own instructions, runtime, or permissions. Start from a template if a suitable configuration already exists.

![Create agent form with Name, Role, Adapter, Model, and Advanced settings](/images/docs/create-agent.png)

*Set the basic profile first, then inspect skills, permissions, and limits under Advanced.*

## Create and test the profile

1. Open **Agents & Teams** → **Create agent**. Enter `Checklist Reviewer` for **Name** and describe its responsibility under **Role**.
2. Select an **Adapter** ready on the Host and set **Model** if required. Under **Main instructions**, ask for a pass, fail, or unverified result for each criterion, with evidence and no edits.
3. Open **Advanced**. Attach a checklist under **Skills & Tools**, review **Permissions & Delegation**, and set an appropriate budget under **Limits & Budget**. Choose **Save**.
4. Reopen the agent to check its configuration. Assign it to the [checklist workflow](./create-workflow.md), then try a small live task to verify its actual output and runtime.

> **Note:** A mock run checks graph routing, not the real adapter or the quality of the review.

## Common mistakes

- Giving write access to a read-only reviewer.
- Expecting the new agent to run without assigning it to a task or node.

## Next steps

[Connect the reviewer to a workflow](./create-workflow.md) or [save a reusable template](./library.md).
