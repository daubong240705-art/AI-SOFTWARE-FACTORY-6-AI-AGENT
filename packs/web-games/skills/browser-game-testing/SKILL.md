---
name: browser-game-testing
description: Verify DOM turn-based games with Playwright MCP, independent multiplayer contexts, console checks and screenshot evidence.
version: 0.1.0
source: Adapted from Factory game-studio browser-game-testing 0.1.0; Game Portal starter and SDK v1 contracts.
---

# Browser game testing

Read the spec's numbered test cases, task acceptance and game-contract first. Use only tools the Host offers. If a required tool is absent, report BLOCKED with its name and label its checks unverified.

## Preview and viewports

- Preserve the starter's `factory.preview.json` and `npm run play`. Start on the Host-selected free PORT and read the ready URL; follow local-preview for cleanup.
- Test with Playwright MCP at exactly 1280x800 and 390x844. If resizing or isolated contexts are not exposed by MCP, use Playwright Test through an offered command tool; do not invent MCP tools.
- Use offered `browser_navigate`, `browser_resize`, `browser_snapshot`, `browser_evaluate`, `browser_console_messages` and `browser_take_screenshot` equivalents. Inspect the game iframe as well as the host lobby.
- Assert rendered DOM: accessible roles, cell/card labels, turn text, your seat, opponent connection status, results, errors and rematch controls. Drive keyboard and pointer input through real controls.
- Read visible board/card state and compare it with the SDK room view when exposed. Do not require a canvas hook or reveal hidden cards through a test hook. Do not change game code to enable a check.
- Wait for a named rendered state or locator assertion; avoid fixed sleeps. Play a full match at both sizes and capture start, decisive move, result and rematch.

## Gameplay and invalid input

- Play one human-versus-human win and one draw or loss according to the spec. Verify turn progression, terminal state and rematch. Record action sequences.
- Run bot-versus-bot simulation across 50 deterministic seeds; assert every move is legal and each match terminates. Record seed range, test name and exit code; report inapplicable bot support explicitly without inventing a pass.
- Check wrong turn, invalid or occupied target, and moves after completion. Verify server rejection and unchanged state, including input sent past disabled UI via an offered test harness.
- In reproduce, put the regression under `tests/regression/`, run it on the current code and quote the actual failing output. Keep game source unchanged.

## Multiplayer, reload and reconnect

- Use two independent browser contexts (`browser.newContext()` in Playwright Test), each with its own identity, against one preview server. Two tabs sharing one session are insufficient.
- Create a room in context A; join its code from B. After every move compare board, turn, result and seat identity in both rendered views; compare public fields only for hidden-information games.
- Reload one context and assert the same room code and same seat return with the current state. Disconnect one opponent, verify the disconnected indicator, reconnect and verify state convergence without a duplicate seat.
- Play through completion and rematch. For a game without multiplayer, use the acceptance's explicit n/a with the reason; never silently skip it.

## Evidence and cleanup

- Collect browser console messages and page errors across navigation and a full match; unexpected errors fail the preview criterion. Use offered DevTools for console/network details when needed.
- Save screenshots and logs under `.factory/playwright/` with viewport and named state in each filename. Cite relative paths; include failure reproduction steps and observed state.
- Close both contexts and stop preview processes, verifying the port is released.
- QA calls `criterion.report` once per criterion using its exact text, passed boolean and one evidence sentence. A criterion not run is failed and labelled unverified. Record commands with exit codes, test names and screenshot paths; never claim an unrun check passed.
