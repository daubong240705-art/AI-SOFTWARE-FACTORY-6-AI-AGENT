---
name: local-preview
description: Keep the turn-based starter preview working with the Host's free port, loopback ready URL and clean stop.
version: 0.1.0
source: Adapted from Factory game-studio local-preview 0.1.0; Game Portal turn-based starter preview contract.
---

# Local preview

The starter already ships `factory.preview.json` at the project root with `npm run play`. Keep it working; never change its port logic. The operator can ask the Host to start the latest integrated code. The Host reads:

```json
{
  "command": ["npm", "run", "play"],
  "portEnv": "PORT",
  "readyPath": "/",
  "readyTimeoutS": 60
}
```

- `command` is an argument array, not a shell string.
- The Host sets the environment variable named by `portEnv` to a free port; the starter must listen on exactly that port. Preserve the existing PORT handling and standalone default of 8788. Never hard-code the Host's port or use 8787.
- `readyPath` is fetched until it answers; then the Host shows the operator the link.
- Startup installs nothing. Dependencies are prepared separately with the documented `npm install` when allowed; if unavailable, report the step unverified.

## Script rules

1. Preserve the starter's loopback listener (127.0.0.1), environment-selected port and existing build/preview runner.
2. `npm run play` already builds the game and serves its local host, lobby, room engine and iframe. Do not replace this with a separate custom server or change port logic.
3. Preserve the `Ready: http://127.0.0.1:<port>/` line when the page answers and the runner's SIGINT/SIGTERM cleanup of its child.
4. No secrets, outbound publishing, startup installation or writes outside the project worktree. The separate Game Portal repository is read-only.
5. Every URL in the preview page, its scripts and its WebSocket is relative to the page (`./host.js`, `./g/dev/v1/...`, a WebSocket URL built with `new URL("ws", location.href)`), never a path starting with `/`. The Factory Host serves the preview to the operator under `/preview/<token>/` and strips that prefix, so absolute paths break. The page also runs in an opaque origin there: do not rely on cookies, `localStorage` or same-origin access to anything but its own server.

## Test before handoff

Run `npm run check`, `npm test` and `npm run build`. From a prepared checkout, run `npm run play` with `PORT=<free port>`, fetch `/` and check HTTP 200, open the page, send SIGTERM and check nothing still listens. The lobby offers a bot or a shared room code; use two independent browser contexts for multiplayer. Report each step with its command and exit code and cite screenshots under `.factory/playwright/` when available. Never claim a check passed unless run; label unchecked steps unverified and report missing offered tools by name.
