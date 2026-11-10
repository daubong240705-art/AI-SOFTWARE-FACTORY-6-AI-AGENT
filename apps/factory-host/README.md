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
- Read views: `GET /teams` (charter, revisions of team, seats and engagements for the operator commands, seats with live load and, for v2 packs, pinned capabilities and tools, engagements), `GET /teams/:teamId/queue` (cross-project queue in start order), `GET /projects/:id/team` now lists all engagements.

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

## Project Dossier and Resume Briefing (M3 X1b)

`dossier.refresh {}` is an operator command available without a feature flag. It
builds a deterministic Project Dossier from approved requirements and canonical
artifacts, task and gate counts, applied decisions, pending questions, open
cross-team requests, stale knowledge, engagements and next steps. Lists are
bounded and ordered; free text is sanitized. No model is called.

Refresh stores a new `dossier` draft version through artifact registration,
including the content store, knowledge index, supersession, dependant staleness
and entity events. Identical state returns the existing reference. The digest
has no clock timestamp and excludes the dossier's own canonical reference.
Review and approval use `artifacts.transition`; refresh never approves a version.

Authenticated reads: `GET /projects/:projectId/dossier` returns the newest stored
markdown and `current`/`outdated`; `GET /projects/:projectId/briefing?since=<ISO>`
returns counts and up to ten examples per change category, knowledge freshness,
team pack versions, fixed suggestions and explicit tracking limits. Without
`since`, the baseline is the latest dossier creation or earliest retained project
event. Windows are strictly after the baseline. Older transitions without recorded
times are not reconstructed. Profile/skill diffs and Git HEAD changes are not
tracked yet. Resume context comes from artifacts and decisions, never an old session.

With `FACTORY_MULTI_TEAM=1`, agents can call read-only `project.briefing {}`.
Artifact metadata and counts use `visibleToScope`; private drafts stay scoped to
their team or exact request grants. The tool enforces active attempts, 100 calls
per attempt and a 48,000-byte JSON response budget.

## Seat instructions (M3 P2)

Teams pin pack content at creation. `pack_snapshots` stores the manifest by digest,
`pack_files` stores profile and skill text, and `teams.pack_digest` selects that
snapshot. The digest covers the manifest, profiles and every declared SKILL.md,
using length-prefixed bytes. Files must contain no NUL and fit within 65536 bytes.
Editing a pack on disk does not change an existing team. Publish changed content
by bumping the pack version; the existing key and version rule creates a new team.

Agents receive the seat profile after the task, acceptance criteria and fixed
rules, before Context and Handoff. OpenCode includes at most 6000 UTF-8 bytes of
profile and twenty skill catalog entries (name and description, at most 250
characters), plus a sentence explaining how dotted tool names map to
`factory_` names. Redaction applies before truncation. The total prompt retains
its existing byte ceiling, cutting instructions first and preserving the goal.
Without instructions the prompt remains byte-identical.

Use `skill.get` (`factory_skill_get` in OpenCode) with `{ "name": "skill-name" }`
to read full pinned skill text as data. The Host derives the seat from the active
attempt; only that team's snapshot is readable. Reads are fenced, capped at 200
per attempt and bounded to 32768 UTF-8 bytes, with a final `[truncated]` line when
shortened. Unknown and inaccessible skills return the same `skill not found` error.
This tool is available independently of multi-team mode.

At startup, teams lacking a digest are backfilled only when a registered pack
has the same key and version. Unavailable packs stay without instructions, and
backfill or delivery failures log a generic message without failing attempts.
`attempt_instructions` records provenance and byte metrics per attempt; the task
context endpoint includes `instructions` metadata, or null for older attempts.

## External tools through remote MCP (V2b)

Set `FACTORY_MCP_SERVERS_FILE` to an operator-owned JSON configuration file.
Unset or empty leaves external tools off. An unreadable or invalid configuration
refuses startup with a generic error. No new dependency or process launcher is used.

```json
{
  "servers": [{
    "name": "reference",
    "url": "https://mcp.example.invalid/mcp",
    "headers": { "Authorization": "env:EXAMPLE_MCP_AUTHORIZATION" },
    "timeoutMs": 15000,
    "maxResultBytes": 32768,
    "maxTools": 32
  }]
}
```

