> W-8 integration: these components are now mounted by `scene/WorldCanvas.tsx` and
> `scene/Studio.tsx`, with HTML controls and exclusive side panels in `WorldPage.tsx`.
> Locale text lives in `src/i18n/extra.{vi,en}.ts` under `worldUi`; `copy.ts` exposes
> typed lookups. The former per-folder `labels.ts` files have been removed.
> Workflow colours and debug registrations now live in `scene/workflow/support.ts`.
> The implementation/validation notes below describe the original component handoff.

# Mochi characters (W-3)

W-9: `features.ts` supplies the paired eye/cheek/ear anchors actually used by the
builder, with eye depth projected onto the curved face. The raccoon band and BA
frames follow that same surface. The verifier audits all nine specs and seven
poses, including ear attachment and above-right effect clearance. Portal Manager
uses the shared name-aware PM rule before `isLead`; game leads keep LEAD.

Only this directory and `scene/Lineup.tsx` are owned by W-3. No toolbar, camera, preferences,
layout, debug, office, teams, or locale files were changed. The existing exported `artCode`
and `seatHash` preserve the unknown-seat fallback. Portal Manager resolves to PM before
`isLead` selects LEAD. Palettes come from the idle SVGs; TEST's tiny beak is dark in that art.

## Integration

Import the barrel **only from the lazy world scene** (it imports three/R3F as values).
`spec.ts`, `specs.ts`, `poses.ts`, and `labels.ts` have no three/R3F value imports.

```tsx
import { CharacterAnimator, CharacterRig, specForSeat, phaseForSeat, characterStats } from '../characters';
import { Lineup, lineupDimensions } from './Lineup';

// Inside Ticker; pass its effective quality and still preference.
<CharacterAnimator still={still}>
  {lineup ? <Lineup origin={[x, z]} quality={quality} still={still} locale={locale} /> :
    seats.map(seat => <CharacterRig key={seat.id} spec={specForSeat(seat.name, seat.isLead)}
      pose={seat.pose} position={seat.position} yaw={Math.PI / 4}
      phase={phaseForSeat(seat.id)} quality={quality} />)}
</CharacterAnimator>
```

`Lineup` also works alone inside Ticker and mounts its own animator. Nested
`CharacterAnimator` components reuse their ancestor. Mount just one animator per Canvas;
`useCharacterAnimator({ still })` is the lower-level alternative to the component, and
must not be mounted alongside a separate standalone Lineup animator. Rigs register with
the Canvas registry and have **no** per-character frame callback. Hidden parents and the
rig's optional `visible` prop suspend ambient demand when every character is hidden.
Pose prop changes interpolate the current transform to the next pose over 0.3 seconds.
All transforms are sampled from elapsed time; still mode applies a fixed representative
pose without scheduling frames. Effects and laptop screens use one canvas atlas; effects
are actual `THREE.Sprite` billboards. Atlas font completion invalidates once.

When `preferences.lineup` is true, the integrator mounts Lineup, focuses CameraRig on
`[origin[0], lineupDimensions.targetHeight, origin[1]]`, and fits an 18 × 15 local floor,
rotated π/4 around Y. The toolbar button and debug snapshot wiring belong to the integrator.
The grid's code order matches the original skin, with all seven pose rows. Code labels
sit under the columns; row labels are at the left. Pass the active locale (`vi` by default).
Every pose label has both `vi` and `en` entries in `labels.ts`, ready to move into i18n.

Add `characters: characterStats()` to the existing debug snapshot. `built` counts cached
code geometries (0–9), not seats or poses. `drawCallsPerCharacter` is the conservative
high-quality maximum (6: rigid mesh, eye mesh, hull, laptop text, two sparkle sprites).
Low quality omits the hull and second sparkle, for at most 4 draws. Four materials and
two textures (3-step DataTexture and canvas atlas) are shared across the entire character
set, lineup labels and floor. World floor/lighting materials outside Lineup are separate.
Resources are released after the last rig/label unmounts, with a deferred cleanup that
survives StrictMode effect replay. Direct non-React builder users can explicitly call
`disposeCharacterCache()` after removing all groups.

For later walking, `hopAlong(path, speed)` returns `{ duration, sample(elapsed) }`.
Speed is world units/second. `sample()` returns `{ position, yaw, squash, done }` and clamps
to the destination. Structural waypoint inputs accept `[x,z]`, `[x,y,z]`, or `{x,z,y?}`,
so layout/waypoints paths can be supplied without a dependency on the integrator's files.
Put the sampled world position/yaw on the rig's outer group; the animator owns only the
inner character transform. Reserved `spec.model` is intentionally ignored.

## Offline validation

From `apps/factory-ui`, with the pinned Node 22.23.4 on PATH:

- `npm run check`
- `npm run build -- --configLoader runner`
- `npm run check:bundle`
- `node src/screens/world/characters/verify.mjs`
- `node src/screens/world/characters/verify-bundle.mjs`

The runner option avoids Vite's attempted write into the preinstalled read-only
`node_modules/.vite-temp` symlink. Plain `npm run build` cannot complete in this checkout
for that filesystem reason. The CPU verifier checks every code × pose at both qualities,
merged geometry, draw budgets, shared materials, seat mapping, locale coverage, deterministic
motion, hop endpoints and resource cleanup. It stubs only the canvas drawing context;
it does not validate WebGL rendering or visual fidelity. Lineup is not wired into WorldCanvas
in this scope, so the normal build's renderer chunk does not yet include these new modules.
The additional in-memory build temporarily injects Lineup into the W-1 scene for bundling
without editing WorldCanvas or writing another build. It measures 251,029 B gzip including
Lineup, below 307,200 B, and checks that three/R3F remains outside the entry. The normal
bundle guard reports 243,680 B gzip. Browser screenshots still need integrator verification.
