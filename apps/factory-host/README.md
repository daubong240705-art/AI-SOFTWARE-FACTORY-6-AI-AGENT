# Factory Host (V2 control plane)

Independent of V1. M1 in progress: **storage** and **events** done.

```bash
cd apps/factory-host
npm ci --ignore-scripts --no-audit --no-fund   # better-sqlite3 ships prebuilt binaries, no install script needed
npm test                                       # builds, then runs node:test
```

- `src/storage/migrate.ts`: ordered `NNNN_name.sql`, checksum ledger (CRLF-insensitive), backup (`VACUUM INTO`) before migrating a database that has data, one transaction per migration, dangling-reference check, refuses a database that is newer than the code.
- `src/storage/database.ts`: opens the SQLite file with WAL, `foreign_keys=ON`, `synchronous=FULL`, and wires Kysely to the same connection. A file database that cannot enter WAL mode is **refused**.
- `migrations/0001_core.sql`: generated from the references in `schema/factory-v2/` (the references stay the readable spec; a test fails if the migration drifts from `002`).

**Where the database file lives:** on the WSL ext4 filesystem (for example `~/factory-v2/state/host.db`), never under `/mnt/e` or `/mnt/d` (9p mounts break WAL shared memory). Backups go to `D:\factory-backup`.

- `src/ids.ts`: UUIDv7 generator, strictly increasing even with a frozen or backwards clock.
- `src/events/hub.ts` (`EventHub`): per-project event log with epoch + sequence cursors, outbox, `append` (only inside a transaction, validated with the contracts `eventSchema`), `transaction()` that publishes notifications only after the outermost commit, `readAfter` (returns `snapshot-required` with reason `epoch-changed` / `gap` / `expired`), `prune`, `claimUndelivered` / `markDelivered`.
  - Notifications are only produced for appends made through `hub.transaction()`. An append inside a transaction owned by someone else is stored and readable but does not notify subscribers; SSE clients still catch up on their next `readAfter`.