Header values are literal strings unless they start with `env:NAME`, which resolves
from the Host environment at each request. Supply the complete header value in
that variable, including any authentication scheme. A missing or invalid value
disables that server. Header injection and reserved transport headers are refused.
URLs require HTTPS, except HTTP on localhost, 127.0.0.1 or [::1]; URL credentials
are refused. Redirects and cookies are refused. Only the Host contacts servers;
sandboxed agents reach the Host MCP endpoint.

Packs reference tools as `ext.reference.lookup` or `ext.reference.*`; they cannot
register servers. Seats receive external tools only through their pinned explicit
`tools` list. Omitting that field grants no external tools. Core Host tools retain
their existing behavior. `tools/list` includes permitted discovered tools with an
`External (reference):` description prefix. Results carry a Host wrapper identifying
them as reference data, not instructions. Treat every remote result as untrusted,
including text that imitates Host messages.

Limits: 16 servers; 1–64 tools per server (default 32); discovery cached five minutes;
1–60 second operation timeout (default 15); 16 KiB arguments and input schemas;
1 MiB response body before parsing; 1–64 KiB result text (default 32 KiB), truncated
at a whole character with `[truncated]`. The Host response envelope may further
reduce the output or tool catalog to fit its existing 64 KiB JSON limit. Each
attempt may make 50 external calls. Evidence events contain only tool name,
success/error, duration and byte count, without arguments or result content.
Resolved header values are redacted from reference results and discovery text.
Three consecutive failures open a server circuit for 60 seconds; one probe is
allowed afterwards. Success closes the circuit. Shutdown aborts in-flight requests.

`GET /mcp-servers` requires an operator session and reports only name, URL origin,
state (`ready`, `unreachable`, `disabled`, `circuit-open`), cached tool count and last
check time. Discovery is lazy, so an uncontacted server starts as `unreachable`.
`node scripts/pack-check.mjs --servers <file> <packDir>` optionally warns when a
tool reference names an unconfigured server. Without `--servers`, runtime names
are accepted without that warning.

SSRF destinations are controlled by the operator's server registration; grant
metadata and Host workspace paths are never attached to remote requests. Stdio
servers, OAuth flows, resources, prompts, sampling and server-initiated requests
are unsupported. JSON and SSE responses, session headers, one session-loss retry,
and paginated tool discovery are supported by the minimal Streamable HTTP client.

## Workflows as data (M5 W1a)

Packs may declare `workflows`, up to eight unique relative `.json` files inside
the pack, each at most 64 KiB. Copy the example in `packs/_template/workflows`,
declare it in `pack.json`, then run `npm run pack:check -- <pack-directory>`.
The checker validates schemas, graph references and cycles, bounded rework,
parallel joins, parameter comparisons and advisory capabilities. Workflow bytes
participate in the pack digest; packs without workflows retain their digest.

`GET /packs` lists workflow keys, revisions and titles. The always available
`workflows.create`, `workflows.start`, `workflows.pause`, `workflows.resume` and
`workflows.cancel` commands use command replay protection and revision checks.
Create takes an instance UUID, definition key, optional pack key, parameter
overrides and optional title. Ambiguous definitions require a pack key.
Instances start proposed, fill parameter defaults and mark stages skipped only
when their parameter-only `includeIf` is false. Facts remain unknown.
Authenticated reads are `/projects/:projectId/workflows` and the same route
with `/:instanceId`; list reads return the newest 100 instances and stage counts.

Definitions are pinned by value in migration 0010, independent of later pack
edits. Conditions are bounded typed data: no code, LLM or arbitrary expressions.
W1a only stores instances and state changes; it creates no Tasks, evaluates no
dependencies and performs no execution. Resume atomically collapses
paused → resuming → active into one revision. W1b adds freshness checks,
Task generation, dependency evaluation, parallel joins, gates and bounded rework.

### Plan Patch (M5 W2)

The Lead proposes a patch; deterministic code validates its operations against the
instance's copied definition and task history. Each patch contains 1–10 operations
and a reason of 1–500 characters. The strictest policy in the patch wins.

