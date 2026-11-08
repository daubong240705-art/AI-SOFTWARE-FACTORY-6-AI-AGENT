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
- `src/host.ts` / `src/main.ts`: `startHost`, `node dist/main.js` with `FACTORY_STATE_DIR` (default `~/factory-v2/state`) and `FACTORY_PORT` (default 8787). It refuses a `/mnt/...` or relative state directory, backs up before migrating, and prints the one-time bootstrap token on stdout only.

## Periodic backups and offline restore

The CLI Host enables periodic backups by default: the first runs after 5 seconds, then hourly, with one final backup after the Lead runner and HTTP app stop and before SQLite closes. Embedded `startHost` callers opt in with `periodicBackup: { dir, intervalMs?, firstRunDelayMs?, keep? }`; omitted or null disables it. `host.backup.service` provides synchronous `run("manual")`, `list()`, and `status()`; `host.backup.status()` and session-protected `GET /system/backups` report the latest success/error and backup count (null when disabled). Backup errors are generic and do not crash the Host or prevent shutdown.

| Variable | Default | Purpose |
|---|---|---|
| `FACTORY_BACKUP_DIR` | `/mnt/d/factory-backup` if `/mnt/d` exists; otherwise `<stateDir>/backups/periodic` | Periodic and shutdown backups; must be absolute and separate from the live database directory |
| `FACTORY_BACKUP_INTERVAL_MINUTES` | `60` | Integer from 1 to 1440; invalid values stop startup |
| `FACTORY_MIGRATION_BACKUP_DIR` | `<stateDir>/backups` | Existing pre-migration backups, managed separately |

`FACTORY_BACKUP_DIR` now controls periodic backups. Move any previous pre-migration directory override to `FACTORY_MIGRATION_BACKUP_DIR`. Configure another physical drive for AP-R5 protection when the fallback is on the same drive as the state directory.

Each backup uses parameterized `VACUUM INTO` into a random temporary file. Before fsync and publication as `factory-<UTC yyyymmddThhmmssZ>-<reason>[-n].db`, verification requires integrity `ok`, no foreign-key violations, a migration ledger with the live highest version, and the live project count. A pinned read transaction supplies the expected counts; a mismatch retries the snapshot once. Older backups survive failed attempts. The synchronous API performs VACUUM, verification, and file operations on the calling thread; large databases can pause request handling during these operations.

Retention uses filename timestamps, not file modification times: every backup newer than 48 hours, then the newest per UTC calendar day within the last 14 calendar days (including today), with the newest three always protected. Embedded callers can override `keep: { hourlyHours, dailyDays, minNewest }`. Unrelated files, malformed names, directories, and symlinks are ignored. Retention deletion errors appear in status while the completed backup remains successful.

Stop the Host before restoring. The restore tool refuses relative or `/mnt/` target state directories, verifies the source read-only, and attempts a short `BEGIN EXCLUSIVE` lock on an existing database. A `.host-running` owner file coordinates Host lifetime and restore, also refusing an idle running Host in WAL mode; an owner whose process has exited is reclaimed. A verified copy is staged as `host.db.restoring` and verified again; the old `host.db` and SQLite sidecars are preserved in `pre-restore-<UTC stamp>/` before the new database is installed. Failures roll back moved files, and the source backup is never moved or written. Existing staging files are preserved and require operator recovery before another restore.

```bash
node dist/backup/cli.js list /mnt/d/factory-backup
node dist/backup/cli.js restore /mnt/d/factory-backup/factory-20261107T101112Z-hourly.db /home/operator/factory-v2/state --migrations ./migrations
```

Both commands print JSON on success and exit 0; failures print one line and exit 1. `--migrations <dir>` checks the applied ledger checksums against this build's migration files. Without it, only the checksum comparison is skipped. Restart the Host after restore; a matching build applies no migrations. `test/backup.test.mjs` includes fresh-directory and same-directory restore drills covering projects, teams, tasks, messages, events, cursors, and serving restored data through a restarted Host, plus corruption, retention, scheduler, lock, rollback, and compiled CLI checks.

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

## Dispatch (M2)

