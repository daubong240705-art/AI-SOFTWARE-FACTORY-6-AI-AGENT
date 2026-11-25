# Factory Host (V2 control plane)

Independent of V1. M1 in progress: **storage**, **events** and the **API security layer** and the **command pipeline**, **SSE**, the **Host start-up**, **org** (project rosters), **work** (tasks), **model gateway**, **budgets**, **chat storage** the **Lead runner** and **same-origin UI serving** done.

```bash
cd apps/factory-host
npm ci --ignore-scripts --no-audit --no-fund   # better-sqlite3 ships prebuilt binaries, no install script needed
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


## Running it in WSL

Do not run the Host from `/mnt/<drive>`: loading `node_modules` over 9p takes 20+ seconds. Deploy to ext4 first:

```bash
bash /mnt/e/GIT/AI-SOFTWARE-FACTORY-6-AI-AGENT/scripts/factory-v2/deploy-host-wsl.sh
FACTORY_STATE_DIR=$HOME/factory-v2/state FACTORY_PORT=8787 node $HOME/factory-v2/app/apps/factory-host/dist/main.js
```

## Project roster and agents

`projects.create` gives each project its own roster from the selected pack or an empty roster.
`src/org/agents.ts` and the agent commands manage revisioned runtime, instructions, tools, and skills.
Use `/projects/:id/agents` to read agents, groups, and relations; tasks still dispatch through roster seats.
Startup migrates eligible shared rosters without touching live attempts or archived project history.

## Library

`src/org/pack.ts` validates the pack manifest and resolves local profiles, skills, and v1 import definitions.
`src/library/` imports packs as reusable, versioned skills and agent templates at startup.
Import is idempotent and does not rewrite existing agents. `/library` serves the resulting catalog.

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
- `FACTORY_LEAD_MAX_OUTPUT_TOKENS` (256..131072, default 4096). Reasoning models (for example DeepSeek v4) spend output tokens on reasoning before any visible text: with 4096 a planning turn was cut off (E1b). A reply that stops with `finish_reason=length` now fails the turn as `output-limit` with a message naming this variable, and its spend is still recorded.
- Plan tasks are always stored as `human-final`: no automatic reviewer exists yet, and an `automatic`/`hybrid` task would wait in review forever (E1b). The Lead protocol only offers `human-final`.

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

Registration accepts omitted L1. A supplied L1 must contain at least two non-empty lines and 80 trimmed characters, and differ from L0; malformed summaries are rejected before writes. `artifacts.transition` requires L1 before approving research-report, requirements, adr, data-model, api-contract, ui-spec, plan and dossier versions.

## Dependency outputs in the Context Pack (CE-0b)

After resolving declared inputs, the Host adds summaries from direct dependency
Tasks in state `done`. For each dependency and artifact, only its latest approved,
readable version produced by one of that Task's attempts is eligible. Every read
uses the same `visibleToScope` policy; unreadable versions add no input, omitted
entry, or retrieval hint. All joins stay within the current project.

At most ten dependency inputs are added, ordered by Task code, artifact title,
then artifact ID and version for ties. Exact `artifactId@version` references
already declared in `Task.inputs` are skipped. Empty or whitespace-only L0 summaries
and `code-ref` artifacts with media type `text/x-diff` are skipped. Dependencies
that are unfinished or have no eligible output add nothing.

Each added input has `why: 'dependency output'`, a sanitized `TSK-001: <title>`,
L1 text when available (otherwise L0), and the usual stale marker. Dependency
inputs follow declared inputs, so the budget loop degrades them from L1 to L0
and omits them before touching declared inputs. Budget omissions have reason
`over-budget` and a `knowledge.get artifactId=<id> version=<n>` retrieval hint.
The contract accommodates 100 declared inputs plus ten dependency inputs.
Tasks without dependencies retain their existing behavior.

The pack carries summaries. Code only travels through the workspace (CE-0a);
dependency summaries do not copy code or patches into the pack or workspace.

## Cross-team requests (M3 C1b)

A request (CTR) IS a Task (`origin.kind='cross-team'`, code `REQ-nnn`, migration 0006 adds `ctr_meta`, immutable `ctr_messages`, `ctr_followers`); there is no second entity. Migration 0007 adds durable `ctr_waits`. `responseMode: 'blocking'` parks the requester session and releases its slot; a new attempt for the same seat receives `Request results:` when the answer arrives. Notify cannot block; at most three requests may block a task at once. A blocking duplicate also waits.

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


## Workspace (M2)

### Project integration branch (CE-0a)

With a workspace provider configured, accepted task work accumulates on `factory/integration`
in the project's clone. A done decision (review acceptance, manual transition, or CTR accept-as-is)
enqueues one integration row when the task's latest attempt recorded a `workspace-ready` branch.
Tasks without a workspace branch create no row. Enqueue and acceptance share one transaction.

The dispatcher merges pending rows in creation order, one at a time per project, outside database
transactions. The Linux-only Git helper creates the branch at the clone's current HEAD when absent,
uses `merge-tree --write-tree --no-messages`, then `commit-tree` and a compare-and-swap `update-ref`.
It never touches a working tree. Merge commits use the explicit Factory identity
(`Factory <factory@localhost>`), never the user's identity. An identical tree needs no commit.
The branch lives only in the project's clone and is **not pushed by any existing effect**.

New first attempts start at the integration tip when present; reruns continue their own previous
task branch. A queued attempt waits while any direct dependency's integration row is pending or
in conflict. Merged, skipped, and absent rows do not block. Without a workspace provider, dispatch
behavior is unchanged.

Merge conflicts appear in the Inbox and `GET /projects/:projectId/integration`, with an action
notification. Git failures retry up to three times before requiring an Operator decision.
Only the Operator can use `integration.retry { taskId }` (reset attempts and retry) or
`integration.skip { taskId }` (resolve the conflict without merging).
**Skipping allows dependents to start from the integration branch WITHOUT that task's work.**
These decisions are idempotent when already pending or skipped, respectively.

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

Agents can call read-only `project.briefing {}`.
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
metadata and Host workspace paths are never attached to remote requests. OAuth
flows, resources, prompts, sampling and server-initiated requests are unsupported
by the Host client. JSON and SSE responses, session headers, one session-loss retry,
and paginated tool discovery are supported by the minimal Streamable HTTP client.

### CLI-native servers for local CLI seats

Browsers, Blender and similar tools need images, file paths, long sessions and one
process per agent, which the Host proxy above does not provide. With
`FACTORY_LOCAL_CLI=1`, the same file may also list stdio servers that the seat's own
CLI (Claude Code or Codex) launches for each attempt. The Host never starts or
contacts them.

```json
{
  "servers": [{
    "name": "playwright",
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@playwright/mcp@latest", "--headless", "--isolated", "--output-dir", "{workspace}/.factory/playwright"],
    "envNames": [],
    "clis": ["claude", "codex"]
  }]
}
```

`{workspace}` in `args` becomes the attempt worktree. `envNames` lists variables the
server needs; each must also be in `FACTORY_CLI_PASS_ENV`, or startup fails with
the server and variable name. `clis` defaults to both. The name `factory` is
reserved.

Seats receive a CLI-native server only through their pinned `tools` list
(`ext.playwright.*` or `ext.playwright.<tool>`), exactly as for proxied servers. A
seat with a pinned `tools` list is isolated:
- **Claude:** runs with `--strict-mcp-config`, so it ignores the operator's own MCP
  servers and claude.ai connectors.
- **Codex:** gets `mcp_servers.<name>.enabled=false` for every server in
  `codex mcp list --json` (cached five minutes). If listing fails, the attempt
  continues with a progress note.

Seats without a pinned list keep the CLI's own configuration, as before.

The Host also pre-approves MCP tools, because both CLIs refuse unapproved MCP calls
in non-interactive runs:
- **Claude** `workspace-write` seats run in `acceptEdits` and get
  `--allowedTools mcp__factory,mcp__<server>…`. This also restores the Factory's
  own tools for those seats.
- **Codex** gets `default_tools_approval_mode="approve"` for `factory` and every
  assigned server.

Environment and output:
- **Claude** merges an MCP server's `env` into its own environment, so the Host
  blanks `FACTORY_MCP_TOKEN` and every passed variable the server did not request.
- **Codex** starts MCP servers with a minimal environment plus `env_vars`.
- **`.factory/`** in a worktree is agent scratch output (screenshots, traces). The
  Host excludes it when it stages results.

## Reference inputs, plan files and review evidence

**Task inputs reach the agent as files.**
- `tasks.create` checks that every `inputs` ref names a usable artifact version of the project.
- Lead plans may list `inputs` as artifact ids; each resolves to the latest usable version, and unknown ids are dropped.
- When an attempt starts, the dispatcher copies each input's stored bytes into `<worktree>/.factory/inputs/NN-<slug>.<ext>`, with these limits:
  - at most 20 files and 50 MiB in total;
  - mode 0600 and exclusive creation;
  - no symbolic links;
  - extensions limited to `[a-z0-9]`.
- PDF and Office inputs also get their extracted text as a `.md` file.
- `promptFor` lists the paths, titles and operator notes as reference material, not instructions.
- `.factory/` is excluded from results. A copy failure is reported as progress and never blocks the attempt.

**Upload note.** `POST /projects/:id/documents?note=` accepts up to 2000 characters, which are cleaned and stored as abstract L1. This is where the operator writes what agents should take from a reference image. Context Packs prefer abstract L1.

**Lead reads named documents.**
- The Lead receives the text of project documents whose file name (or a title of at least 8 characters) appears in a user message within its history window:
  - text types are read from their bytes; PDF and Office files from their extraction;
  - at most 5 documents, 24,000 characters each and 60,000 in total.
- The text is added to the operator's current message after history trimming, marked as data.
- Uploaded images are listed in the system prompt as "Reference assets" (id, title, note) so the Lead can assign them as task inputs.
- The Lead also uses the engaged team's pinned Lead profile instead of the Host default pack.

**Plan files.**
- A single ```` ```factory-csv ```` block (first line `# file: <name>.csv`) in any Lead reply is saved as a project document of kind `plan` (`text/csv`, quota applies). A system message names it.
- Saving a plan file creates no task. Asking the Lead (intent `delegate`) to apply a named plan file includes its text, and the Lead answers with an ordinary `factory-plan` block.
- `factory-plan` now allows up to 30 tasks.
- With `FACTORY_LEAD_CLI=claude`, `FACTORY_LEAD_MAX_OUTPUT_TOKENS` defaults to 16,384.

