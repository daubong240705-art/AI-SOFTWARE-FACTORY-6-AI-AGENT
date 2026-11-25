# Factory Architecture

Factory is a local-first workspace for coordinating agents and people. An operator gives a Lead a goal, decides what work to authorize, and reviews the resulting tasks, artifacts, and evidence. A project can run a reusable workflow or use the classic task board. Code-producing attempts can work in isolated Git worktrees rather than editing the source checkout.

## Process and Module Map

| Boundary | Responsibility |
|---|---|
| Host entry points | `apps/factory-host/src/main.ts` loads configuration and starts the Host; `host.ts` wires modules; `cli/factory.ts` provides setup and diagnostics. The Host can serve the built UI. |
| API and identity | `api/` and `identity/` expose HTTP commands, read models, resumable project events, and browser sessions. The UI gets snapshots and reconnects to SSE using its event cursor. |
| Commands and storage | `commands/` validates and dispatches commands. `storage/` owns SQLite and migrations; `events/` owns the committed event log and outbox. |
| Work and coordination | `projects/`, `groups/`, `org/`, and `library/` define the workspace and its reusable content. `lead/`, `chat/`, `flow/`, `work/`, `dispatch/`, and `collab/` coordinate work and its execution. |
| Policy and results | `approvals/`, `policy/`, `effects/`, and `integration/` gate writes and external actions. `artifacts/`, `documents/`, `knowledge/`, `trace/`, and `insights/` keep results and evidence inspectable. |
| Shared package | `packages/factory-contracts` defines Zod wire schemas, Workflow v2 definitions, and a separate runtime adapter entry point. Build it before either app. |
| UI | `apps/factory-ui` is a React/Vite app. It reads Host APIs and sends commands with revisions; it is neither a scheduler nor a credential store. In development Vite proxies `/api` to the Host. |
| Runtimes | `runtimes/` implements fake, API-agent, OpenCode, and opt-in local CLI adapters. Dispatch leases attempts and tracks their outcomes independently of task state. |
| Sandbox and proxy | `sandbox/` builds constrained OpenCode execution on Linux with bubblewrap. `proxy/` exposes the allowed model API through a separate loopback service with attempt-scoped authorization; `models/` handles upstream calls. |
| MCP | `mcp/` exposes task-scoped tools over an attempt grant. `mcp-external/` handles configured external servers; policy and tool validation control access. MCP does not grant general access to the command API or database. |

## Governing Principles

- **Single write path:** feature state changes go through commands, including commands issued internally by the Host. A command ID makes retries idempotent, and expected revisions prevent stale updates. Domain writes, receipts, and their events commit together; event subscribers are notified after commit.
- **Models propose; code decides:** model output is untrusted. Deterministic schemas, scope and policy checks, and human approvals determine whether the Host applies a proposal.
- **Durable effects go through the effect executor:** external mutations use persisted effect intent and tracked outcomes. Keep network calls out of command transactions. A reported failure, timeout, or dropped connection is not proof that a remote mutation did not happen.
- **Reconcile unknown effects:** establish whether an external mutation succeeded or failed, record that outcome, and only then decide whether to retry. Do not retry an ambiguous mutation blindly.
- **Unknown cost is not zero:** record what is known about model calls and token use, and keep missing measurements distinct from a genuine zero. Do not treat missing usage as proof that work was free.
- **Secrets stay in the Host:** send IDs and redacted metadata to the UI and workflows, never saved secret values. Agents get scoped grants, not upstream API keys; the Host applies provider credentials only when contacting the configured service.

## Data Model

| Entity | Role |
|---|---|
| Projects and groups | Projects contain work and can be attached to a repository. Groups organize projects for navigation and shared settings where applicable. |
| Agents, teams, and relations | An agent has a profile, instructions, and runtime settings. Team membership and relations help resolve routing and review, not bypass policy. |
| Library | Stores reusable profiles, skills, team templates, and workflows imported from packs or maintained by the operator. Existing work can retain its pinned input. |
| Flows and runs | A flow has draft and published definitions. A run binds a definition and inputs; node state, outputs, waits, and timers are persisted separately. |
| Tasks and attempts | A task describes work and its criteria; an attempt is one leased execution of that work, with a runtime, status, and reported results. A workflow node may create tasks and wait on their results. |
| Approvals | Records decisions with scope, state, and audit context. Approval can gate workload, workflow progression, or an external action. |
| Artifacts and knowledge | Artifacts include versions of produced or uploaded files. Knowledge makes approved reference material available for retrieval within its scope. |
| Trace and insights | Trace connects runs, tasks, attempts, calls, and effects. Insights summarize activity and usage without replacing the underlying records. |
| Integrations and credentials | Integrations specify allowed operations and scope. They reference Host-held credentials by ID; workflow definitions do not store credential values. |

