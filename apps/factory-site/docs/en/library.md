---
title: Library
section: concepts
order: 3
---

Library holds reusable skills and agent templates. A skill packages instructions; a template packages agent configuration that can reference those skills.

## When to use it

Use a skill when several agents follow the same checklist. For example, a `release-checklist` skill can ask reviewers for the tested commit, checks performed, and unverified items.

![Library showing Skills, Agent templates, and Import SKILL.md](/images/docs/library.png)

*Select a skill to inspect its content and versions.*

## Reuse a skill and template

1. Open **Library** → **Skills**. Find an existing item, use **Create skill**, or select **Import SKILL.md**. Use a lowercase, hyphenated name and review the content.
2. Open **Agent templates** to inspect revisions. To reuse an existing agent's configuration, choose **Save as template** from its project menu.
3. In **Agents & Teams**, choose **Create from template** and check the resulting configuration. For an existing linked agent, compare revisions before using **Upgrade from template**.

> **Warning:** Upgrading replaces the configuration; agent-specific changes are not kept. Read imported instructions before granting tool access.

## Common mistakes

- Assuming a skill grants runtime tools or clears an approval gate.
- Expecting existing agents to update as soon as the template changes.

## Next steps

[Attach a skill to an agent](./create-agent.md) or [write a pack](./write-pack.md).
