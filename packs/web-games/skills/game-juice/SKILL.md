---
name: game-juice
description: Feedback animation (juice) for turn-based browser games - event tiers, CSS and Web Animations recipes, easing, input and reduced-motion rules, tests that effects return to rest. Read before adding motion or sound.
---

# Game juice for turn-based browser games

Juice is a feedback layer: several small, quick, slightly exaggerated responses fired together when something happens. It never changes game state. The client renders the authoritative view from the SDK; animation only shows the change between the previous view and the new one.

## Event tiers

Fire one bundle per event from a single `feedback(tier, element)` helper so the game stays proportional.

| Tier | Duration | Motion | Examples |
|---|---|---|---|
| small | 80-150 ms | scale to 1.05, lift 2 px, outline | hover, focus, select a piece or card |
| medium | 180-320 ms | pop with overshoot, slide, flip, glow on the next player | legal move placed, card played, card drawn, turn change |
| large | 400-900 ms | burst of 12-30 particles, winning line drawn, hand fanned, 2-4 px board shake under 250 ms | win, draw, special card (+4, reverse), capture |
| error | 200 ms | 4-6 px horizontal shake, red outline, short text | illegal move, not your turn |

Start with two channels per event (motion plus colour, or motion plus sound), then add only what makes the event clearer. Shake and particles are for large events only.

## Easing (CSS)

- Pop and land (overshoot): `cubic-bezier(.34, 1.56, .64, 1)`
- Settle (ease-out): `cubic-bezier(.22, 1, .36, 1)`
- Anticipation before a throw (ease-in): `cubic-bezier(.55, 0, 1, .45)`
- Never `linear` for movement; linear is only for spinners and progress.

## Recipes

- Animate only `transform` and `opacity`, never `top`, `left`, `width` or `height`.
- **Pop**: `el.animate([{ transform: "scale(.6)" }, { transform: "scale(1)" }], { duration: 220, easing: POP })`.
- **Move a card or piece between containers (FLIP)**: record the old rect, move the element in the DOM, measure the new rect, then animate `transform: translate(dx, dy)` back to `none`.
- **Flip a card**: rotate the Y axis to 90 degrees, swap the face, rotate back (two 120 ms halves).
- **Particles**: absolutely positioned small SVG or CSS shapes in an overlay above the board, removed on `finish`, at most 30 at once.
- **Retrigger safely**: before starting an effect on an element, cancel its running ones (`el.getAnimations().forEach(a => a.cancel())`). Every effect ends at the element's rest style; never leave a transform behind.

## Use `src/client/motion.ts`

New games get this helper file from the starter; older games create it from `skills/motion-source`. Import from `./motion.ts`; never write ad hoc animation code when a helper fits.

| Helper | Use it for |
|---|---|
| `pop(el)` | a piece placed, a card selected, a chip landing |
| `flyFrom(el, fromElOrRect)` | a card from hand to pile, a drawn card from the deck, chips to a betting square (render the new state, then fly the new element from the old place; keep rects with `snapshotRects` before re-rendering) |
| `flip(el, swap)` | turning a card face up (draw face down, then flip) |
| `rattle(cup)` then `rollDice(dice, faces, draw)` | dice and bowls: shake 0.6-1 s, tumble with random faces, settle on the real faces |
| `countdown(el, 3)` | a short visual "3, 2, 1" before a reveal (the rules have no clock; never auto-play a move) |
| `tickNumber(el, from, to)` | coins, points, totals |
| `enter(el)`, `pulse(el)` | result banner, whose turn it is, a winning line |
| `confetti(board)` | a win |
| `shake(el)` | an illegal move or not your turn (from `onError`) |
| `tone(freq)` | optional sound after a user gesture; muted when storage is unavailable |

### Pattern: animate the difference between two views
Keep the previous `room.view`; on each `onState`, render the new view, then compare: new pieces get `pop`, cards that left a hand get `flyFrom` the hand position to the pile, a changed dice value runs `rattle` + `rollDice` before the result text and payouts are shown (`tickNumber` after the dice settle). The first view after loading or reconnecting renders instantly. Bot and opponent moves use the same path, so players can follow them.

## Rules that keep it playable

- Never block input for more than 150 ms. The local player's next legal action is accepted during an animation; finish or skip the animation when it arrives.
- Opponent and bot moves animate too, so players can follow them (medium tier, with a short highlight of the last move).
- On first render, reconnect or a full view refresh, show the state instantly: animate only the difference between consecutive views, never replay history.
- `prefers-reduced-motion: reduce`: replace motion with instant changes plus colour, outline or text; no shake, no particles.
- No flashing more than three times per second; no full-screen flashes.
- Sound is optional: short tones generated with the Web Audio API (no audio files), started only after a user gesture, quiet, with a mute button saved in `localStorage`.

## Test it

- Unit-test the helper that decides which tier an event gets (view before, view after, tier).
- In the browser (when a browser tool is offered): after an action, `document.getAnimations().length` returns to 0 within 1.5 s and the moved element has no inline transform left; an illegal move shows the error feedback and leaves the state unchanged; with reduced motion emulated, no animation runs.

---
Adapted for browser turn-based games from `game-feel` (gamedev-skills/awesome-gamedev-agent-skills, Apache License 2.0; trauma shake after Squirrel Eiserloh, GDC 2016); rewritten for CSS and the Web Animations API. See `../LICENSE-APACHE-2.0.txt`.

The full source of `src/client/motion.ts` (for older games that lack it) is in `skills/motion-source`; only the Client Engineer needs it.
