# Factory Host (V2 control plane)

Independent of V1. M1 in progress: **storage**, **events** and the **API security layer** and the **command pipeline**, **SSE**, the **Host start-up**, **org** (Pack to Team), **work** (tasks), **model gateway**, **budgets**, **chat storage** the **Lead runner** and **same-origin UI serving** done.

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

- `src/identity/`: one-time bootstrap token (SHA-256 + `timingSafeEqual`, locks for 60 s after 5 failures) and in-memory sessions (idle 12 h, absolute 7 d, max 20). Sessions are lost on restart: after a restart the Host prints a new bootstrap token.
- `src/api/`: `createApiServer` (Fastify, no plugins). Every request must carry a `Host` that matches a configured origin (blocks DNS rebinding). Write routes need a valid session cookie (`HttpOnly; SameSite=Strict`), an exact `Origin`, and the per-session `x-csrf-token`. `listenLoopback` refuses every address except `127.0.0.1` and `::1`. Later modules add routes through `register(app, guards)`. `GET /auth/session` (session required) returns the CSRF token so the UI can recover it after a page reload; other sites cannot read it (no CORS, SameSite=Strict, Host check).
- `src/commands/pipeline.ts`: `POST /commands` is idempotent by `commandId`. One `BEGIN IMMEDIATE` transaction holds the handler's writes, the receipt and the events. Same `commandId` + same command: replay of the stored response, nothing written. Same `commandId` + different command: 409, original untouched. A `CommandError` stores a rejected receipt; any other error stores nothing so the client may retry. `projects.create` is the only handler so far; other command types answer `501 unsupported` (stored).
- `src/api/sse.ts`: `GET /projects/:id/events`. Frames carry `id: <epoch>:<sequence>`; reconnect with `Last-Event-ID` (or `?after=`, which wins) loses and repeats nothing. `snapshot-required` (`epoch-changed` / `gap` / `expired`) ends the stream. Streams are cleaned up on client abort and on `app.close()`.
- `src/host.ts` / `src/main.ts`: `startHost`, `node dist/main.js` with `FACTORY_STATE_DIR` (default `~/factory-v2/state`), `FACTORY_PORT` (default 8787), `FACTORY_BACKUP_DIR`. It refuses a `/mnt/...` or relative state directory, backs up before migrating, and prints the one-time bootstrap token on stdout only.

## Running it in WSL

Do not run the Host from `/mnt/<drive>`: loading `node_modules` over 9p takes 20+ seconds. Deploy to ext4 first:

```bash
bash /mnt/e/GIT/AI-SOFTWARE-FACTORY-6-AI-AGENT/scripts/factory-v2/deploy-host-wsl.sh
FACTORY_STATE_DIR=$HOME/factory-v2/state FACTORY_PORT=8787 node $HOME/factory-v2/app/apps/factory-host/dist/main.js
```

## Org and work

- `src/org/pack.ts`: `loadPack` validates `packs/<key>/pack.json` (one lead, unique seat names, profile and skill paths must stay inside the pack, also after resolving symlinks) and returns a digest over the manifest and profiles. Note: skill files are checked for existence but are not part of the digest yet.
- `src/org/service.ts`: `ensureTeamFromPack` (idempotent, deterministic profile ids) and `ensureEngagement` (one active engagement per project and team).
- `projects.create` now also creates the default team from the pack once and an engagement per project.
- `src/work/service.ts`: `tasks.create` (always starts as `draft`) and `tasks.transition` (optimistic `expectedRevision`, the contracts transition table; in M1 only `proposed`, `accepted`, `declined`, `cancelled` are reachable). Read routes: `GET /projects/:id/tasks`, `GET /projects/:id/team`.
- Tests that need symlinks are skipped on Windows (EPERM). Run the whole suite on Linux with `bash scripts/factory-v2/test-host-wsl.sh` (copies to ext4, `npm ci`, `npm test`); do not run it from `/mnt/<drive>`, where tests that spawn node time out.

## Models and budgets