- `src/dispatch/`: attempt repository (`ATTEMPT_TRANSITIONS` from the contracts is the only lifecycle graph), local node with capacity, runtime interface + fake runtime, and the `Dispatcher`.
- Capacity: node slots and seat slots; attempts that may still be running (`lease-expired`, `unknown`, `reconciling`) keep their slot. One live attempt per task. Order: engagement priority, then FIFO.
- No replay, ever: an expired lease or a Host crash turns a default task's attempt into `unknown` (operator reconciles); only tasks that are repo-bound with no outside effect get a new attempt (epoch + 1, with a handoff). A stop in progress at crash time is `unknown`, never restarted.
- Stop writes `stopped` only after the runtime says the execution has really ended; a timeout leaves `unknown`.
- Late events of a fenced (expired, stopped or replaced) execution are dropped.
- `startHost({ dispatch: {...} })` enables it; `main.ts` enables it by default (`FACTORY_NODE_SLOTS` 1..16 default 2, `FACTORY_RUNTIME=fake` for now). Nothing enqueues attempts yet: the commands that do (start gate, stop, reconcile) come next.

## Model proxy for agents (M2)

`src/proxy/` + `src/models/upstream.ts`: agents never see the 9Router key. The Host runs a SEPARATE loopback-only OpenAI-compatible listener (`POST /v1/chat/completions`, `GET /v1/models`; no cookies, no CORS) and gives every attempt a random token (`fpx_…`, only its SHA-256 is kept, memory only, max 6 h) that is revoked when the attempt ends, is stopped (before any wait), is fenced, or the Host stops.

- Enabled only when `NINE_ROUTER_API_KEY`, `FACTORY_GATEWAY_URL` and `FACTORY_AGENT_MODELS` (comma separated, no default: the operator decides which models agents may use) are all set; `FACTORY_PROXY_PORT` defaults to `FACTORY_PORT + 1`.
- Requests are rebuilt from an allow-list of fields (unknown fields dropped), the model must be in the approved list, output tokens are clamped, `stream_options.include_usage` is forced.
- The budget is checked BEFORE the upstream call, including estimates of requests still in flight; usage is recorded per attempt (an estimate when the upstream reports none). A definite upstream HTTP rejection (401/429/5xx) generated nothing and is not charged.
- Upstream bodies, headers and errors are never relayed (generic OpenAI-shaped errors); a response containing the key or the agent token is dropped, also when split across stream chunks.
- Known limits: sessions/tokens live in memory only; the per-attempt request counter is not freed until the Host restarts; image content parts are not supported yet; only chat completions (no `/responses`).

## Sandbox for coding agents (M2)

`src/sandbox/` (Linux only; needs `bwrap` 0.8+ and user namespaces, both present in this WSL2). `buildSandboxCommand` is a pure, strictly validating builder; `startSandboxed` runs it through the exec runner (exact host env `PATH` only, own process group, verified stop).

- Fresh namespaces for everything (`--unshare-all`): private PID, IPC, UTS and a NETWORK namespace that contains only `lo`. The root is a tmpfs made read-only (`--remount-ro /`); `/usr` is read-only, `/etc` only has `passwd`, `group`, `nsswitch.conf`, `ld.so.cache`, `localtime`. `/tmp` (256 MiB) and the agent HOME `/home/agent` (512 MiB) are capped tmpfs that vanish with the sandbox.
- The ONLY writable host location is the attempt worktree, mounted at its real path so the worktree's `.git` pointer works. The clone's `.git` is read-only except the worktree's own git dir, so `git status/diff` work and commits/ref changes fail (the Host checkpoints). State dir, other projects/worktrees, the user's home and `/mnt` are invisible; the builder refuses to bind them.
- Environment is `--clearenv` plus the builder's fixed variables and an allow-listed few; secret-looking names are refused except `FACTORY_MODEL_TOKEN` and `OPENCODE_CONFIG_CONTENT`.
- Network: the sandbox cannot reach the host loopback or the internet. Models are reached through `relay-main.js` inside the sandbox (`127.0.0.1:18787` -> a unix socket bound from the Host), and the Host proxy listens on that socket (`FACTORY_PROXY_SOCKET`, absolute path in a 0700 directory, socket mode 0600) instead of TCP.
- Known limits: no CPU, process-count or disk quotas yet (only the tmpfs caps); a runaway agent can still use CPU and fill its worktree; seccomp is not applied.

