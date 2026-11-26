---
title: Factory CLI commands
section: reference
order: 1
---

Use the `factory` CLI on the Host to configure, diagnose, and operate Factory without opening a browser.

## When to use it

Use the CLI when the UI cannot load or when checking effective configuration, managing the process, or maintaining backups.

![System Setup displaying diagnostic results](/images/docs/system.png)

*System → Setup exposes the same checks as `factory doctor`.*

## Check and operate the Host

1. Run `factory status`. Use `factory logs -f` to follow startup messages or investigate a failed restart.
2. Run `factory doctor` for check results and fixes, or `factory doctor --json` for scripts.
3. Use `factory config show` to see effective configuration and sources with secrets redacted. Use `factory setup` to configure interactively.
4. Use `factory start`, `factory stop`, and `factory restart` to control the Host. Use `factory backup` for SQLite backups and `factory restore FILE` to restore a specific backup.

> **Warning:** Restore is not a diagnostic. Verify the backup and target Host before restoring, and restrict access to backups and logs.

## Common mistakes

- Running commands on the browser machine instead of the Host.
- Assuming a setting took effect without checking its source and restarting.

## Next steps

[Look up a doctor code](./doctor.md) or [check configuration precedence](./config.md).
