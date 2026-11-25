---
title: Introduction
section: start
order: 1
---

Factory coordinates an AI team on your machine. Discuss the work with a Lead, agree on a plan, then follow the workflow and make decisions where human approval is needed.

## What runs where?

The Host validates commands, stores state in SQLite, and dispatches work to runtimes. The web UI reads Host state and live events. Attempts that change code can use isolated Git worktrees.

![Workflow canvas](../../images/workflow.png)

## Where to start

Read [Installation](./install.md), then [create your first project](./quickstart.md). Learn how [Lead chat](./lead-chat.md) starts a [Workflow v2](./workflow.md) run.

> The model proposes; the Host checks schemas and policy. Chat does not grant approval on its own.
