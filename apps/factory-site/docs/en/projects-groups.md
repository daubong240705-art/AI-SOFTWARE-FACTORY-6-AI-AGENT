---
title: Projects & groups
section: concepts
order: 1
---

A project owns a workspace, tasks, and agent teams. Groups organize projects and can supply shared settings and library items.

## When to use it

Use groups for projects that should inherit common defaults. For example, put `Recipe Box` and another sample app in `Demos` while keeping separate workspaces and task histories.

![Group Overview with project, approval, run, and task totals](/images/docs/group.png)

*Group Overview aggregates activity; open a project to work inside its workspace.*

## Set up a group and project

1. Use the **+** beside **Projects** and choose **New group**. Name it `Demos`.
2. Choose **New project** and select `Demos` under **Group**. Use **Directory** for a Host-created workspace or **Git project** for an existing checkout.
3. Enter an absolute **Workspace path** on the Host or use **Choose folder**. Select a **Team template** if you want preconfigured agents, and choose **Create project**.
4. In the group's **Settings**, check **Effective value** before setting an override. Open **Group library** to see reusable items at that scope.

> **Note:** A team template copies agents into the new project. Changing the template does not edit those agents in place.

## Common mistakes

- Entering a path on the browser machine when the Host runs elsewhere.
- Repeating a setting in every project when it should be inherited from the group.

## Next steps

[Create a project from Software Team](./quickstart.md) or [reuse a library item](./library.md).
