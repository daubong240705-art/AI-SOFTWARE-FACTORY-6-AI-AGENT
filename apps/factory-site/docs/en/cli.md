---
title: Factory CLI commands
section: reference
order: 1
---

## Setup and operation

| Command | Purpose |
| --- | --- |
| `factory setup` | Configure models, ports, and runtimes interactively. |
| `factory doctor` / `factory doctor --json` | Check runtime prerequisites or get results for scripts. |
| `factory start` / `factory stop` / `factory restart` | Control the Host. |
| `factory status` / `factory logs -f` | Check status or follow the logs. |
| `factory config show` | Show the effective configuration with secrets redacted. |
| `factory backup` / `factory restore FILE` | Create or restore a SQLite backup. |

## Troubleshooting

Run `factory doctor` and look up the [doctor codes](./doctor.md). Keep backups and logs accessible only to authorized operators.
