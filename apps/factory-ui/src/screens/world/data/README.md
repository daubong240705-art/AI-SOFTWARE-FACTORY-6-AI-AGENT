> W-8 integration: these components are now mounted by `scene/WorldCanvas.tsx` and
> `scene/Studio.tsx`, with HTML controls and exclusive side panels in `WorldPage.tsx`.
> Locale text lives in `src/i18n/extra.{vi,en}.ts` under `worldUi`; `copy.ts` exposes
> typed lookups. The former per-folder `labels.ts` files have been removed.
> Workflow colours and debug registrations now live in `scene/workflow/support.ts`.
> The implementation/validation notes below describe the original component handoff.

World data integration

`useWorldData(store)` accepts the store's stateless read passthroughs;
`useWorldData()` uses the validated same-origin client (with `/api` in Vite development).
It returns `{model, events, sources, focusProjectId, setFocusProjectId, consumeEvents}`.
Call `consumeEvents()` after consuming the queue, or pass event IDs to acknowledge a subset.
`setFocusProjectId(null)` restores automatic focus. No project selection/store state is changed.
Draw only agents with `overflow === false`; the supplied pod capacities have 23 physical desks,
within the 24-agent drawing ceiling. Other real seats remain available in the model.

Files created here: `types.ts`, `classify.ts`, `assignDesks.ts`, `deriveWorld.ts`,
`events.ts`, `poller.ts`, `controller.ts`, `useWorldData.ts`, `officeSeat.ts`,
`deriveWorld.test.ts`, `check-world-data.mjs`, and this `README.md`.
Files changed elsewhere: `src/api/client.ts` (optional AbortSignals on existing reads)
and `src/state/store.ts` (five stateless read passthroughs).

Final exported shapes (full field definitions are in types.ts):

- `WorldInputs`: optional validated activity/teams/games/portal reads, project-keyed
  interactions/tasks/workflows/reports/releases, optional focusProjectId/serverNow.
- `WorldModel`: generatedAt, loaded source scopes, agents, hotProjects (at most 3),
  focusProjectId, tasks `{columns, overflow}`, stages, handoffs, bugs/bugOverflow,
  bugIds (uncapped identities), gallery, releaseVersions (uncapped latest done versions), portal.
- `WorldAgent`: seatId/teamId/name/role/isLead/slots/status/pose/podKey/slotIndex,
  runs/queued/needsYou/lastFinished/overflow. Runs, needs and last-finished reuse activity types.
- `TaskCard`: id/projectId/taskId/code/title/column (`todo|doing|review|failed|done`).
- `Handoff`: id/at/kind/from/to/code/text/projectId; endpoints are seat, owner or knowledge.
- `Bug`: id/projectId/criterion/evidence/state (`open|retesting`).
- `GalleryItem`: projectId/gameId/name/version/playUrl/state (`done|pending|failed`),
  current/enabled/playing/releaseId. Unknown version/URL/enabled/playing are nullable.
- `TableStage`: key/state/loopCount.
- `PortalModel`: configured, nullable onlineUsers, booths `{gameId,name,rooms,playing}`.
  No player identity data is retained.
- `Assignments`: seat ID to `{podKey,slotIndex,overflow}`.
- `WorldEvent`: discriminated by `type`: handoff, bugSpawned, bugDefeated, release, poseChanged.
- `WorldSource`: `{state:'ok'|'error'|'pending', at:number}`; at is local observation time in ms.
- `WorldSnapshot`: `{model,events,sources}`; `WorldData` adds focus controls and consumeEvents.

Verification

There is no UI test runner or check:tests script/tsconfig. The 18 tests use node:test,
strict assertions, synthetic fixtures, an injected clock and mocked validated reads.
The optional runner stays inside data/ because this task owns no scripts/ files.
It resolves Vite's extensionless imports and uses Node's TypeScript stripping without
emitting or compiling any new files. Run from apps/factory-ui using Node 22.23.4:

    node --experimental-strip-types src/screens/world/data/check-world-data.mjs

Command results (repeated successful invocations consolidated):

- `npm run check`: exit 0 finally; two intermediate exit-2 runs found and fixed type errors.
- `node --experimental-strip-types src/screens/world/data/check-world-data.mjs`: exit 0;
  18 tests pass. Earlier 14/15/17-test versions also exited 0.
- `npm run build`: exit 1. Vite's default config bundler writes into the shared read-only
  node_modules/.vite-temp; permission EROFS prevents the exact default command succeeding.
- `npm run build -- --configLoader runner`: exit 0; production build succeeds using the
  existing Vite runner loader, with no config/dependency edits or installations.
- `npm run check:bundle`: exit 0 after build; an initial pre-build run exited 1 (dist absent).
  Guard: entry/preload growth +1850 B (limit +3072 B), renderer 243680 B gzip
  (limit 307200 B), entry 3D isolation passes.
- `git diff --check`: exit 0.
- `git diff --exit-code -- apps/factory-ui/src/screens/office/ apps/factory-ui/src/screens/teams/`:
  exit 0, empty diff (from repository root).
- Diagnostic direct `node --experimental-strip-types src/screens/world/data/deriveWorld.test.ts`:
  exit 1; plain Node needs the runner's extensionless resolver.
- Accidental root-directory `npm run check`: exit 254 (no root package.json); rerun in UI passed.
- Accidental root-directory test-runner invocation: exit 1 (wrong relative path); rerun in UI passed.
- Inspection commands (`pwd`, `rg`, `cat`, `sed`, `head`, `ls`, `nl`, `git status`, `git diff`,
  Node version reads): containing shell calls exit 0; one rg in the UI cwd reported a wrong
  repository-relative path before tsc exited 2. Subsequent correct-path read succeeded.
- Scoped edit commands (`mkdir -p`, Python heredocs, cat heredocs and the TypeScript
  printer used to format source): exit 0. No dependency install, commit, push or git config command.

Not verified: browser rendering (prohibited), live Host responses (no network), and exact
unmodified default build success under the read-only shared dependency layout.
WorldPage/WorldCanvas/toolbar/debug hook/layout/i18n were not edited or wired here;
this is the data-only handoff to the scene task.