**Review evidence.**
- The core MCP tool `criterion.report {criterion, passed, evidence}` records one acceptance criterion of the agent's own task as an evidence event (exact criterion text, at most 64 calls per attempt). The review screen marks each criterion passed, failed or unreported, with its evidence sentence.
- Agents may register preview images and screenshots as `media` artifacts when a task asks for them. The review screen shows them as thumbnails through the knowledge raw route.
- The artifact content route also serves `text/plain`, `text/csv` and `application/json` as text.

**Other changes.**
- `projects.create` creates the project roster; additional teams remain available for dispatch and requests.
- The local CLI runtime's output limit defaults to 48 MiB (maximum 64 MiB), because stream-json carries every image an agent views.

## Workflow v2

`src/flow/` validates and runs draft or published flows, persists node progress, and recovers runs at startup.
Task and approval changes notify the flow engine through `src/flow/lifecycle.ts`.
Use `flows.import-v1` to convert pack JSON into an editable v2 draft. The v1 engine and its job schedules are retired.

## Automation rules and monitors

Rules observe task, artifact, and monitor events with a cursor, debounce, and hourly rate limit.
Old rule actions that start v1 jobs do not execute. Monitors still track overdue approvals, artifacts, stalled v2 runs, and disk space.

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

The startup and 60 second sweeps run the team breaker. Authenticated `GET /projects/:projectId/breakers` returns
team breaker rows and the proxy's route snapshot (empty when no proxy exists).
Global and project inboxes include open team breakers and their reasons.

