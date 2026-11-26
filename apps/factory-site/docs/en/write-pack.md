---
title: Write your own pack
section: extensions
order: 2
---

A pack distributes team roles, skills, profiles, and workflow templates. Start from the repository's template instead of assembling the layout from scratch.

## When to use it

Write a pack when several projects need the same starting team and workflow. Use the [Library](./library.md) for a standalone reusable checklist.

## Author, validate, and import

1. Copy `packs/_template` to a directory such as `packs/my-team`. Give `pack.json` a unique key and update its metadata, roles, and skill or profile references.
2. Put Workflow v2 definitions in `flows/<key>.json` with `schema: 2` and a key matching the filename. V2 files do not need manifest entries. Start with a graph that has no external writes.
3. From `apps/factory-host`, run `npm run build` and `npm run pack:check -- ../../packs/my-team`. Fix validation errors and restart the Host to load the pack.
4. Create a project from your **Team template**. Use **Workflows** → **Import from template**, inspect the draft, test it, then **Publish**.

![Workflows page showing import controls and workflow definitions](/images/docs/workflow-list.png)

*Importing a template creates a project draft, not a published version.*

> **Note:** If v1 and v2 share a key, the current importer prefers v2. A pack allowlist can narrow but not expand Host permissions.

## Common mistakes

- Naming the file differently from the definition key.
- Expecting a restart to publish an imported draft or authorize a tool that Host policy denies.

## Next steps

[Test the graph](./create-workflow.md) or [diagnose missing templates](./troubleshooting.md).
