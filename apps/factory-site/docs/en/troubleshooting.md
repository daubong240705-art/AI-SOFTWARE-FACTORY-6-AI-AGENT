---
title: Troubleshooting
section: reference
order: 6
---

Use the failing `factory doctor` code to identify the smallest fix, then rerun the check. The CLI works on the Host even if the browser UI does not load.

## When to use it

Use this page when the Host fails to start, a model or runtime is unavailable, or an extension template is missing.

![System Setup with required and optional checks](/images/docs/system.png)

*Read the check's specific explanation as well as its code.*

## Fix the failing check

1. Run `factory doctor` or open **System** → **Setup** and choose **Check again**.
2. Use the explanation and table below. If you already edited the file, run `factory config show` to check for overrides.
3. Rerun `factory doctor`. If the Host still will not start, check `factory status` and `factory logs -f` for the startup error.

| Code | Fix |
| --- | --- |
| `D-NODE`, `D-UI` | Rerun `scripts/install.sh` to restore pinned Node or rebuild a missing UI. |
| `D-STATE` | Use a writable local filesystem that supports SQLite WAL, not a network drive or `/mnt`. Check Host account permissions. |
| `D-GIT` | Install Git. Factory supplies its own commit identity. |
| `D-PORT` | Stop your existing Factory instance with `factory stop` if appropriate, or choose a free `FACTORY_PORT`. |
| `D-MODEL`, `D-CA` | Check gateway URL, credentials, quota, DNS, and connectivity. For an internal CA, set `NODE_EXTRA_CA_CERTS` to a readable CA file. |
| `D-CODEX`, `D-CLAUDE` | If you need either CLI, install it and sign in on the Host. |
| `D-BWRAP` | Install or repair `bubblewrap` for OpenCode or document processing. |
| `D-LAN` | Configure `FACTORY_LOGIN_TOKEN` with at least 24 characters when listening on the LAN. |
| `D-BACKUP` | Run `factory backup` and check the schedule if there is no backup from the past 24 hours. |
| `D-EXT` | Verify `FACTORY_EXTENSIONS` and any `FACTORY_EXTENSIONS_DIR` override, restart, and fix reported manifest or pack errors. Recheck **Source pack** under **Workflows** → **Import from template**. |

> **Note:** `factory doctor --model` sends a small live request. Use it when the configured model is served but missing from the provider's model list.

## Common mistakes

- Changing the browser URL without checking which port the Host uses.
- Disabling TLS verification instead of supplying the correct CA file.

## Next steps

[Check the effective configuration](./config.md) or [return to installation](./install.md).
