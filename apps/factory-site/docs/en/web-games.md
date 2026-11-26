---
title: Build a game with the Web Games team
section: guides
order: 4
---

Take an original turn-based game for two to four players from a confirmed brief to QA and a human-approved Portal release.

## When to use it

Use `game-new` for a new game. Complete [Portal setup](./portal.md) first so the project has the Web Games team, a Git workspace, and a scoped connection.

## From brief to release

1. In **Workflows** → **Import from template**, import the Web Games template with key `game-new`. Review it and choose **Publish**, then agree on rules and acceptance criteria before starting work.
2. Choose **Run** and supply `title`, `players` (for example `2-4`), the agreed Markdown `brief`, and `portalIntegrationId`. Include `briefArtifactId` only if you have one; it does not replace the brief.
3. Follow design, brief review, rules, art, client work, and QA in the run. For a classified QA failure, the workflow can attempt up to three repair rounds. A later approval to prepare a repair brief is not permission to release.
4. In **Needs attention**, open the publishing question. Check QA and the integration commit. Approve only a passing candidate with `dist/game.json` and an `id` matching the original project directory name. Verify the returned play path, version, and commit.

![New game workflow run with implementation and review nodes](/images/docs/workflow-run.png)

*Open the relevant nodes to check the evidence for each stage before approving release.*

> **Warning:** If publishing has an unknown outcome, check Portal `versions` against the game ID and commit and reconcile the effect before retrying.

## Common mistakes

- Using the worktree name as the game ID.
- Pasting the Portal token into the brief or treating QA repair as release approval.

## Next steps

[Review the approval model](./approvals.md) or [check Portal connection scope](./portal.md).
