---
title: Build a game with the Web Games team
section: guides
order: 4
---

## Set up the project

Follow the [Portal / Web Games setup guide](./portal.md) to get a running Portal instance, a properly scoped integration, and a project that uses the Web Games team template. Start with a turn-based game mechanic, a few screens, and original artwork.

## From brief to QA

Import and publish `game-new`. Fill in `title`, `players` (for example, `2-4`), the agreed Markdown `brief`, and `portalIntegrationId`. The `briefArtifactId` input is optional. The workflow covers design, a check against the brief, rules, art, and client implementation, with role-based reviews before QA. If QA fails, triage and fix issues for up to three rounds. Do not bypass the QA gate.

## Approve the release

When the release checklist is ready, open **Needs attention** and review the integration commit, QA results, and release candidate. Choose **Approve** to submit the bundle containing `dist/game.json`. Use an ID that matches the original project directory name, not the worktree name. Check the returned play URL, version, and commit. If the result is unclear, check `versions` on Portal and reconcile the recorded effect before rerunning anything.
