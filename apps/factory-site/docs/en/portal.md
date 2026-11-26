---
title: Portal / Web Games
section: extensions
order: 1
---

## Enable the extension

The Portal extension does not install a Portal server. You need a running Portal instance and a token with publishing permission. Set `FACTORY_EXTENSIONS=portal` in `factory.env`, restart the Host, then run `factory doctor` and check `D-EXT`.

## Create an integration and project

Store the token as a secret. Use `extensions/portal/integration.example.json` as a starting point for an HTTP API integration. Update `baseUrl`, put the secret ID in `config.auth.bearer`, and select which projects can access the integration. Do not paste the token into a brief.

Set `FACTORY_PROJECTS_ROOT` in your shell to the same value the Host uses. From the Factory repository, create a starter project:

```bash
bash extensions/portal/scripts/new-game.sh ten-game
```

Point the project at the directory printed by the script, select **Web Games**, and import a workflow from the pack. See the [game development guide](./web-games.md) to run and approve it. The pack also includes workflows for changes, bug fixes, playtesting, standalone publishing, and rollback.
