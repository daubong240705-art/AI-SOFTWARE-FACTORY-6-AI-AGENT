---
title: Doctor diagnostic codes
section: reference
order: 3
---

## Check the environment

| Code | What to check |
| --- | --- |
| `D-NODE` / `D-UI` | Rerun the installer if Node is older than 22.20 or the UI build is missing. |
| `D-STATE` | Use a writable local drive that supports SQLite WAL mode. |
| `D-GIT` / `D-PORT` | Install Git, or free up or change the port in use. |
| `D-MODEL` / `D-CA` | Check the gateway, API key, network, TLS, and CA file path. |
| `D-CODEX` / `D-CLAUDE` | If you use an optional CLI, check that it is installed and that you are signed in. |
| `D-BWRAP` | Check bubblewrap if you run OpenCode or process documents. |
| `D-LAN` / `D-BACKUP` | Check the LAN sign-in token or backup schedule. |
| `D-EXT` | Check the extension path, manifest, and packs. |

## Test a live model

`factory doctor --model` sends a small request to the model provider. Use it when the gateway supports a model that is not listed by `GET /models`, or when you need to verify the connection with a live request.
