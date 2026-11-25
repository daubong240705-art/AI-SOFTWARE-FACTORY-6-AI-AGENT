---
name: turn-based-rules-contract
description: Implement deterministic rules, seat views and legal bots that satisfy the turn-based starter's five-line contract.
---

# Five-line rules contract

1. `setup({players, seed})` returns a plain JSON initial state.
2. `currentPlayer(state)` returns the zero-based active seat, or `-1` after the game ends.
3. `move(state, player, action)` returns `{state}` on success or `{error}` on rejection.
4. `result(state)` returns `null`, `{winners: [seats]}`, or `{winners: [], draw: true}`.
5. `view(state, seat)` is optional for fully public games; hide all private data otherwise. `bot(state, seat)` is required when `game.json` enables bots and returns a legal action on the bot's turn.

Use named exports in `src/rules.ts`, types in `src/types.ts`, erasable TypeScript and `.ts` in relative source imports. Treat every action as unknown input. Reject bad seat/turn, malformed action, illegal target and all post-game moves without mutation or RNG advance. Derive RNG from `seed`, store it in state, and advance it only in accepted transitions. No clocks, I/O, `Math.random`, mutable globals or client-provided random results. Make bot choice deterministic with a stable tie-breaker or a read-only peek at seeded state; prefer a sensible move over blind random choice. Ensure games finish within a documented move cap. Bots must not exploit hidden information unavailable to their seat.

In `tests/`, deep-freeze or snapshot inputs and assert rejected moves leave them unchanged. Replay the same seed and actions from a JSON round trip; get identical states, views and results. Cover player limits, win/draw, wrong turn, malformed input, privacy and seeded bots for each supported seat count. Fail capped games separately from genuine draws. Run `npm run check`, `npm test` and `npm run build`.
