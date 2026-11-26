---
title: Write your own pack
section: extensions
order: 2
---

## Start from the template

Copy `packs/_template` to a new pack directory, then update the key, metadata, and role configuration in `pack.json`. Add the skills, profiles, and workflows you need. For Workflow v2, create `flows/<key>.json` with `schema: 2` and a `key` that matches the filename. You do not need to list v2 files in the manifest. If v1 and v2 share a key, v2 takes precedence.

## Validate and import

From `apps/factory-host`, build and run the validator:

```bash
npm run build
npm run pack:check -- ../../packs/my-team
```

The Host reads packs at startup. Select a team template or import a workflow template into your project, then check the configuration and publish. A pack's allowlist can only narrow tool permissions; it cannot grant permissions beyond Host policy.
