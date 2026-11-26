---
title: Quickstart
section: start
order: 3
---

Create a project from **Software Team**, then guide a small change from requirements to operator sign-off. The example adds an empty-state message to a sample app without deploying it.

## When to use it

Use this walkthrough with a running [Host](./install.md), an existing local Git checkout, and a configured Lead model and agent runtimes. For a model-free first look, use the [mock workflow exercise](./create-workflow.md).

## Create the project and publish a workflow

1. Choose **Create** → **New project**. Name it `Recipe Box`, select **Git project** and the **Software Team** under **Team template**, and set **Workspace path** to the sample app checkout on the Host. Choose **Create project**.
2. Open **Agents & Teams** and check the copied roles and adapters. [Create a checklist agent](./create-agent.md) for practice; leave the imported workflow's role assignments unchanged.
3. Open **Workflows** → **Import from template**. Choose **Software Team** as the **Source pack** and **Software Delivery** as the **Workflow template**. Review the `brief` input and sign-off path, then choose **Publish**.

![New project form with workspace and team template selectors](/images/docs/create-project.png)

*The form sets up the workspace and copies the team; import the workflow separately.*

## Agree, run, and review

1. Open **Ask Lead**. Ask for a plan to show “No recipes yet” on an empty list, keep the populated list unchanged, and test both states. Say not to start yet.
2. Review the plan and confirm: “I approve that plan. Start Software Delivery with these acceptance criteria. Do not deploy.” Check the **Decision brief** and run link in chat.
3. Follow the run in **Monitor**. When **Operator sign-off** appears in **Needs attention**, verify both test cases and submit the approval only if the evidence supports the brief.
4. Return to **Software Delivery**, select **Insights**, and inspect the per-node metrics. Check which node spent the most time waiting before proposing a change.

![Workflow run with a graph and node execution pane](/images/docs/workflow-run.png)

*Follow the graph from the trigger to the final output, including any wait for sign-off.*

> **Warning:** Live runs can change the workspace and use model budget. Use a disposable sample checkout.

## Common mistakes

- Asking the Lead to run a workflow that was imported but not published.
- Starting a duplicate manually without checking the chat reply for a run link.

## Next steps

[Work with the Lead](./lead-chat.md), [handle a decision](./run-approve.md), or [improve a workflow](./improve-workflow.md).
