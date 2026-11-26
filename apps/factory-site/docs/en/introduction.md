---
title: Introduction
section: start
order: 1
---

Factory coordinates an AI team on your machine. Agree on the work with a Lead, follow the workflow, and make the decisions that need human judgment.

## When to use it

Use Factory for work with several handoffs or review gates. For example, Software Team turns a brief into acceptance criteria, implements and tests a change, and waits for your sign-off without deploying.

![Overview with a request composer, pending decisions, and projects](/images/docs/overview.png)

*Overview gives you a starting point for a request, project, or decision.*

## Find your way around

1. Open **Overview** to choose a project or send a request in that project's context.
2. In the project, open **Office** to see the Lead and current work, or **Board** to see individual tasks by status.
3. Open **Workflows** to see the graph and recent runs. Use **Needs attention** for human decisions.

![Project office showing the Lead desk and active workflows](/images/docs/office.png)

*Office shows the team and active work for one project.*

> **Note:** The Host validates commands, stores state in SQLite, and dispatches work. The UI displays Host state and events. Code-changing attempts can use isolated Git worktrees.

## Common mistakes

- Confusing a task with a workflow run. One run can create several tasks.
- Treating a chat reply as approval. The Host checks commands and policy separately.

## Next steps

[Install Factory](./install.md) and [create your first project](./quickstart.md).