| Operation | Default policy | Conditions and refusal rules |
| --- | --- | --- |
| `addTaskWithinStage` | auto | Existing unfinished stage; total tasks must fit `limits.maxTasks` (default 1), with at most 20 extra tasks. Title is plain text, 1–120 characters. |
| `skipOptionalStage` | auto | Optional stage in pending, ready or blocked state without task history. |
| `splitStage` | auto | Pending or blocked stage without task history; 2–5 new unique stage keys, connected in sequence. Incoming edges and gates use the first stage; outputs, outgoing edges and parallel group membership use the last. |
| `addStage` | approval | Full stage definition, with `after`, `before`, or both; referenced stages must exist. Both anchors replace their direct finish-to-start edge. Maximum 60 stages. |
| `reorderStages` | approval | Pending stage without task history; move after an existing different stage. Artifact-approved and rework edges touching the stage prevent the move. |
| `removeRequiredStage` | operator | Pending stage without task history; reconnect predecessors to successors and drop its gates and unused joins. Artifact-approved and rework edges prevent removal. |

The instance's `allowedPatches` overrides defaults. The operator can apply all
three policy levels; the Lead applies only `auto`. Lead proposals requiring
`approval` or `operator` remain pending until the operator uses
`workflows.decide-patch`. Approval revalidates against the current definition;
an invalidated proposal becomes refused with `stale`. Rejection records the
operator's sanitised comment. Terminal workflows cannot be patched. There are
at most 50 audit rows and three pending patches per instance.

`workflows.patch` takes `{ instanceId, expectedRevision, ops, reason }`.
For example, `ops: [{ op: "addTaskWithinStage", stage: "development",
title: "Verify migration evidence" }]` adds work when that stage's task limit
permits it. To insert a stage, use `{ op: "addStage", stage: { key: "evidence",
phase: "execution", title: "Check evidence", requiredCapabilities: ["docs.write"],
inputs: [], outputs: [] }, after: "development", before: "qa" }`.
Decide using `{ patchId, decision: "approve" }` or
`{ patchId, decision: "reject", comment: "Use the existing review stage" }`.
These commands use the normal command envelope and replay protection.

The optional MCP tool `workflow.patch` takes only `{ ops, reason }`. It is
default deny: the seat's pinned tool list must include `workflow.patch` or
`workflow.*`; an omitted list grants no access. The active grant's task determines
the instance, and calls are fenced by attempt, epoch and lease, with a limit of
20 calls per attempt. Results contain only patch number, state and any fixed
refusal; denied tools behave like unknown tools.

Migration 0012 adds numbered audit rows and extra-task counters without rebuilding
tables. Applying a patch atomically records the definition revision, stage edits,
instance revision and change events, then advances the engine. Refusals leave the
definition and stage state intact. Extra tasks are created once per iteration,
and all must finish before the stage completes. Reasons never become task goals;
only sanitised extra titles enter generated goals. History is retained.
Authenticated workflow detail includes patch history and stage `extraTasks`;
both inbox routes include pending patches, operation summary lines and additive
`counts.patches`, included in `counts.total`.

## Pack v2: capabilities, tools and the template (V2a)

Pack v2 adds optional fields to the existing manifest, with no migration or new
dependency. `seats[].capabilities` contains up to 12 unique identifiers matching
`^[a-z0-9][a-z0-9.-]{0,39}$`. `seats[].tools` contains up to 32 exact Host tool
names or `prefix.*` patterns matching at least one known Host tool. Duplicate
tools produce a validator warning. `produces` contains up to 13 unique artifact
kinds and is informational. Optional `workflows` lists up to eight relative JSON
definitions (see Workflows as data above). `GET /packs` exposes these fields when declared,
alongside seat metadata, without profile or skill text.

An explicit owner always wins. If any non-lead seat declares capabilities, the
Host selects a worker satisfying every required capability: equality or a dotted
descendant, ignoring case. For example, `research.evidence.sources` satisfies
`research.evidence`. It selects the worker with the fewest live attempts in that
project and team (queued, leased, preparing, running, waiting-input, parked),
breaking ties by name then id. Without requirements, all workers are candidates.
Unsatisfied requirements fail with `no-seat-for-capabilities`; a Lead-only team
falls back to its Lead. Teams without worker capability declarations retain the
legacy keyword rules. Capabilities and tools resolve through the team's pinned
snapshot by seat name; disk edits never change an existing team.