## OpenCode runtime (M2)

`src/runtimes/opencode.ts` implements `RuntimeAdapter` for the seat runtime `native-opencode`: it runs the real OpenCode 1.19.5 (`run --pure --format json`) inside the bubblewrap sandbox. The model is reached only as `http://127.0.0.1:18787/v1` (the in-sandbox relay to the Host proxy socket); the per-attempt token lives only in `OPENCODE_CONFIG_CONTENT`.

- Enable with `FACTORY_RUNTIME=opencode`. The Host refuses to start (one message, no values printed) unless `FACTORY_OPENCODE_DIR` (contains `bin/opencode`), `FACTORY_PROXY_SOCKET`, `FACTORY_AGENT_MODELS`, `NINE_ROUTER_API_KEY`, `FACTORY_GATEWAY_URL`, the projects/worktrees roots and a working bubblewrap are all present. Seats whose runtime is not registered still fall back to the fake runtime.
- Events are mapped from OpenCode's JSON lines (`step_start`, `text`, `tool_use`, `error`, exit code) to `progress` / `completed` / `failed`. Every string leaving the adapter is scrubbed: the token, `fpx_…`/`sk-…` patterns, the workspace path (`<workspace>`) and any other absolute path. OpenCode's raw error text and stderr are never forwarded.
- OpenCode retries a failing upstream (HTTP 5xx) forever and silently, so the adapter enforces its own total deadline (15 min) and stall deadline (5 min, restarted on every parsed event). `stop()` resolves only after the sandbox process group is verified gone; if it survives, `stop()` rejects and the dispatcher records `unknown`.
- Known limits: no per-seat model or reasoning-effort selection yet (first approved model); no MCP tools for `output.register` / `decision.request` yet (S6); no CPU/process quotas (see Sandbox).

## Results: content store and Artifact Versions (M2)

`src/artifacts/` keeps what an attempt produced. The content store (`<state>/content`, mode 0700/0600) is content-addressed by SHA-256: `get` re-hashes and returns nothing when the bytes no longer match, writes are lock + temp file + atomic rename and never overwrite, a lock left by a crashed Host is recovered after 30 s, and errors never carry paths.

- When an attempt ends, in the SAME transaction as the task/attempt outcome, the Host registers Artifact Versions: the patch (`code-ref`, `text/x-diff`) when the workspace evidence is safe, untruncated and its SHA-256 matches, and for a completed attempt the agent's summary (`other`, `text/markdown`). Completed attempts are `in-review`, failed or stopped ones `draft` (partial work stays inspectable). A later attempt of the same task registers version N+1 and supersedes the previous one. Registration can never change the outcome; failures are reported generically.
- Read routes: `GET /projects/:projectId/tasks/:taskId/artifacts` and `GET /projects/:projectId/artifacts/:artifactId/versions/:version/content` (text types only, hash-verified, no paths in responses).
- The review/approval flow that moves these versions to `approved`/`rejected` is the next slice.

## MCP endpoint for agents (M2)

`src/mcp/`: the model proxy listener also serves `POST /mcp` (a hand-rolled JSON-RPC subset: `initialize`, `ping`, `tools/list`, `tools/call`; no new dependency), authenticated by the SAME per-attempt token as the model routes, so the sandboxed agent reaches it through the same relay. `GET`/`DELETE` answer 405. MCP calls never touch the model budget and are never forwarded upstream. OpenCode sees the tools as `factory_task_progress` and `factory_output_register`.