- `src/models/gateway.ts`: `createChatCompletionsGateway` (OpenAI-compatible `POST {base}/chat/completions`). https, or http only on loopback; no redirects; no retries; response size cap; the API key lives in a closure and never appears in errors or `util.inspect`. `src/models/fake.ts` is a scripted gateway for tests. The key comes only from the Host process environment: `NINE_ROUTER_API_KEY` (and optional `FACTORY_GATEWAY_URL`, default `https://ai.lazy.local/v1`). Without a key the Host starts with no gateway.
- `src/policy/budget.ts`: usage ledger and budgets. Cost is always stored as unknown (never 0). A call whose usage is not reported must carry its reserved estimate and is counted with it, never as zero. `checkAndReserve` refuses when a budget is exceeded or the reservation does not fit (day and task scopes; defaults 200,000 per task and 1,000,000 per day, day = calendar date in UTC+7). `budgets.set` changes them (data, not code). `GET /projects/:id/budget` shows the status. Optional env: `FACTORY_BUDGET_TASK_TOKENS`, `FACTORY_BUDGET_DAY_TOKENS`.
- Known limit: the day total is summed in memory from the project's usage rows; fine for M1, to be replaced by an indexed range query when volumes grow.

## Chat

- `src/chat/service.ts`: `conversations.create` (only the project's Lead seat, optional task) and `chat.send` (continuous `ordinal`, optimistic conversation revision, one queued row in `lead_turns` per user message, `message.appended` event emitted between the entity events and `command.receipted`). The contract field `agentId` is a seat id and `workItemId` is a task id. Attachments answer `unsupported` for now. `messages.command_id` is always NULL (the receipt does not exist yet when the handler runs).
- A handler result may carry `events`; the pipeline appends them before `command.receipted`.
- `lead_turns` states: `queued`, `running`, `done`, `failed`, `unknown`, `budget-blocked`. A turn never replays by itself.

## Lead

- `src/lead/protocol.ts`: the model may append ONE ```` ```factory-plan ```` JSON block (validated by the contracts `taskProposeInputSchema`; at most 10 tasks, dependencies point backwards, a test task or a `testingReason`). A plan is honoured only when the operator's message had intent `delegate`; tasks are created as `proposed` (never started) with deterministic ids per (turn, index).
- `src/lead/prompt.ts`: profile + protocol + context (project, team, tasks) as the system prompt; history without system messages, capped by count and characters; a conservative token estimate.
- `src/lead/runner.ts`: one turn at a time, in order. Budget check before the call (a blocked turn never reaches the model), exactly one call and no retry, then reply + usage + tasks + turn state + events in one transaction. If the provider answered but the bookkeeping failed, the usage is still recorded. `recover()` marks turns interrupted by a restart as `unknown` and never calls the model. Failure messages are generic (kind only).
- Env: `FACTORY_LEAD_MODEL` (default `gpt-6.1-sol`), `FACTORY_LEAD_EFFORT` (default `medium`).

## Serving the UI

`src/api/static.ts` serves the built UI (`apps/factory-ui/dist`) from the Host so the browser sees one origin: session cookie, Origin and CSRF checks work without CORS. Set `FACTORY_UI_DIR` (absolute path) or build the UI next to the Host (`apps/factory-ui/dist` is picked up when it exists). API prefixes (`/auth`, `/commands`, `/projects`, `/health`, `/api`) never fall back to `index.html`; unknown paths without an extension do (SPA); unknown paths with an extension are a JSON 404. Defence in depth against path traversal: one decode, rejection of every residual escape or encoding, containment check, and `realpath` containment (symlinks cannot leave the UI directory). Hashed files under `assets/` are cached as immutable, everything else is `no-store`; HTML carries a strict CSP and `X-Frame-Options: DENY`.

### Live check against 9Router (2026-11-07)

Five real calls through the Host in WSL (about 1.7k to 2.0k tokens each, `gpt-6.1-sol` via `/chat/completions`, `FACTORY_BUDGET_DAY_TOKENS` capped at 20,000 for the runs). Verified end to end: the discussion reply, the budget/usage ledger, and a delegate request in which the Lead emitted a valid `factory-plan` block and the Host created `TSK-001 [proposed]`.

Correction: an earlier note here said the Lead created no Task. That was a bug in the throwaway smoke script (it read `tasks` while the route returns `items`), not in the Host or the model. The captured raw output showed a valid plan block from the first delegate call on. The reminder appended to delegate messages is kept because it is cheap and tested, but it was not what made the plan appear.
