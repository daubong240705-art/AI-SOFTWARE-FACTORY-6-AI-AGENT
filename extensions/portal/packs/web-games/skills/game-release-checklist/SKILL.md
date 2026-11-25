---
name: game-release-checklist
description: Verify a release candidate and produce release notes and a structured ready or blocked verdict without publishing.
---

# Before requesting publication

- Identify the integration-branch candidate and review verified QA evidence, if any. Run `npm run check`, `npm test` and `npm run build` on the candidate. For a standalone re-publish, also smoke-test the game in preview.
- Follow `portal-bundle-contract`: stable manifest identity, valid player limits and entry paths, root files and original thumbnail, no external resources, source maps, source files or secrets, tar.gz strictly below 50 MiB.
- Add a concise Vietnamese entry to `CHANGELOG.md` for new verified changes, not for an unchanged re-publish. Don't invent a Portal version number. Summarize visible changes, tested ref, commands/exit codes, archive size and risks for the operator; do not upload anything.
- Submit `task.result` with `{"result":{"verdict":"ready","notes":"…"}}` or `{"result":{"verdict":"blocked","notes":"…"}}` (Vietnamese notes, max 4000 characters). `ready` requires every mandatory check to pass. The operator sees the notes and approves the only publish action. If the integration ref changed since checks, ask for a new release check; don't retry an uncertain Portal write before reconciling the version list.
