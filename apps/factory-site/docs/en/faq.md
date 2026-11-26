---
title: FAQ
section: reference
order: 5
---

Answers to common setup and workflow questions, from choosing a workspace to finding a decision.

## When to use it

Start here if you are unsure whether you need a model, where to find work, or why a draft or chat did not start a run.

## Can I try a workflow without a model?

1. Open **Workflows** and create or open a draft without external writes.
2. Choose **Save draft** and **Test run**, enable **Mock agents (no tokens)**, and enter the required inputs. Open the run to check the route.

> **Warning:** Mock agents do not disable all Actions. The demo is local-network only unless its operator publishes it. Do not put secrets or real data there.

## Is a project the same as a group?

No. A project has a workspace and work history; a group organizes projects and can provide inherited settings. Choose **Directory** for an empty workspace or **Git project** for an existing checkout.

## Why did chat or a draft not start a run?

Discussion is not confirmation. Explicitly accept the plan and ask the Lead to start a published workflow. Importing or saving a draft does not publish it: choose **Publish** before running that version normally.

## Where do decisions and tasks appear?

Use **Needs attention** for human decisions, **Board** for individual tasks, and the run graph for workflow execution.

![Board showing task cards organized by status](/images/docs/board.png)

*Board tracks individual tasks, not the full run or its approvals.*

## Common mistakes

- Expecting Web Games to install Portal. It needs a separate instance.
- Reading unknown usage as zero, or a completed task as a signed-off run.

## Next steps

[Follow the quickstart](./quickstart.md) or [diagnose setup failures](./troubleshooting.md).
