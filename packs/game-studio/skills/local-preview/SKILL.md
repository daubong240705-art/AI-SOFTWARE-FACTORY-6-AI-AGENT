---
name: local-preview
description: How a project tells the Factory Host how to start itself for the operator to play, and how to make every start script safe: free port, loopback, ready URL, clean stop.
version: 0.1.0
source: Factory game-studio pack 0.4.0 (original).
---

# Local preview

The operator can ask the Host to start the project from the latest integrated code. The Host reads `factory.preview.json` at the repository root:

```json
{
  "command": ["npm", "run", "play"],
  "portEnv": "PORT",
  "readyPath": "/",
  "readyTimeoutS": 60,
  "env": {}
}
```

- `command` is an argument array, not a shell string.
- The Host sets the environment variable named by `portEnv` to a free port before it starts the command; the app must listen on exactly that port.
- `readyPath` is fetched until it answers; that is when the Host shows the link to the operator.
- The command must install nothing at start: dependencies are installed by a documented step (`npm install`), which the Host runs once before the first start.

## Script rules
1. Listen on 127.0.0.1 and on the port from the environment. Never 8787.
2. Run the client and the game server from one command (a small runner script or `npm-run-all`), and stop both on SIGTERM.
3. Print one line `Ready: http://127.0.0.1:<port>/` when the page answers.
4. No secrets, no outbound publishing, no writes outside the repository and its temp folder.

## Test before handoff
From a clean checkout: install, run the command with `PORT=<free port>`, fetch `readyPath` and check HTTP 200, send SIGTERM, check that nothing still listens. Report each step with its exit code.