Core tools are always allowed: `task.progress`, `output.register`,
`decision.request`, `skill.get`. An allowlist can only REMOVE optional Host tools,
never add tools or affect the core tools. Omitted `tools` preserves v1 access;
`tools: []` denies all optional tools. Both `tools/list` and `tools/call` enforce
the policy from the attempt's persisted seat. Denied tools are hidden and return
the same `tool is not available` error as unknown tools, before side effects or
tool counters. Existing Host availability and permission checks still apply.

Copy `packs/_template` to a new ordinary directory such as `packs/marketing-team`,
set its key, name, charter, seat capabilities and tool rules, then write its English
profiles and skills. Build and validate from `apps/factory-host`:

```sh
npm run build
npm run pack:check -- ../../packs/marketing-team
npm run pack:check -- ../../packs/_template ../../packs/software-team ../../packs/research-team
```

The validator prints one block per pack, metadata counts and digest, content-free
errors and advisory warnings. Exit codes are 0 when all packs pass, 1 for invalid
packs, and 2 for usage errors. Profiles above 450 words, skills above 700 words,
descriptions above 250 characters, missing capabilities, duplicate tools,
unsupported Lead capabilities and missing `produces` generate warnings.
Missing skill descriptions are errors for v2 packs and advisory warnings for
legacy packs, preserving existing pinned content such as software-team.
Directories beginning with `_` or `.` are silently skipped by the registry.
Restart the Host to discover the new pack, create a team from its key/version,
and engage it in a project. This adds a team entirely through data. Bump the pack
version to publish subsequent changes; existing teams retain their snapshot.


### Workflow engine (M5 W1b)

The deterministic engine refreshes current task and output states, evaluates readiness and facts, creates one task per ready stage and iteration, applies bounded rework, then updates the instance. Repeated evaluation does not duplicate tasks. Briefs use definition fields and parameter lines. Inputs pin up to eight newest approved upstream versions.

Finish-to-start requires a done or skipped source. Artifact-approved requires the declared kind at approved status; informs never blocks. Parallel groups join with all, any or quorum completion. includeIf is fixed at creation; skipIf is evaluated at readiness. Facts support project approved artifacts, review verdicts and produced artifact status. Unknown facts block conditional edges and gates with a warning.

Execution and irreversible-action gates use the existing Go gate; review gates use human-final review. Rework resets its source and target, retains history and adds sanitised feedback to the next brief. Exhausted maxLoops stalls the instance. Required failures stall; optional failures are skipped.

Selection uses active engagements of active teams. A capability-declared team needs one non-lead seat covering every capability using dispatch's case-insensitive dotted-prefix rule. Legacy teams are fallbacks. Ranking prefers declared coverage, teamHint in pack key or name, lower live engagement load, higher priority, then name/id. Active operator overrides take precedence.

Start, resume, task transitions, artifact status changes, approvals.decide and engagement changes trigger evaluation. Startup and 60-second sweeps repair missed notifications. Paused and terminal instances create no tasks. Operators can add/reactivate an eligible engagement or use workflows.assign-stage with instanceId, expectedRevision, stageKey and engagementId (null clears it) on pending/blocked stages. Retry a failed task, then resume a stalled instance. Detail views include stage reasons, engagement, iteration, loops and task history.

Label/check/monitor facts, Plan Patch, schedules and freshness checks on resume are not supported yet. Workflow code effects map to task artifact effects; external effects map to external-irreversible.
# Scheduler (M5 A1)

Schedules start workflow instances through `workflows.create` and, by default,
`workflows.start`. They support cron (5 or 6 fields, at least 60 seconds between
runs), intervals (60–2,592,000 seconds, anchored to creation), and once (a future
ISO timestamp with an offset). The default timezone is `Asia/Ho_Chi_Minh`.
Croner applies IANA timezone and DST rules: a missing local time is moved to the
DST transition, and an overlapping local time runs once. Intervals use elapsed UTC time.