Node and runtime breakers are not implemented here. Budget usage at 100% already
stops calls through the existing hard budget limit.

## In-app notifications

The Host records action, important, and daily digest notifications in the project database.
`GET /projects/:projectId/notifications` returns the notification list and unread count.
Use `notifications.mark-read` or `notifications.dismiss` to update notification state.

## Standing approvals (M5 N1b)

Standing approvals authorize repeated low-risk actions within a project or a
specific team. Only `notify.send-internal`, `deploy.staging`, and
`artifact.publish-to-project` are accepted. Production deployment, spending money,
external publishing, and deleting data (`deploy.production`, `spend-money`,
`publish-external`, `delete-data`) can never be standing. The always-Operator
list still requires individual approval at every autonomy level: scope or criteria
changes, opening gates, raising budgets, spending, external publishing,
irreversible actions, scope/cost conflicts, and global knowledge.

The Operator creates or revokes approvals with `standing-approvals.create` and
`standing-approvals.revoke`. A project defaults to L3; the Operator must explicitly
raise it to L4 using `autonomy.set` before any standing use is allowed. Revocation
checks revisions and takes effect immediately for the next use. Expired approvals
never authorize an action. Uses and daily limits are checked atomically; retries
with the same use ID consume one allowance. Eligible approvals are selected by
earliest expiry. An optional positive `maxTokensPerUse` caps tokens per use.

