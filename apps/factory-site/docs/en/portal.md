---
title: Portal / Web Games
section: extensions
order: 1
---

The optional Portal extension adds the **Web Games** team and workflows. It needs a running Portal instance and does not install one.

## When to use it

Follow this setup when an existing Portal should receive game releases from Factory through an approved HTTP connection.

## Enable the pack and connect a project

1. Set `FACTORY_EXTENSIONS=portal` in `factory.env`. Restart the Host and run `factory doctor`. If the pack is missing, check `D-EXT`.
2. Store the publishing token in **Integrations** → **Credentials**. In **Connections**, create an HTTP API integration using `extensions/portal/integration.example.json` as a starting point. Set `baseUrl`, reference the credential ID in `config.auth.bearer`, and set a scope the project can access.
3. Set `FACTORY_PROJECTS_ROOT` in your shell to match the Host. From the Factory checkout, run `bash extensions/portal/scripts/new-game.sh sample-game`. In **New project**, choose **Git project**, use the printed directory, and select the **Web Games** team template.
4. Open **Workflows** → **Import from template**, select the **Web Games** source pack, and inspect the chosen workflow before **Publish**.

![Web Games workflow definitions and recent runs](/images/docs/workflow-list.png)

*The pack provides templates for new games, changes, bug fixes, playtests, publishing, and rollback.*

> **Warning:** Pass `portalIntegrationId`, not the publishing token, in the workflow inputs.

## Common mistakes

- Enabling the pack without granting its project access to the connection.
- Retrying `bundle-outcome-unknown`. Check `versions` on Portal against the game ID and commit, then reconcile the recorded HTTP effect.

## Next steps

[Build and approve a game release](./web-games.md) or [troubleshoot an extension](./troubleshooting.md).
