---
title: Doctor diagnostic codes
section: reference
order: 3
---

`factory doctor` checks required Host components and optional capabilities. The check code tells you which part of the setup to investigate.

## When to use it

Run it after installation or configuration changes, or when a model, runtime, or extension does not work.

![System Setup with individual doctor codes and statuses](/images/docs/system.png)

*The UI shows explanations and fixes alongside the codes.*

## Read a result

1. Run `factory doctor` or open **System** → **Setup**.
2. Read the explanation for the failing code. Fix required failures first; handle optional checks when you need the corresponding capability.
3. Rerun `factory doctor` or choose **Check again**. For scripts, use `factory doctor --json`.

| Code | What to check |
| --- | --- |
| `D-NODE`, `D-UI` | Node is at least 22.20; the compiled UI exists. |
| `D-STATE` | State is writable and supports SQLite WAL. |
| `D-GIT`, `D-PORT` | Git is installed; the configured port is available. |
| `D-MODEL`, `D-CA` | Gateway, credentials, DNS, TLS, and CA file. |
| `D-CODEX`, `D-CLAUDE`, `D-BWRAP` | CLI sign-in or bubblewrap for the capability in use. |
| `D-LAN`, `D-BACKUP` | LAN sign-in and a recent backup. |
| `D-EXT` | Enabled extensions, manifests, and packs. |

> **Note:** `factory doctor --model` sends a small live request. It can verify a model omitted from `GET /models`.

## Common mistakes

- Treating every optional failure as a startup blocker.
- Repeating a live model test when the diagnostic already identifies a local CA or configuration problem.

## Next steps

[Find fixes by code](./troubleshooting.md) or [see CLI commands](./cli.md).