AP-8 audit of lead-selected values: expiry must be in the future and at most
**30 days** away; daily limit defaults to **5**, configurable from **1 to 50**;
at most **20 active approvals** per project; expiry warnings begin **3 days**
before expiry and deduplicate by approval and expiry. Daily counters use UTC plus
the configured offset, default **420 minutes (UTC+7)**. Expired rows remain active
until revoked and count toward the active cap. The token cap has no implicit value.

The `notify.send-internal` MCP tool accepts only `title` and `body`. It is
**default deny**, available only when wired and allowed by the seat's tools list,
and **is not enabled in any pack**. Project and team identity come from the granted
attempt. Each permitted use creates one sanitized important, normal-urgency
notification; refusals create nothing and return only a generic message with an
`autonomy`, `none`, `expired`, `limit`, or `tokens` reason. No tokens, secrets, or
host paths belong in notification content. Warnings ride the existing notification
tick; there is no new timer. Authenticated
`GET /projects/:projectId/standing-approvals` returns the newest 100 approvals,
today's used/remaining counts, and the project level/source, without individual uses.

`deploy.staging` and `artifact.publish-to-project` are accepted action kinds but
have no consumer yet.

## API agent runtime

`src/runtimes/api-agent/` runs agent attempts through the configured model gateway.
It uses the pinned agent configuration and routes allowed tools through the normal MCP and policy layers.
Attempt lifecycle, budgets, and evidence are handled by the same dispatch path as other adapters.

## Configuration and system doctor

`src/config/` merges supported file and environment settings, validates inputs, and applies defaults.
`src/system/` exposes authenticated capabilities and doctor diagnostics without returning credentials.
Use the Host `--doctor` option for a configuration and dependency check without starting the service.

## Model settings

The authenticated `models.set` command and `GET /system/models` endpoint manage the Lead model and reasoning effort plus the ordered agent model allow-list. A setting row is stored in the Host database with an optimistic revision; the first agent model is used as the default for new attempts. The gateway URL and API key remain in the environment and are never stored or returned. While no database row exists, `FACTORY_LEAD_MODEL`, `FACTORY_LEAD_EFFORT`, and `FACTORY_AGENT_MODELS` remain the effective values; a row takes precedence immediately for subsequent Lead turns and newly issued agent tokens. Gateway model discovery is server-side, bounded, and cached briefly.
# Local CLI runtimes

Set `FACTORY_LOCAL_CLI=1` (default: off), or pass `--local-cli` to
`scripts/factory-v2/start-host-real.sh`, to run installed Codex and Claude Code CLIs
as Host child processes in each attempt's git worktree. Install and log in on the
Host machine (`codex login` or `claude auth login`). The session-protected
`GET /system/agent-clis` reports installation, version and login status; probes are
cached for 30 seconds.

Configure runtime, model, reasoning effort, and permissions with `agents.update`.
Changes apply to new attempts. Lead project chat uses the model gateway.