- Every tool call re-checks in the database that the attempt is still `running`/`waiting-input` with the same epoch before any write; a stopped, fenced or finished attempt can write nothing. Tool failures are `isError` results with fixed short messages (no paths, ids or exception text).
- `task.progress`: appends a fenced `progress` attempt event (control characters, paths and `fpx_`/`sk-` tokens masked), renews the lease, at most 500 calls per attempt.
- `output.register` (Host-side input: the sandbox cannot upload bytes): the agent names a workspace-RELATIVE path of a deliverable. The Host reads it itself through descriptors anchored at the workspace (every component `lstat`-checked, `O_NOFOLLOW`, regular file only, no `.git`, no `..`/absolute/backslash paths, max 8 MiB, valid UTF-8/JSON), stores it in the content store and registers a `draft` Artifact Version (superseding earlier versions of the same task/kind/title; max 50 per attempt). When the attempt completes, its draft outputs move to `in-review`.
- `decision.request` (business questions): validated against the contract, sanitised, at most ONE pending question per task. In one transaction the Host creates a `question` Approval (7-day expiry) and a `decision` hold (needs action) on the task; the tool result tells the agent to stop, and ~50 ms later `parkAttempt` ends the attempt (`running` -> `waiting-input` -> `parked`): token revoked, the sandbox process group verified gone (otherwise `unknown`, as for a stop), partial work kept as a draft Artifact, slot freed. The task STAYS `active` and nothing restarts it by itself. An agent that finishes right after asking is parked too, never sent to review.
- Answering (`approvals.decide` on the question, any listed option): hold released, approval `applied` exactly once, and a NEW attempt (epoch + 1, same seat, continuing from the previous branch) starts with "Decision from the operator: Question / Answer / comment" in its handoff. Cancelling the task withdraws the question and the hold; an expired question stays unanswered with its hold (the operator cancels or retries the task) and never starts anything.

## Multi-team Org (M3 O1)

Behind `FACTORY_MULTI_TEAM=1` (default OFF: the Host behaves exactly like M2, at most one active Engagement per Project, and the new commands answer `unsupported`; any other value refuses to start without printing it).

- Pack registry: every valid `packs/*/pack.json` is discoverable (`GET /packs`, metadata only; a broken pack is skipped with a generic message, duplicate keys refuse). Commands: `teams.create-from-pack`, `teams.set-lifecycle` (`active`/`paused`/`archived`), `engagements.create` (invite a Team to a Project), `engagements.update` (priority, `maxConcurrent`, `active`/`paused`/`ended`; only the given fields change), `seats.update` (slots only; dedicated nodes arrive in M4), all with revision checks.
- The PRIMARY engagement (the earliest created active one) owns the Project's Lead, the plan and the default engagement of new tasks: adding a higher-priority Team never changes who the Lead is. Priority only orders dispatch.
- The dispatcher enforces `maxConcurrent` per Engagement (a task at the limit stays queued and starts when a slot frees), and does not start tasks of a paused/ended Engagement or a paused/archived Team: nothing is failed, running attempts are never interrupted, and work resumes when the Engagement/Team becomes active again. Queue order across Engagements: priority, then FIFO.
- Read views: `GET /teams` (seats, live load, engagements), `GET /teams/:teamId/queue` (cross-project queue in start order), `GET /projects/:id/team` now lists all engagements.

## Knowledge: search and read permissions (M3 K1a)

`src/knowledge/` indexes Artifact Versions for full-text search (SQLite FTS5 inside better-sqlite3, migration 0004). Text is normalised at index AND query time (NFD, strip diacritics, d-stroke to d, lower-case), so `thiet ke` finds `Thiết kế` and `dang nhap` finds `Đăng nhập`; every query term is quoted so user text is never FTS syntax. Registration (attempt results and `output.register`) indexes the version in the same transaction; a failing index never fails registration, and a bounded start-up backfill indexes older versions.