The host ticks at startup and every 30 seconds without a feature flag. A run is
on time through 90 seconds late. The default missed policy, `skip`, records the
latest ten missed runs per tick. `coalesce-once` fires only the latest due time.
`catch-up-limited` fires the latest 1–5 late runs (default 3), followed by on-time
runs. For example, ten due minute intervals with the clock exactly at the tenth
produce two on-time runs: skip fires those two, coalesce fires one, and catch-up
with limit 3 fires five. Backlogs are bounded to the latest 50 due times, with
at most 100 recorded occurrences across a tick.

Concurrency counts all nonterminal instances previously started by the schedule.
`skip-if-running` (default) skips while any remain. `queue-one` permits two
nonterminal instances, representing one running and one queued; it does not
delay activation of the second instance. `allow-parallel` requires a limit of
2–5. Completed, failed, cancelled, and superseded instances release capacity.

Occurrences deduplicate by project, schedule, UTC scheduled time, and trigger
(`time` or `manual`). Workflow instance and command IDs are deterministic UUIDs
derived from SHA-256 of that identity and command purpose. Each schedule tick
commits occurrences, workflow commands, receipts, and events in one transaction;
a duplicate occurrence is dropped. Three consecutive start failures quarantine
the schedule. `schedules.resume` clears quarantine and failures and calculates a
future run from the current clock. A once schedule pauses after processing its
occurrence. Moving the clock backwards never fires a schedule.

Commands are `schedules.create`, `update`, `pause`, `resume`, `delete`, and
`run-now`. Mutations require the current revision. Manual runs use millisecond
timestamps and obey concurrency and enabled state while ignoring missed policy.
Schedule actions resolve definitions through registry packs and validate typed
parameters. Projects have at most 50 schedules with unique names.

Authenticated reads: `GET /projects/:projectId/schedules` (including quarantine
state and three upcoming instants) and
`GET /projects/:projectId/schedules/:scheduleId/occurrences` (latest 50).
Read surfaces expose parameter keys only. Event triggers, monitors, quiet hours,
and budgets arrive in A2/P3/N1.

## Watchdog and monitors (M5 A2a)

The 60 second sweep checks active workflows after advancing the engine. A workflow
stalls when it exceeds its maximum duration (default 30 days), makes no progress
while work remains (default 24 hours), or cannot advance pending/blocked stages
without runnable work. Failed stages and exhausted rework limits also stall through
the engine. The instance view includes `stalledReason` and `lastProgressAt`.
After addressing the cause, use `workflows.resume` with the current revision;
resume resets the progress timestamp. The watchdog never starts a workflow.

Create up to 30 named monitors per project with `monitors.create`; update, pause,
resume and delete require the current revision. Internal probes run at startup and
on the 60 second sweep when due, at intervals from 60 seconds to one day:

- `artifact-age`: count approved versions of the selected artifact kind older than `days`.
- `approval-overdue`: count pending approvals requested more than `hours` ago.
- `workflow-stalled`: count workflow instances currently stalled.
- `disk-free`: available GiB on the Host state filesystem, rounded to two decimals;
  the only accepted selector is `{ "path": "state" }`.

Counts default to comparator `gt`; disk space defaults to `lt`. Equality does not
breach the threshold. Hysteresis trips after `tripAfter` consecutive breaches
(default 3) and recovers after `recoverAfter` consecutive healthy checks (default 1).
An unknown monitor becomes healthy on its first non-breach. Opposite results reset
the streak. Probe errors preserve status and advance the next check.

Only status changes record history and emit `entity.changed` and `monitor.changed`.
Every workflow state change emits `workflow.state-changed`. Tripped monitors and
stalled workflows appear in the global and project Inbox with additive counts.
Read monitor summaries and recent edges through the project monitor and monitor
events routes. Probes use no model and no outbound network.
HTTP probes are unsupported; rules/actions belong to A2b and notifications to N1.
# Rules (M5 A2b)

Rules react to internal project event log transitions and start workflow instances through
`workflows.create` and `workflows.start`. The Host evaluates them at startup and after
monitors in its injected 60 second sweep. No rules means no evaluation work.

Supported event fields:

