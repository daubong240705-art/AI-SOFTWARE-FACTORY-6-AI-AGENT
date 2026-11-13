---
name: browser-game-testing
description: Test a WebGL browser game with Playwright MCP, Chrome DevTools MCP and Playwright Test: test hook, keyboard and canvas input, console and screenshots, multi-player contexts, GPU-backed performance numbers.
version: 0.1.0
source: microsoft/playwright-mcp README and --help (v0.0.85); ChromeDevTools/chrome-devtools-mcp --help (v1.13.0); Factory POC 0 runs (2026-11): headless WebGL, SwiftShader vs GPU flags, Claude/Codex MCP permissions.
---

# Browser game testing

## The test hook

Canvas games have no DOM to inspect, so assert through `window.__game` (dev and test builds only). It exposes `state`, `frames`, `players`, `seed` and `tick`. Assert facts, not pixels: the player's state is `knocked`, the frame count is increasing, the score is 1. A deterministic seed makes runs repeatable. If the hook is missing, report it as a blocker for the Gameplay Engineer.

## Exploring with Playwright MCP (when the Host offers it)

Useful tools:
- `browser_navigate` to open the dev server URL;
- `browser_press_key` for keyboard input;
- `browser_evaluate` to read the hook;
- `browser_console_messages` for errors;
- `browser_take_screenshot` for evidence;
- `browser_snapshot` for DOM UI such as menus and HUD;
- with the vision capability, `browser_mouse_click_xy` to click on canvas coordinates.

Screenshots and logs go to the server's output directory (`.factory/playwright`). Cite their paths.

Exploration finds bugs. A regression test proves them. Every confirmed bug becomes a Playwright Test under `tests/e2e` that fails before the fix.

## Chrome DevTools MCP (when offered)

Use it for console and network details, `performance_start_trace` / `performance_stop_trace` / `performance_analyze_insight` for long tasks and frame drops, and `take_heapsnapshot` for leaks across rounds. It runs with `--isolated --headless`.

## Rendering and performance

- **Software rendering:** headless Chrome renders WebGL with the SwiftShader software renderer by default. Read `WEBGL_debug_renderer_info` through the hook or `browser_evaluate`. If the renderer says SwiftShader, functional checks are valid but frame-time numbers are not. Label them unverified.
- **GPU in headless:** on the operator's machine, GPU rendering worked with these Chromium args:
  - NVIDIA: `--ignore-gpu-blocklist --enable-gpu-rasterization --use-angle=vulkan --enable-features=Vulkan`;
  - Intel: `--ignore-gpu-blocklist --use-gl=angle --use-angle=gl-egl`.

  Put them in a Playwright Test project for performance tests (`launchOptions.args`).
- **Budgets to report:**
  - frame time p50 and p95 (target p95 ≤ 16.7 ms);
  - long tasks above 50 ms;
  - draw calls and triangles, from `renderer.info`;
  - JS heap growth across 3 rounds.

  Measure over a scripted scenario of at least 10 seconds, for example 4 bots and bombs.

## Multiplayer checks

- Start the server on a free port (read the printed port).
- Open N browser contexts (`browser.newContext()`), one per player, in one Playwright Test.
- Drive inputs per context and assert agreement: the same round state and the same knocked-out players within the allowed ticks.
- For lag, use the server's test latency option or throttle a client.
- Close all contexts and stop the server at the end.

## Input on canvas

- Prefer keyboard: `page.keyboard.down`, `page.keyboard.up`, with explicit durations driven by game ticks, not sleeps.
- For mouse aim, convert world positions to screen coordinates through the hook.
- Avoid fixed waits. Wait for hook conditions (`page.waitForFunction`).

## Visual evidence

Take screenshots at named states (`round-start`, `after-bomb`, `knocked`). Compare them only loosely, because physics and anti-aliasing vary. Pixel-exact comparisons of physics scenes are flaky.

## Reporting

For each acceptance criterion, report:
- passed, failed or unverified;
- the command and exit code, or the MCP tool sequence;
- the hook values observed;
- screenshot and trace paths;
- for failures, exact reproduction steps and the suspected owner (Physics, Network, Gameplay, Technical Artist).

Distinguish an environment failure (no browser, no GPU, port in use) from a game failure. Never edit game source or other owners' tests to make checks pass.