`autonomous` is the default and bypasses CLI approvals and sandbox restrictions.
`workspace-write` selects Codex's workspace sandbox or Claude's `acceptEdits`
permission mode. These agents run with the operator's permissions and can access
the Host machine, including local login files; Claude's permission mode is not an
OS sandbox. Enable only for trusted tasks. Factory does not copy login credentials
into its database; attempt MCP tokens are supplied through the child environment.

### CLI-only mode (no OpenCode, Lead on Claude Code)

`scripts/factory-v2/start-host-cli.sh` starts the Host with every agent on the local CLIs and without
OpenCode, bubblewrap or the model proxy. It sets:

- `FACTORY_LOCAL_CLI=1` and `FACTORY_DEFAULT_AGENT_CLI` (`claude` by default, `--agents codex` for Codex):
  seats without an override run on that CLI.
- `FACTORY_LEAD_CLI=claude`: the Lead chat uses `createClaudeCliGateway` (`src/models/claude-cli.ts`), which runs
  `claude -p --output-format json` in an empty temporary directory with no tools, MCP servers, settings or
  session file. `/system/models` then offers the CLI aliases `opus`, `sonnet` and `haiku`; a stored gateway id
  such as `ag/claude-opus-5-5-high` maps to its family alias, anything else to the CLI default.
  `FACTORY_LEAD_TIMEOUT_SECONDS` (10 to 3600, default 120; the script uses 600) bounds one Lead answer.
- `FACTORY_CLI_PASS_ENV`: comma-separated variable names the CLIs may receive in addition to the fixed
  allow-list, for a CLI's own provider key (the script uses `NINE_ROUTER_API_KEY` when it is set, for a Codex
  provider with `env_key = "NINE_ROUTER_API_KEY"`). `NODE_OPTIONS`, `LD_PRELOAD`, `LD_LIBRARY_PATH`,
  `NODE_V8_COVERAGE` and `FACTORY_MCP_TOKEN` are never passed. Passed values are redacted from stored CLI text.
- `FACTORY_BUDGET_TASK_TOKENS` and `FACTORY_BUDGET_DAY_TOKENS` default to the largest safe integer: nothing is
  blocked, Lead usage is still recorded. CLI agents do not go through the model proxy, so their tokens are
  counted by the CLI's own subscription, not by Host budgets.

A seat overridden to `native-opencode` fails with `runtime unavailable` in this mode; set it to inherit.

### Worktree dependency cache

The Host prepares root npm dependencies before an attempt CLI starts and reuses the
same helper for publish builds and standard npm preview installs. Set
`FACTORY_DEP_CACHE=0` to skip the cache entirely; agents and existing publish/preview
install paths can still install dependencies normally.

Entries live at `<stateDir>/dep-cache/<sha256(lockfile bytes + NUL + node-major)>/node_modules`.
On a miss, a private temporary project containing only `package.json` and
`package-lock.json` runs `npm ci --ignore-scripts --no-audit --no-fund --prefer-offline`
with a safe environment and a five-minute timeout. No operator npm configuration
or credentials are inherited. OpenCode misses use its isolated network policy
through bubblewrap; local CLI, publish and preview misses use Host networking.
Installation output stays in bounded, sanitized private `dep-cache/logs/<key>.log`
files and never enters agent context. Cache failure records an attempt warning
and allows the attempt to continue. Concurrent users of one key share one install
(the Host exclusively locks its state directory). Complete entries are renamed
atomically; interrupted partial directories are removed on startup. The eight
most recently used entries are retained, using directory mtimes; active users are
pinned until materialisation finishes.

Materialisation uses `cp --reflink=auto -a`: copy-on-write where supported, otherwise
independent copies. It deliberately avoids hardlinks, so an agent can write/chmod
its own dependencies without changing cached inodes. Links escaping the dependency
tree are rejected. Cache installs ignore lifecycle scripts, so packages requiring
install-time builds may require the agent to run their build/rebuild step.
Custom preview preparation commands are preserved. The Host checks a copied
starter's ignore rules, adds `node_modules/` if needed, excludes dependencies when
staging attempts, refuses tracked dependencies at checkpoint, and rejects patches
containing dependency paths.

Offline smoke (uses a local `file:` tarball and no registry):

```bash
npm run check && npm run build
node scripts/dep-cache-smoke.mjs
```