| Event | Fields |
| --- | --- |
| `task.status-changed` | `to`, `taskCode` |
| `artifact.status-changed` | `to`, `artifactKind` |
| `workflow.state-changed` | `to`, `workflowKey` |
| `monitor.changed` | `from`, `to`, `monitorName`, `monitorKind` |

Derived fields come from project-scoped database records. Conditions use `eq`, `ne`,
or `in` (up to 10 string values), combined with nonempty `all`, `any`, and `not`,
to a maximum depth of three. No code is evaluated.

For example, a `rules.create` payload can start an installed `incident-review`
definition when the monitor named `disk` trips:

```json
{
  "ruleId": "019a0000-0000-7000-8000-000000000001",
  "name": "Disk incident review",
  "eventType": "monitor.changed",
  "condition": { "all": [
    { "field": "monitorName", "op": "eq", "value": "disk" },
    { "field": "to", "op": "eq", "value": "tripped" }
  ] },
  "action": { "kind": "start-workflow", "definitionKey": "incident-review" },
  "debounceSeconds": 300,
  "maxFiresPerHour": 6
}
```

Each project processes at most 200 ordered event rows per tick. A fire's unique
project/rule/event-sequence key provides deduplication. The cursor, fire history,
and workflow command receipts commit together. SHA-256-derived instance and command
IDs make repeated evaluation deterministic. Bookkeeping emits no events.

Policy order is deduplication, hop limit, active state, debounce, rate limit,
and concurrency. Events outside rule-started workflows start at depth zero; events from a rule-started
workflow (including its tasks and produced artifacts) add one hop. Depth three
is allowed; depth four is skipped. Debounce excludes matches strictly before the
configured interval expires (0–86400 seconds, default 0). The hourly window starts
at the first successful fire and resets after 3600 seconds. Exceeding the configured
1–60 starts per hour (default 6) quarantines the rule. A previous nonterminal workflow
causes a concurrency skip. Three consecutive start failures also quarantine;
a successful start resets the failure counter. `rules.resume` clears quarantine,
the hourly window, and failures. Pause, update, resume, and delete require a revision.
Names are unique per project, with at most 30 rules per project.

Authenticated reads: `GET /projects/:projectId/rules` and
`GET /projects/:projectId/rules/:ruleId/fires`. Action summaries show parameter
names only. Global and project inboxes include quarantined rules and their count.

Webhooks, network requests, LLM evaluation, actions other than starting a workflow,
and cross-entity conditions are unsupported in this slice.

## Policy (M5 P3a)

Token reservations check **day, project, engagement, task**, in that order, and
report the first exhausted or would-exceed budget. Project usage includes all
project records across all dates. Engagement usage includes only records attached
to tasks in that engagement. Unreported usage counts its reserved estimate;
unknown costs remain unknown and are never converted to money.

AP-8 audit: the lead selected defaults of **1,000,000 tokens/day**, **200,000
tokens/task**, and **80% warning**. Project and engagement budgets have **no
implicit limit**; use `budgets.set` to configure them explicitly. Project scope
uses the project ID; engagement scope uses an engagement in that project. The
budget read route adds project usage with a nullable limit and explicit engagement
budgets. Reservations that end exactly at the limit fit; usage already at the
limit blocks further calls.

AP-8 autonomy defaults follow architecture 04 section 18: **project L3, team L2**.
`autonomy.set` configures either subject with optimistic revisions (`null` on
creation). Effective team authority is the minimum of its level and the project's.
`GET /projects/:projectId/autonomy` returns configured levels, sources, project
revision, effective team levels for engaged teams, and the defaults used.

| Level | Authority |
| --- | --- |
| L0 suggest | Propose only |
| L1 in-task | Task work |
| L2 in-team | Split work, pick seats, add tasks within a stage, rework, clarify/consult requests |
| L3 cross-team-in-budget | Produce requests, automatic plan patches, consulting engagements |
| L4 external-under-standing-approval | External action under standing approval |

Every level requires the operator for scope or criteria changes, opening gates,
raising budgets, spending money, publishing externally, irreversible actions, and
global knowledge. The contracts' `allows()` always rejects those actions.

