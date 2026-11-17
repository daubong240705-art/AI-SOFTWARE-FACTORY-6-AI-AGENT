> W-8 integration: these components are now mounted by `scene/WorldCanvas.tsx` and
> `scene/Studio.tsx`, with HTML controls and exclusive side panels in `WorldPage.tsx`.
> Locale text lives in `src/i18n/extra.{vi,en}.ts` under `worldUi`; `copy.ts` exposes
> typed lookups. The former per-folder `labels.ts` files have been removed.
> Workflow colours and debug registrations now live in `scene/workflow/support.ts`.
> The implementation/validation notes below describe the original component handoff.

# QA lab

Mount both scene children inside the existing Canvas/Ticker, alongside Environment:

```tsx
import { TestingLab } from './lab/TestingLab';
import { BugMonsters, labStats } from './lab/BugMonsters';

<TestingLab games={model.hotProjects} reports={reports} quality={quality}
  still={still} locale={locale} />
<BugMonsters bugs={model.bugs} bugOverflow={model.bugOverflow}
  events={events} games={model.hotProjects} scopeKey={scopeKey}
  quality={quality} still={still} locale={locale}
  onSelectBug={setSelectedBug} onHoverBug={setHoveredBug} />
```

`reports` is the validated `WorldInputs.reports` slice. **WorldModel currently omits
QA rounds**, so the integrator must retain/pass this slice; bug counts cannot reconstruct
QA verdicts or criterion counts. No adapter, store, canvas or page file was edited here.
Only the highest iteration per hot game is shown (up to three, also at low quality).
Missing rounds show “Chưa có lượt kiểm thử”, with no invented counts. The scanner follows
the first hot game with a round; optional `scannerProjectId` selects a specific hot game.
Its strips cover the existing decorative strips at the zone D anchor and go dark without QA.

The existing bench, screen and fence remain Environment's furniture. Monsters use the
existing `pen.rect`, twelve persistent separated slots, game/project hash colours,
and two body/face cohorts sharing toon materials. Low quality reduces geometry and puffs,
without hiding real bugs. The overflow sign includes the adapter's `bugOverflow`.
All text uses canvas textures and “Inter Variable”; no images or external resources are fetched.

The first event queue establishes a baseline and never animates. Later `bugSpawned` events
hop from the bench screen; `bugDefeated` events create puffs/sparkles at the last position.
Pass the diffWorld queue, acknowledge it after consumers observe it, and keep this component
mounted across polls. Change `scopeKey` for a new data scope. Ticker owns all scheduling:
ambient wandering and running-scanner glow, live finite effects, and no requests in still
mode. Entering still mode completes effects; resuming cannot replay them.

`labStats()` returns a fresh `{ bugs, retesting, defeated }` snapshot for the debug getter.
`bugs` includes supplied overflow; `retesting` counts supplied Bug records (overflow has
no state information); `defeated` counts unique post-baseline defeat events per mounted scope.
Counts reset on scope change/unmount. Nothing writes to the debug window automatically.

Mount `BugPanel` from `../../panels/BugPanel` outside Canvas, passing `bug`, `gameName`,
`onOpenProject(projectId)` and optionally `onClose`/`locale`. Rendered criterion, evidence
and game name are escaped React text nodes; markup remains literal. Hover also shows an
in-scene name/state/criterion preview and calls `onHoverBug(Bug | null)`.
The HTML panel imports only the three-free `labels.ts` module from this folder.
Move the exported vi/en strings into i18n during integration.

Validation: `npm run check`, `npm run build -- --configLoader runner`, and
`npm run check:bundle` all exited 0. Earlier draft checks exited 2 and were fixed.
Inline offline Node checks exited 0 for latest/missing QA, counts, deterministic pen
bounds and separation (minimum sampled distance 0.835), baseline/dedup/still events,
shared instancing/resource disposal, vi/en keys and literal panel text. An initial
verifier exited 1 because it incorrectly treated the root Group as an InstancedMesh;
the corrected verifier passed. An in-memory Vite integration probe exited 0 with both
lab components included: renderer 258380 B gzip, below 307200 B, with no entry 3D leakage.
The normal bundle guard passed at 254314 B gzip before wiring. `git diff --check` and
the scoped office/teams/generated-token/font diff check exited 0. Browser/WebGL rendering,
pointer interaction in a browser, live Host data, and plain default-loader build were
not verified. A browser cannot be opened for this task; the runner build avoids the
known read-only default Vite cache path.
