# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Factory V2: a single-machine platform where a user hands work to a **Lead** agent, teams of agents work in their own Git worktrees, and the user reviews the results in a web UI. The Host listens only on `127.0.0.1`. The previous versions (Windows Worker V1, the Python web platform) have been removed. They survive only in git history at tag `v1-final`. Some older docs and the `codex-routing` skill still mention `apps/windows-worker`, `apps/api` and `apps/dashboard`; those directories no longer exist.

Most docs (`README.md`, `docs/`, runbooks, contracts README) are in **Vietnamese**. Code, comments, `apps/factory-host/README.md` and commit messages are in English. Commits use conventional style with milestone/slice ids, e.g. `feat(host): L1 ...`, `feat(ui): UX-24a ...`.

## Layout and build order

There is **no root workspace**. Each package is installed and built on its own:

- `packages/factory-contracts`: shared zod wire contracts (commands, events, entities). Consumers depend on it via `file:../../packages/factory-contracts`, and it exports from `dist/`. **Build contracts first** (`npm run build`) whenever you change them, before checking or building the Host or UI.
- `apps/factory-host`: the control plane (Node 22, TypeScript, Fastify, better-sqlite3 + Kysely).
- `apps/factory-ui`: the web UI (Vite, React 19, Tailwind 4, shadcn/ui). It talks only to the Host HTTP API.
- `packs/<key>/`: team packs (`pack.json`, `profiles/`, `skills/`, `workflows/`). They are data loaded by the Host. `packs/_template` documents the format.
- `scripts/factory-v2/`: pinned toolchain setup, deploy, real-Host start, Python preflight/schema checks.
- `schema/factory-v2/`: readable SQL reference specs. `apps/factory-host/migrations/0001_core.sql` was generated from them.
- `docs/architecture/00..15`: decision register, target architecture (`05`), milestone slice plans, and design docs.

Node must be **>= 22.20.0**. The runbooks pin 22.23.4 under `~/factory-v2/node`; run `export PATH="$HOME/factory-v2/node/bin:$HOME/.local/bin:$PATH"` first. Do not use a newer system Node.

## Commands

```bash
# contracts
cd packages/factory-contracts && npm ci --ignore-scripts --no-audit --no-fund
npm run check            # tsc --noEmit

# host
cd apps/factory-host && npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run build && npm run pack:check -- ../../packs/software-team   # validate one or more pack dirs

# ui
cd apps/factory-ui && npm ci --ignore-scripts --no-audit --no-fund
npm run check            # app; `npm run check:tests` typechecks the test tsconfig
npm run build            # tsc + vite build -> dist/, served by the Host
npm run dev              # Vite on 127.0.0.1:5173, /api proxied to the Host on FACTORY_PORT (8787)
```



Run a real Host: build all three packages, run `FACTORY_SRC=$PWD bash scripts/factory-v2/deploy-host-wsl.sh` (it wipes and recopies `~/factory-v2/app`, so stop the Host first; it runs on any Linux despite the name), then run `bash scripts/factory-v2/start-host-real.sh --check`. `scripts/factory-v2/start-host-cli.sh` is the CLI-only variant: no OpenCode, Lead chat on the Claude Code CLI (`src/models/claude-cli.ts`), budgets not limited. The `--check` step costs nothing. Without `--check` the script spends real tokens. See `docs/factory-v2-real-run.md` and `docs/factory-v2-arch.md` (Arch Linux).

## Host architecture

Build and type-check with `npm run check` and `npm run build`; the repository does not include an automated test suite.

`src/main.ts` reads the env (`FACTORY_STATE_DIR` default `~/factory-v2/state`, `FACTORY_PORT` default 8787, `FACTORY_RUNTIME`, `FACTORY_LOCAL_CLI`, model/budget/gateway vars) and calls `startHost` in `src/host.ts`. That function wires every module together, and it is where new command handlers and routes get registered.