This slice enforces autonomy at two points: an automatic plan patch becomes an
approval (Lead proposals stay pending) below project L3; cross-team requests
require project L3 for produce and L2 for clarify/consult. Existing approval and
operator patch policies retain their flow. Other action thresholds describe the
contract for later enforcement.

Organization monthly budgets await an organization entity. Chain budgets are not implemented.

## Circuit breakers (M5 P3b)

AP-8 audit: the lead selected **5 consecutive route failures**, or **strictly more
than 50% failures in the last 20 recorded outcomes** (all 20 samples required),
with a **5 minute cooldown**. A model route then admits one half-open trial;
success closes it and clears history, failure restarts the cooldown. Concurrent
trials are refused. Network errors, timeouts, HTTP 5xx and 429, and upstream stream
errors count as failures; completed 2xx responses count as successes. Other 4xx
and caller cancellations do not affect health. An unused trial is released.
Refusals return HTTP 503 `route_circuit_open` before reserving budget or consuming
a request allowance. Route health is in memory, bounded to 64 model IDs, evicting
the oldest closed key. If all keys are unhealthy, new keys are refused.

AP-8 audit: **5 distinct failed tasks within 60 minutes** pauses an active Team
with an active engagement. The failure window uses `task.status-changed` events,
not the current task state. The pause increments the team's revision and emits
its usual entity change once. The Operator resumes with `teams.set-lifecycle`;
the next sweep closes the breaker and excludes failures through that resume
checkpoint so the team does not immediately trip again. Archived teams are ignored.
The breaker never resumes teams. Team state persists in migration 0017.

The startup and 60 second sweeps run the team breaker regardless of multi-team
dispatch configuration. Authenticated `GET /projects/:projectId/breakers` returns
team breaker rows and the proxy's route snapshot (empty when no proxy exists).
Global and project inboxes include open team breakers and their reasons.

Node and runtime breakers are not implemented here. Budget usage at 100% already
stops calls through the existing hard budget limit.

## Notifications (M5 N1a)

In-app notifications have three classes: `action` (operator attention), `important`
(significant information), and `digest` (daily progress). Startup and the existing
60 second sweep collect approvals, open team breakers, quarantined rules, non-ok
monitors, and stalled workflows. The existing Inbox response keeps its shape.
Authenticated `GET /projects/:projectId/notifications?state=unread|read|dismissed|all`
defaults to unread, returns the newest 100 items and the total unread count.
`notifications.mark-read` and `notifications.dismiss` are idempotent; dismissal is final.

Deduplication uses a project-scoped canonical tuple of entity kind, entity ID,
revision (or breaker opened time / workflow last progress time), and notification
class. Repeated ticks produce one notification per blocker revision. Approval
reminders have separate 50% and 90% keys per approval. The daily digest uses the
project and local date. Titles and bodies use the Inbox sanitizer and are limited
to 200 and 1000 characters.

AP-8 audit: the lead selected reminder fractions **0.5 and 0.9**, digest hour
**18:00**, quiet hours **22:00–07:00**, and local time **UTC + utcOffsetMinutes**
(default **420 minutes, UTC+7**, from budget configuration). Approvals expiring
within **24 hours**, including the boundary, and 90% reminders are urgent.
Reminders stop after an approval leaves pending. The digest includes today's
distinct done/failed tasks from transition history, decided approvals, pending
approvals, and a plain token count with `cost: no price list`. It is created once
per local day at or after 18:00, and skipped when there is no activity or pending work.

The optional `startHost({ pushChannel })` interface sends only sanitized title,
class, urgency, and the relative `/inbox` link. **No push channel is enabled** and
no delivery rows are created without one. An ntfy adapter is a later optional
step requiring the user's decision. Urgent actions bypass quiet hours; all other
pushes, including digests, wait until 07:00. AP-8 retry defaults are **3 total
attempts**, at least **300000 ms (5 minutes)** apart. Error text is never stored.
Each attempt is fenced in a transaction before awaiting the channel outside the
transaction. An ambiguous send interrupted by process termination remains fenced
to avoid duplicate delivery; only a caught failure permits retry.

Standing Approvals belong to N1b. Email and other channels, per-user preferences,
and a concrete network push adapter are not implemented in this slice.
