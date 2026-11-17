> W-8 integration: these components are now mounted by `scene/WorldCanvas.tsx` and
> `scene/Studio.tsx`, with HTML controls and exclusive side panels in `WorldPage.tsx`.
> Locale text lives in `src/i18n/extra.{vi,en}.ts` under `worldUi`; `copy.ts` exposes
> typed lookups. The former per-folder `labels.ts` files have been removed.
> Workflow colours and debug registrations now live in `scene/workflow/support.ts`.
> The implementation/validation notes below describe the original component handoff.

# Release gallery (W-7)

Mount `Gallery` inside the existing Canvas/Ticker, alongside `Environment`:

```tsx
import { Gallery, galleryStats } from './gallery/Gallery';

<Gallery items={model.gallery} events={events} quality={quality} still={still}
  locale={locale} onSelectRelease={setSelectedRelease}
  onCelebrate={announceAndHop} />
```

All props are plain model slices, events, callbacks and preferences. `items` keeps
`deriveWorld`'s newest-first order: `GalleryItem` has no timestamp to re-sort by.
The first nine entries overlay the nine existing `displayFrames`; the first also
covers the existing arcade screen at `anchors.arcade`. Newer pending/failed entries
add scaffolding/red ribbons to older versions of the same project. All clickable
surfaces return their real item. Stars identify `current`, half-drawn folded
curtains identify `enabled === false`, and player plaques require `playing > 0`.

Pass the current event queue from `useWorldData`, then acknowledge it with the
existing `consumeEvents` integration. `Celebration` is mounted by `Gallery` and can
also be used independently with `{frames: [{item, position: [x,y,z], yaw}], events,
quality, still, locale, onCelebrate}`. Do not mount both for the same releases.
It establishes its own first-mount baseline, ignoring existing queued events and
release identities already displayed; later events are deduplicated by release.
An event without its matching displayed model entry waits for a subsequent render.
The callback runs once per new visible completed release. Confetti uses one
InstancedMesh per burst, 200 pieces/high or 60/low, and samples absolute elapsed
performance time for three seconds. Only bursts request Ticker live motion.
The ribbon expires after 60 seconds using a timeout; still mode never starts or
resumes a burst, while retaining the ribbon and callback. Remount with a new `key`
on world/session scope reset. Optional `baselineReady={false}` suppresses effects
while establishing another baseline. Keep Gallery mounted across ordinary updates.

Add `gallery: galleryStats()` to the integrator's debug getter. It returns mounted
populated `frames`, active ribbon count `celebrating`, and cumulative `celebrated`
callbacks during this JS session. Unmount removes active counts. All GPU/image/
timer/motion resources clean up, including StrictMode effect replay.

`thumbnailUrl(projectId, releaseId, baseUrl?)` returns a same-origin URL or null.
The API client's normalized base is private, so this helper matches its trailing
slash normalization and the store/world `/api` development default, with a typed
optional base override. No client.ts/store change is needed. Only same-origin
HTTP(S) image URLs can load. Real SVG/PNG/WebP thumbnails load through an `<img>`
and are drawn into a canvas atlas. Generated game-name/controller covers appear
immediately, and remain on 404/error. Nameplates, covers and plaques share one
2048px atlas; scaffold/curtain/star materials share a three-step toon gradient.
Font completion redraws the atlas with `Inter Variable` and invalidates demand
rendering. No drei, blob images, external fonts or server-text HTML injection.

Mount `panels/ReleasePanel.tsx` in the HTML overlay/DockedPane. Props are
`{ item, locale?, releaseDate?, baseUrl?, onOpenProject? }`. Pass the selected
release's `completedAt`/`createdAt`; the GalleryItem slice has no release date.
`model.releaseVersions[projectId].at` is suitable only when its releaseId matches.
Missing dates/statuses remain unknown (—). The panel shows enabled and current
status independently, live players only when positive, a thumbnail/fallback,
a disabled Play button without a playUrl, and a real project-office link by
default. `onOpenProject(item)` can override navigation. Play uses the required
`window.open(url, '_blank', 'noopener,noreferrer')`. This module, `labels.ts` and
`thumbnailUrl.ts` have no three/R3F value imports. Labels are exported in vi/en
for the integrator to move into i18n. WorldCanvas/Page/toolbar/debug/i18n were
intentionally left unwired under the task's parallel-work constraint.

Validation (run from apps/factory-ui unless noted):

- `npm run check --prefix apps/factory-ui` (repository root): exit 0.
- `npm run check`: exit 0 (repeated after final implementation).
- `npm_config_ignore_scripts=true npm run build -- --configLoader runner`: exit 1;
  skipping prebuild left ignored generated tokens.css absent. No source issue.
- `npm run check:bundle` before a successful build: exit 1, dist/index.html absent.
- `npm run build -- --configLoader runner`: exit 0, including the existing token/
  font prebuild generation. These are ignored build prerequisites, not source edits.
- `npm run check:bundle` after build: exit 0. Entry/preload growth +2010 B,
  lazy renderer 254314 B gzip, entry 3D isolation passes at the time of this run.
- `node --input-type=module` with an in-memory TypeScript/React hook harness:
  exit 0. Checks URL encoding and remote/protocol rejection; deterministic cover
  palette; image cancellation; real frame state/arcade geometry; 60/200-instance
  deterministic elapsed-time motion; baseline/repeated-event suppression;
  still mode; 3s/60s expiration; panel HTML escaping/date/disabled Play behavior.
  The harness stubs canvas and React effects; it is not a visual/WebGL test.
- Repository inspection commands (`pwd`, `rg`, `cat`, `sed`, `find`, `head`,
  `git status`, `git ls-files`, `git diff --check`): shell invocations exit 0.
  One inspection included a missing optional AgentPanel.tsx read; another rg
  reported absent pre-build dist. Subsequent commands in those shells exited 0.
- `mkdir -p`/`cat` source creation shell: exit 0. Python scoped edits: exit 0,
  after an initial wrong-cwd attempt printed FileNotFoundError (Python exit 1;
  its shell continued to the passing `npm run check` and exited 0).

Browser opening is unavailable. Browser/WebGL appearance, integrated pointer/
accessibility flows, and live Host thumbnail responses were not verified. Plain
`npm run build` was not run; its default loader may hit the documented read-only
Vite cache. The standard build does not yet mount these components, so its bundle
numbers describe the current integration, not an end-to-end gallery rendering.
No installs, network calls, commits, pushes or git configuration changes.
