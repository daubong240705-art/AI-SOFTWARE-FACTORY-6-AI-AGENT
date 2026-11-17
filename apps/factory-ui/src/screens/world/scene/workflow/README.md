> W-8 integration: these components are now mounted by `scene/WorldCanvas.tsx` and
> `scene/Studio.tsx`, with HTML controls and exclusive side panels in `WorldPage.tsx`.
> Locale text lives in `src/i18n/extra.{vi,en}.ts` under `worldUi`; `copy.ts` exposes
> typed lookups. The former per-folder `labels.ts` files have been removed.
> Workflow colours and debug registrations now live in `scene/workflow/support.ts`.
> The implementation/validation notes below describe the original component handoff.

# Workflow integration

Mount `TaskBoard`, `Handoffs`, and `CollabTable` inside the existing Canvas/Ticker.
No existing canvas, toolbar, layout, debug, or locale files were edited.

```tsx
// Inside the lazy scene, under Ticker. Keep props/arrays stable between updates.
<TaskBoard projectId={model.focusProjectId} columns={model.tasks.columns}
  overflow={model.tasks.overflow} quality={quality} still={still} locale={locale}
  onOpenTask={onOpenTask} onHover={onHoverTask} />
<Handoffs events={events} positionOf={positionOf} quality={quality} still={still}
  senderIdle={senderIdle} courier={courier} onTablePass={recordTableArrival} />
<CollabTable stages={model.stages} handoffs={tableArrivals}
  quality={quality} still={still} locale={locale} />
```

- `TaskBoard` uses the north-wall `anchors.taskBoard`, covers the environment's
  decorative stickies, and shows three cards per column. Overflow adds supplied
  data-layer overflow to hidden supplied cards. Initial state and project changes
  display instantly; subsequent column changes lift/slide/settle in 420ms (360ms
  at low quality). Click opens `(projectId, taskId)`; hover provides task identity,
  code, and title or `null`. Faces use a canvas atlas with two title lines and ellipsis.
- `Handoffs` accepts **only diffWorld events**, never `model.handoffs`. The batch
  present at mount is acknowledged as baseline, so mount before enabling polling
  events. Ack `consumeEvents()` in the integrator after all consumers see each batch.
  `positionOf(endpoint)` returns `[x,z]` (desk height 1.1), `[x,y,z]`, or `null`
  for an unavailable desk. Knowledge falls back to `anchors.bookshelf`.
  Events older than 90s, invalid/future dates, and events seen in still mode do not
  fly. Three envelopes fly concurrently; ten more queue; additional flights drop.
  Seat-to-seat routes take 700ms to the table, pause 400ms, then take 700ms to the
  receiver; owner/knowledge routes take 1100ms. Finished/failed pop over the sending
  seat (or receiving seat if sender is not a seat) for 2s. Courier runs on flight
  launch only when `senderIdle(seatId)` explicitly confirms idle/done.
- `onTablePass({handoff, passedAt})` reports an actual table arrival once, with
  `passedAt` as local epoch milliseconds. Keep these arrivals in plain React state,
  pruning entries older than 120s, and pass them to `CollabTable.handoffs`. Do not
  seed arrivals with interaction history. The table deduplicates and displays up to
  ten recent seat-to-seat cards, fading until 120s. Stage pucks use `meetingTable`,
  and only active stages pulse. `loopCount > 0` displays `vòng N` / `loop N`.
- All components take `quality` and `still`. Still mode displays current tasks and
  stages immediately, schedules no frames, and suppresses transient handoff replay.
  Table cards in still mode use their current age without a continuing fade loop.
  Animations sample elapsed time and use `useWorldMotion().request(...)`; cleanup
  releases requests and all textures/geometries/materials. Workflow solids share
  one reference-counted toon material with the environment's three-step style.
- `workflowStats()` from `labels.ts` (also re-exported by `TaskBoard.tsx`) returns
  `{cards, handoffsActive, handoffsSeen, stages}` across mounted instances. `cards`
  includes data-layer overflow; `handoffsSeen` counts the initial handoff baseline
  and subsequent eligible events, including events dropped due to the flight cap.
  Entries disappear on unmount. Import the three-free `labels.ts` from debug code.

Mount `FocusGamePicker` from `../../panels/FocusGamePicker` **outside Canvas**.
It is three-free HTML with `games: {projectId,name}[]`, `focusProjectId`,
`onFocusGame(projectId)`, `locale`, and optional `className`. Pass the actual focused
game id and position its header over the board through the integrator's HTML overlay
layer. Use `anchors.taskBoard` and height 2.25 for projection. Buttons have localized
accessible names; the game name uses plain text and an aria-live region.

`workflowLabels` has vi/en copy for transfer to i18n. Text uses local canvas textures
and `Inter Variable`; no images, blob URLs, drei, network access, or new dependencies.
Only scene modules import three/R3F as values.

Browser access is unavailable; appearance, pointer hit targets, camera projection,
and live Host integration require integrator verification. Normal production build
does not include these components until the integrator mounts them; an additional
in-memory bundle probe can include all exports without editing WorldCanvas.

## Offline verification

Commands ran from `apps/factory-ui` with the pinned Node 22.23.4 for final checks.
Repeated invocations are consolidated below, including unsuccessful attempts.

| Command | Exit code(s) / result |
| --- | --- |
| `npm run check` | 2 × 3 while fixing initial imports, then 0 × 3 |
| `npm_config_ignore_scripts=true npm run build -- --configLoader runner` | 1: generated `tokens.css` absent when prebuild was skipped |
| `npm run build -- --configLoader runner` | 0, including the normal tokens prebuild |
| `npm run check:bundle` | 0: renderer 254,314 B gzip, entry growth +2,015 B, isolation passes |
| `node --input-type=module` with the inline CPU harness | 1 for an exact floating-point endpoint assertion, then 0 after clamping endpoints exactly |
| `node --input-type=module` with the inline Vite bundle probe (`write:false`) | 0: workflow-inclusive renderer 259,667 B gzip, entry isolation passes |
| `git diff --exit-code`; `git diff --check`; `git status --short` | 0 each; no tracked file edits |
| Read-only `ls`, `rg`, `cat`, `sed`, `find`, and `node --version` inspection calls | 0 overall except two read batches exiting 1 (no AGENTS match; absent `tsconfig.app.json`); missing-path diagnostics were corrected |
| Scoped `mkdir -p`, `python3` heredocs, `cat` heredocs, and patch edits | 0; two attempted root-relative writes from the UI cwd failed before writing, then were rerun with the correct cwd |

The CPU harness uses real Three geometry with mocked canvas, React hooks, and Ticker
demand. It checks instant baseline, task transition completion, arc endpoints, the
400ms dwell, 3+10 flight cap, arrival callbacks, badge expiry, still mode, ambient
demand, shared toon resources, and cleanup. It does not verify GPU rendering.
The in-memory bundle probe retains the workflow exports without touching the
integrator's files. Normal build outputs and generated token/font assets are ignored
build artifacts. No install, commit, push, or git configuration command was run.
Plain `npm run build` was not attempted; its default Vite loader may hit this
checkout's read-only dependency cache. Browser and live Host checks were unavailable.
