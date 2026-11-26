---
title: Agents, teams & relationships
section: concepts
order: 2
---

An agent is a configured worker with a role, instructions, a runtime, and limits. Teams bring agents together; relationships describe handoffs and reviews.

## When to use it

Separate roles when production and review need different instructions. In Software Team, engineering makes the change and Test checks the integrated candidate against the brief.

![Agents & Teams with a Lead and separate implementation and review roles](/images/docs/agents.png)

*The roster shows each agent's role, adapter, status, and live attempts.*

## Inspect a team

1. Open **Agents & Teams** and identify the agent marked **Lead** and the roles used by your workflow.
2. Open a profile and review **Profile**, **Runtime**, and **Collaboration**. For independent review, use a different agent and check the direction of the `reviews` relationship.
3. Open **Office** for a project view, or global **World** to browse activity across projects. Use **Board** for task statuses.

![World with project filters, team workspaces, and recent activity](/images/docs/world.png)

*World lets you browse across projects; edit agent settings in the project itself.*

> **Note:** A role describes responsibility, the runtime executes the work, and skills supply reusable instructions. None of these bypasses tool policy.

## Common mistakes

- Assigning production and independent review to the same agent.
- Creating an agent without assigning it to a task or a node that can use it.

## Next steps

[Create an agent](./create-agent.md) or [reuse a template](./library.md).