## Workflow v2

A definition is a validated node-and-edge graph. Edges connect a named source port to a destination node. The engine evaluates bounded expressions and templates against run context; it does not execute arbitrary expressions from the graph. Relevant node ports are:

| Node | Outputs and purpose |
|---|---|
| `trigger` | `out`: starts through manual, chat, schedule, webhook, event, or API entry points. |
| `agent` | `out`, `error`: creates agent work, optionally reviews it, and checks structured output when configured. |
| `action` | `out`, `error`: performs a declared operation, with policy and effect tracking for external writes. |
| `condition` | Named rule ports and `else`: selects a route. |
| `parallel` / `join` | `item`, `done` / `out`: fans out within a concurrency limit and combines results with all, any, or quorum policy. |
| `approval` | `approved`, `rejected`, `timeout`: records a decision and routes the outcome. |
| `loop` | `body`, `done`: repeats work within a bound. |
| `wait` | `out`: resumes on a persisted timer or event. |
| `subflow` | `out`, `error`: runs another workflow and waits for it. |
| `orchestrate` | `out`, `error`: delegates bounded work under a Lead and waits for the result. |
| `output` | No outgoing ports: collects results for an artifact, knowledge, or delivery. |

When work is waiting, the engine advances on task outcomes, approvals, events, and timers. Pausing stops advancement; resuming continues from persisted state. Automatic retries are bounded and use backoff when configured; manual retries check the node state and refuse to proceed while an earlier outcome is uncertain. On restart the Host recovers persisted runs and rechecks outstanding work instead of assuming an interrupted attempt succeeded or failed. Cancelled and terminal runs do not start new nodes.

Version 1 remains an **import format**: `flows.import-v1` calls `convertWorkflowV1` to build a v2 definition. The v2 engine does not require the old v1 editor.

## Lead Chat

The workflow-oriented path is **discuss -> decide -> brief -> run**. The operator and Lead clarify the goal and make any needed decisions. The Lead can propose a structured brief and a workflow action. The Host validates the proposal, checks the project, workflow, and inputs, then records the brief or starts work through commands. Chat text alone cannot write state or grant approval.

In **classic mode**, ordinary chat stays a discussion; explicit delegation can propose tasks for the task board. The Host checks those proposals and preserves the review and approval boundaries. Switching modes does not bypass permissions or rewrite existing work.

## Extensions

The Host loads extensions only when configured. `extensions/portal` is an optional example using library packs, workflows, and an HTTP integration. It is not part of the default project runtime and does not install or operate a Portal server. Enable it with `FACTORY_EXTENSIONS=portal`, configure credentials and approved operations in the Host, and use the normal flow and reconciliation paths. See the [Portal guide](../extensions/portal/README.md).

## Security Model

- The Host binds to loopback by default and checks Host and Origin headers. Explicit LAN binding requires a login token and disables open login. Restrict LAN access to a trusted network.
- The browser bootstraps a session using a one-time token by default on loopback. Mutating browser requests are subject to session and CSRF checks. Separate agent grants are scoped to an attempt and expire or are revoked when the attempt is no longer active.
- The OpenCode sandbox limits filesystem and network access. The model proxy checks attempt grants, approved models, and budgets before sending requests upstream. Opt-in local CLI adapters run with the operator's permissions and are **not** equivalent to the sandbox.
- Keep configuration and backups private. Set an explicit gateway URL and use a trusted TLS CA; put gateway keys and integration credentials only in the appropriate Host configuration or credential store.

See the [setup guide](setup/README.md) for installation and the [contributor guide](../CLAUDE.md) for build and test commands.