- ONE read-permission function (`visibleToScope`) decides every read, applied in SQL before limit/offset: the operator sees its own project; an agent sees `project`/`organization` versions of its project and `team-draft` versions only of its own team (team read from the attempt's seat in the database, never from tool arguments); withdrawn/rejected are operator-only; other projects only expose `organization` + `approved` versions. Hidden artifacts answer exactly like not found.
- Agent tools (listed only when the knowledge dependency is wired): `knowledge.search` (limit 20, filters, `truncated`) and `knowledge.get` (`l0`/`l1`/`l2`; `l2` text types only, verified, 32 KiB), 200 calls per attempt, fenced like the other MCP tools.
- Operator routes: `GET /projects/:id/knowledge/search?q=`, `/knowledge/artifacts`, `/knowledge/artifacts/:artifactId` (versions, provenance inputs and dependants; `organization` is shown as `shared`).
- Lifecycle (K1b, migration 0005): commands `artifacts.transition` (only along the contract's ARTIFACT_TRANSITIONS; approving needs `reviewed`, promotes `team-draft` to `project`, and only the NEWEST version can be approved), `artifacts.share` (`shared` only for approved versions) and `artifacts.clear-stale`. Approving a version supersedes the previously approved one and then marks its DIRECT dependants stale: artifact versions that list it as an input get a `knowledge_stale` row, and open tasks that pin it as an input get an advisory `input` hold (needs action). Nothing is redone automatically, running attempts are never interrupted, and staleness does not propagate transitively (the Lead decides). The same analysis runs when registration supersedes an approved version and when a review decision approves a version, in the same transaction. Accepting a review retires the task's advisory input hold; requesting changes keeps it. Reads: `stale` arrays per version, `GET /projects/:id/knowledge/stale`, and `stale` flags in the MCP tools (reasons never reveal artifacts the viewer cannot read).

## Context Pack (M3 X1a)

The Host deterministically builds a Context Pack for every attempt, including single-team projects. It pushes the sanitized task brief, goal, acceptance, output contract and constraints, declared input summaries, the five newest applied question decisions, up to five pending questions for this task, and a bounded handoff from epoch two. Full artifact content (L2) is pulled on demand with `knowledge.get`; no model builds the pack.

Inputs use L1 when available and otherwise L0. The default budget is 6000 estimated tokens (`ceil(UTF-8 bytes / 4)`, injectable in dispatcher dependencies). When over budget, inputs are processed from last to first: L1 becomes L0, then the whole input is omitted if necessary. Brief and constraints are preserved even when their mandatory text alone exceeds the budget. Stale and superseded inputs have explicit markers.

Every summary read uses `visibleToScope`, with the attempt seat's team and exact active CTR grants. Omitted references remain visible with retrieval hints (`knowledge.get artifactId=<id> version=<n>`); hidden and unknown inputs both render as `no-access` and reveal no metadata. Tasks without inputs receive `knowledge.search to find prior project knowledge`.

Migration 0008 adds the STRICT `context_packs` metrics table, one replaceable row per attempt, containing estimated tokens, maximum tokens, L0/L1/omitted counts and validated JSON. Pack failures log a fixed message and execution continues without a pack. The authenticated operator view `GET /projects/:projectId/tasks/:taskId/context` returns the newest twenty packs and metrics; only stored/operator packs distinguish `not-found` from `no-access`.

Registration accepts omitted L1. A supplied L1 must contain at least two non-empty lines and 80 trimmed characters, and differ from L0; malformed summaries are rejected before writes. With `FACTORY_MULTI_TEAM=1`, `artifacts.transition` requires L1 before approving research-report, requirements, adr, data-model, api-contract, ui-spec, plan and dossier versions. Other kinds and flag-off approval retain their existing behavior.

## Cross-team requests (M3 C1b)

Behind `FACTORY_MULTI_TEAM=1` only (flag off: the tools are not listed and the commands answer `unsupported`). A request (CTR) IS a Task (`origin.kind='cross-team'`, code `REQ-nnn`, migration 0006 adds `ctr_meta`, immutable `ctr_messages`, `ctr_followers`); there is no second entity. Migration 0007 adds durable `ctr_waits`. `responseMode: 'blocking'` parks the requester session and releases its slot; a new attempt for the same seat receives `Request results:` when the answer arrives. Notify cannot block; at most three requests may block a task at once. A blocking duplicate also waits.

- Agent tools (the requester attempt must be running): `request.create` (kinds clarify/consult/produce/review/decision/notify; fixed short errors, nothing written on refusal; hop above 3, more than 10 open or 20 created per attempt, asking the requester's own team, unreadable `contextRefs` and non-active teams are refused), `request.reply` (`message` / `accept` / `request-changes`, requester or follower only) and `request.get`.
- Duplicates (same target team, kind, artifact refs and normalised ask, same project, still open) are not created again: the second requester becomes a follower of the first.
- Routing: clarify/consult are accepted automatically for the target team's Lead (an Engagement is created when missing) and run without an operator Go; produce/review/decision/notify wait for operator triage (`requests.triage`: accept / need-info / decline / redirect / merge, always with a reason; `requests.message` adds an operator note). The Inbox lists requests awaiting triage (`requests` and `counts.requests`, additive); `GET /projects/:id/requests` and `/requests/:taskId` are the operator views.
- Delivery uses the normal task machinery; `review_policy` is `automatic`, so no operator review is created. After delivery the requester accepts (task `done`) or requests changes: rounds 1-3 start a new attempt for the same seat with the message as `Requester feedback:` in the handoff; the 4th escalates to the operator as a question (`accept-as-is` / `cancel-request` / `continue`).
- Read permission: while the request is accepted and not terminal, its working attempt may read EXACTLY the artifact versions listed in `contextRefs` (an exact `(artifactId, version)` list inside `visibleToScope`, computed from the grant's task, never from tool arguments); the access ends the moment the request closes.

- Waits resume on delivery, decline, cancellation, expiry, or after the 24-hour wait ceiling. A timeout leaves the request open and the requester following it. Multiple waits resume only after all cross-team and decision holds clear. Merge and redirect carry waits to the replacement request.
- The startup and 60-second sweeps expire submitted or need-info proposals after seven days or their needed-by deadline; accepted work keeps running. Cancelling a requester recursively cancels requests without other followers, and unsubscribes it from shared requests. Its own waits close without resuming.
- Each root has a budget of 15 request tasks and 40 attempts across the root and its requests. A team cycle requires a new artifact version produced after the earlier request to that team.

## Effect Executor: `git.push-branch` (M2)

`src/effects/` is the ONLY place where the Host acts outside its own sandbox/state. It is OFF unless the operator sets `FACTORY_PUSH_REMOTES` (comma separated `name=url`, no default; schemes `https`, `ssh`, `file:///abs/path`; no passwords, queries or duplicates). `FACTORY_PUSH_SSH_COMMAND` (optional) becomes `GIT_SSH_COMMAND` of the push process only, for ssh URLs only. URLs and the command never appear in any API, event, error or log; clients only see remote NAMES (`GET /effects/remotes`).

- Operator routes (session + CSRF): `POST /projects/:projectId/attempts/:attemptId/push` `{ "remote": "<name>" }`, `POST /projects/:projectId/effects/:effectId/reconcile`, `GET /projects/:projectId/effects`, `GET /projects/:projectId/attempts/:attemptId/effects`. The sandboxed agent has no way to trigger an effect (no MCP tool, no proxy route).
- A push is allowed only for an attempt whose task is `done` (you already accepted it), only for its `factory/...` branch (never `main`/`master`, also enforced by the database), only to a configured remote, and the clone's `.git/config` must contain nothing that could redirect or weaken the transport (strict section/key allow-list).
- The Effect Record is committed (`pending`) BEFORE git starts. Command: `git push --porcelain --no-verify --no-follow-tags <configured URL> refs/heads/B:refs/heads/B` with no credential helper, empty hooks directory, only the URL's protocol allowed, exact environment, bounded output; the local tip is re-verified right before contacting the remote. Never `--force`. Outcomes: `done`; `failed` with a fixed class (`auth`, `rejected`, `network`, `other`); `unknown` on timeout, crash or unconfirmed output. `unknown` is NEVER retried: `reconcile` asks the real remote (`ls-remote`) and settles it as `done` (same tip) or `failed` (`not-pushed`); a repointed or removed remote name makes reconcile refuse. After a Host restart, `pending` effects become `unknown`.
- A failed push may be requested again (new record); a pending/done/unknown one is returned as is (idempotent). Git stdout/stderr are never stored or returned. Remember: never configure the `origin` of a repository you do not own.

## Review approvals and Inbox (M2)

`src/approvals/`: when a `human-final` task completes and enters `in-review`, the Host (inside the same transaction as the outcome) creates ONE pending `review` Approval (options `accept` / `request-changes`, 7-day expiry, a context digest over the task's current artifact versions). A new review supersedes a pending one; moving the task by hand withdraws it; expiry marks it `expired` and never approves.

- `approvals.decide` checks the revision, the digest the person saw AND the freshly computed digest, expiry and the option, then applies exactly once in the pipeline transaction: `accept` -> task `done` (dependents advance), artifact versions `approved`, approval `applied` with the command id; `request-changes` -> approval `changes-requested`, a NEW attempt (epoch + 1) that starts from the previous branch, versions `rejected`. The comment is stored immutably (`approval_comments`, migration 0003) and reaches the next attempt as "Reviewer feedback:" in its handoff. Any failure leaves the database unchanged. The actor recorded is derived from the session credential.
- Inbox: `GET /inbox` (all projects) and `GET /projects/:projectId/inbox` list pending approvals (oldest first) and tasks waiting at the start gate, with counts. Also `GET /projects/:projectId/approvals/:approvalId` and `GET /projects/:projectId/tasks/:taskId/approvals`. Public text masks absolute paths but keeps `CI/CD`-style words and URLs.
- The handler is kind-agnostic; agent-raised `question` approvals arrive with the MCP slice.

## Process runner (M2)

`src/exec/process-group.ts` runs a child on Linux only (it refuses every other platform): own session and process group, the EXACT environment it is given (nothing inherited from the Host), commands resolved only through the child's own `PATH`, bounded output (UTF-8 safe), timeout, and a stop that resolves only after the whole group is verified gone (SIGTERM, grace, SIGKILL; a group that survives the deadline is reported, never hidden). `buildSafeEnv` refuses secret-looking variable names unless allowed by name; `scrubForLog` redacts secrets. A child that deliberately escapes with `setsid` is NOT contained by process groups: the sandbox (a later slice) must contain it. The Linux integration tests run through `scripts/factory-v2/test-host-wsl.sh`.

## Workspace (M2)

`src/workspace/` (Linux only) implements AP-4: a project is CLONED into the WSL ext4 filesystem and results come back as patches or branches; the original repository is only ever READ.

- `cloneProject` (`git clone --no-local --no-hardlinks --template=`): source is an absolute local path or a credential-free `https://` URL; the clone owns its objects, has `remote.origin.pushurl = no-push://disabled` and a local identity. Only COMMITTED content is cloned: uncommitted work in the source working tree is not included.
- Attempt workspace (`dispatch/workspace-provider.ts`): when `FACTORY_PROJECTS_ROOT` / `FACTORY_WORKTREES_ROOT` are set (or the defaults exist) every attempt gets its own worktree after `preparing`, and on completion, failure or operator stop the Host records an `evidence` attempt event plus a patch file (`<state>/evidence/<attemptId>.patch`, mode 0600) served by `GET /projects/:projectId/attempts/:attemptId/patch` only while its sha256 still matches. A new attempt of a continued task starts from the previous attempt's branch. Events and API responses never contain absolute paths. `evidenceTimeoutMs` (default 120 s) bounds the evidence step. A fenced, expired or crashed attempt leaves its worktree in place; nothing is deleted automatically. `[fake:edit]` in a task goal makes the fake runtime edit files so this can be exercised without a model.
- `createWorktree` / `removeWorktree`: one worktree and branch (`factory/<task>-e<epoch>`) per attempt, always inside the worktrees root; removal only for registered worktrees of that project.
- `collectEvidence` / `buildPatch` / `patchIsSafeToApply` / `applyPatchToRepo`: evidence and patch are computed without changing the branch history; a truncated patch is never offered; patches that touch `.git`, use `..`, absolute paths or outward symlinks are refused; `applyPatchToRepo` always checks first and never stages or commits.
- Every git call runs through the process runner with an exact environment: no hooks, no global/system config, no credential helpers, no prompts.
- CLI: `node dist/workspace/cli.js clone --projects-root <dir> --name <name> --source <path|url>`.
- Checked on the real `E:\GIT\BTL-LTM` (read-only): clone in about 30 s over the 9p mount, evidence and patch round trip, and the source `.git` (1742 files) unchanged.
