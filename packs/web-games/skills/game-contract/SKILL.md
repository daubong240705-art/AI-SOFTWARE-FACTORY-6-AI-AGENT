---
name: game-contract
description: Build deterministic turn-based game bundles with the Game Portal starter and SDK.
version: 0.1.0
source: Game Portal ARCHITECTURE.md, starter/turn-based/README.md, SDK v1 and starter scripts (read-only).
---

# Game contract

Copy `~/GitHub/game-portal/starter/turn-based` into the assigned worktree. Never edit the starter or Portal repository. Read README first. Every request uses `game-build`.

## Starter layout

```text
game.json                 manifest and preview metadata
src/types.ts              shared State and Action types
src/rules.ts              pure RulesModule exports
src/client/index.html     iframe entry
src/client/main.ts        SDK rendering and input
src/client/theme.css      responsive theme
assets/                   local SVG assets, including thumb.svg
tests/rules.test.ts        rules tests
tests/bundle.test.ts       published bundle tests
sdk/                      types.ts, game-sdk.ts, host-bridge.ts, room-core.ts
dev/                      server.ts, host.html, host.ts (local host only)
scripts/                  build.mjs, play.mjs
factory.preview.json      Host preview command and PORT contract
package.json              check, test, build and play commands
```

Preserve SDK, room server and build scripts. Use Node 22.20+, erasable TypeScript (no enums, namespaces or parameter properties) and `.ts` extensions for relative source imports.

## game.json

- `id`: `^[a-z0-9][a-z0-9-]{1,39}$`; `name`: 1–60 characters; `description`: at most 300.
- `category`: board, card, puzzle, party or other; integer `minPlayers` and `maxPlayers`: 1–8, min <= max.
- `bot`: boolean; `sdk`: 1; `entry`: `index.html`; `rules`: `rules.js`; `thumbnail`: `thumb.svg` for this pack.
- All entry, rules and thumbnail paths are relative, without `..`, backslashes or absolute paths. Keep metadata consistent with the spec.
- `assets/thumb.svg` becomes `dist/thumb.svg`: the build copies the contents of assets directly into dist.

## RulesModule (named ESM exports)

```ts
setup({players, seed}): State
currentPlayer(state): number // seat index; -1 when finished
move(state, player, action): {state: State} | {error: string}
result(state): null | {winners: number[], draw?: boolean}
view?(state, seat): View // omit only when all state is public
bot?(state, seat): Action // required when manifest bot is true
```

State, actions and views are plain JSON only. Use `{winners: [], draw: true}` for a draw. Validate every move, including player, turn, target and finished status; illegal moves return an error without changing state. Do not mutate inputs. Hide private hands/decks through `view` where needed.

All functions are pure and deterministic for the same arguments: no I/O, network, filesystem, clocks, `Date`, timers or `Math.random`. Derive randomness from setup's server seed, keep RNG state in JSON state and advance it only in state transitions. The server owns dice, decks and results. Bots return legal actions on their turn; the Portal smoke test rejects matches exceeding 500 moves, illegal bot moves, throws or timeouts (1000 ms per call).

## SDK client

Import `connectGame` from `sdk/game-sdk.ts` relatively. Call once; `onState(callback)` supplies rooms, `onError(callback)` supplies errors; both return unsubscribe callbacks. Send `move(action)` and `rematch()`; `latest()` reads the last room or null. The SDK handles the postMessage ready handshake.

Render room `code`, `status`, `you`, `turn`, `seats` (name, bot, connected), `view` and `result`. The seat-specific view is authoritative. Never compute rules client-side or open WebSocket/fetch directly: the host owns networking, membership, rematch and reconnection.

## Build, preview and publication

- `npm install` is the clean dependency setup when the environment permits it; never install on preview startup. If unavailable, report the clean-install criterion failed/unverified.
- `npm run check` type-checks source, SDK, preview and tests; `npm test` tests rules and bundle; `npm run build` creates `dist/` and separate `.dev/`.
- `npm run play` builds and serves the preview (default http://127.0.0.1:8788/); Host-selected `PORT` overrides the default. Keep `factory.preview.json` working; never change port logic.
- `dist/` must contain game.json, index.html, main.js, theme.css, self-contained ESM rules.js and every referenced local asset. HTML loads `./main.js` and `./theme.css` relatively.
- Publish only dist contents, with game.json at the gzip archive root. Exclude source maps, `.dev/`, dependency folders, source and test files. No binary assets, external fonts, images, CDN imports or other outbound requests in games.
- Publish to the separate Game Portal using the Host's offered publishing tool. Never print or write credentials. If unavailable, report BLOCKED with the missing tool's name. The Portal assigns immutable integer versions; report gameId, version and playPath only after observed publication.

Use original names, art and rules; public-domain classics and standard decks are allowed. No gambling or betting. Respect ownership; never commit/push/change git configuration. Report commands and exit codes; unchecked claims are unverified.