- **Single write path:** all state changes go through `POST /commands` (`src/commands/pipeline.ts`). Commands are idempotent by `commandId`. One `BEGIN IMMEDIATE` transaction holds the handler's writes, the receipt and the events. Handlers are a `{ "<command.type>": handler }` map assembled in `host.ts`. Entity updates use optimistic `expectedRevision` (`null` means create). The command and payload schemas live in `@factory/contracts`, so a new command needs a contracts change first.
- **Events:** `src/events/hub.ts` (`EventHub`) keeps a per-project log with `epoch:sequence` cursors and an outbox. `append` only works inside a transaction, and notifications fire only after the outermost `hub.transaction()` commits. `src/api/sse.ts` streams `GET /projects/:id/events` with `Last-Event-ID` resume. `snapshot-required` tells clients to refetch.
- **API security** (`src/api/`, `src/identity/`): Fastify with no plugins, loopback-only listen, a `Host` header allow-list, and a one-time bootstrap token printed on stdout. Sessions are in memory and are lost on restart. Write routes need the session cookie, an exact `Origin`, and `x-csrf-token`. Modules add routes through `register(app, guards)`.
- **Storage** (`src/storage/`): SQLite with WAL, `foreign_keys=ON`, `synchronous=FULL`. Migrations have ordered versions and checksums. Never edit an existing migration; add a new one. The state directory must be absolute and outside `/mnt`.
- **Dispatch and runtimes:** `src/dispatch/` (the dispatcher, attempts with lease/epoch, seats, handoff, the `RuntimeRegistry`, plus `fake-runtime.ts` for tests) runs tasks as attempts in per-attempt git worktrees (`src/workspace/`). `src/runtimes/` holds OpenCode (inside a bubblewrap sandbox with a model proxy, see `src/sandbox/` and `src/proxy/`) and the local Codex/Claude Code CLI runtimes (`local-cli*.ts`, per-seat config via `seats.set-runtime`). Agents reach the Host through the MCP endpoint in `src/mcp/`. They never get the gateway API key.
- **Domain modules** each own their tables and are wired in `host.ts`. Modules: `org` (pack → team/seats), `work` (tasks), `workflow` (workflow-as-data, plan patches), `automation`/`schedule` (rules, monitors, watchdog, croner schedules), `policy` (budgets, autonomy, circuit breakers), `approvals`/`standing`, `knowledge`/`artifacts` (content store by hash, FTS), `context` (Context Pack assembly), `dossier`, `requests` (cross-team), `effects` (`git.push-branch`, which never targets main/master), `integration` (`factory/integration` branch), `documents` (upload plus extraction through the bwrap'd `workers/doc_worker.py`), `lead` (Lead chat runner via the model gateway), `backup`.

`docs/architecture/05-target-architecture.md` §5.2 and §6 define the governing principles: one source of truth via commands, an LLM proposes and deterministic code checks and writes, external side effects only through the effect executor, and modules don't read each other's tables. `apps/factory-host/README.md` is the detailed per-module reference (long). Search it for the section you need.

## Invariants worth knowing

- Cost is stored as **unknown**, never 0. Unreported usage counts at its reserved estimate.
- An `unknown` effect or attempt result is never retried automatically. It goes through reconciliation.
- The model API key (`NINE_ROUTER_API_KEY`) comes only from the Host process env and must never appear in errors, logs, DB rows or UI.
- The UI validates every Host response against contracts schemas and renders all server text as **plain React text**. Server HTML and markdown are never evaluated.
- TypeScript runs with `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Optional fields are spread conditionally (`...(x === undefined ? {} : { x })`) rather than set to `undefined`.

## UI notes

`src/api/` holds the validated client, command builders and SSE. `src/state/store.ts` is the external store. `src/screens/` holds the screens. Labels come from `design/factory-v2/labels.{en,vi}.json` plus `src/i18n/extra.{en,vi}.ts`. Both locales need entries. `src/styles/tokens.css` and `public/fonts/` are generated from `design/factory-v2` by `npm run tokens` and are git-ignored.

## Codex delegation skill

`.claude/skills/codex-routing/` (user-invoked `/codex-routing`) delegates scoped tasks to Codex CLI under `routing-policy.json`. Follow its `SKILL.md` exactly. Never edit `routing-policy.json` or `~/.codex/*`. Reply to the user in Vietnamese when running it.
