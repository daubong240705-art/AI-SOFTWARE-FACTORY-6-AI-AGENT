---
name: game-coordination
description: Repository layout, seat ownership, cross-seat contracts (assets, simulation API, protocol, test hook) and handoff rules for building the game in small playable increments.
version: 0.1.0
source: Donchitos/Claude-Code-Game-Studios (lean mode, vertical delegation, domain boundaries); Factory software-team team-coordination; Factory POC 0 findings (2026-11).
---

# Game coordination

Use this skill when you start a task, touch a shared contract, or hand work over. Lead plans; specialists never create tasks, re-plan or call other agents.

## Principle: playable first

Each increment should leave the game runnable. Prefer "one new verb works end to end" over "a complete subsystem nobody can play yet". Documents are written only on request; the repository, tests and handoffs carry the knowledge. A process that writes many documents before code costs more without producing a better game.

## Default repository layout

Adapt to the existing repository if it differs; never restructure it unasked.

| Path | Owner | Content |
|---|---|---|
| `design/` | Game Designer | `brief.md` (only when requested) |
| `shared/tuning/*.json` | Game Designer | feel numbers with units in key names |
| `shared/physics/` | Physics Engineer | Rapier simulation, no DOM or rendering |
| `shared/protocol/` | Network Engineer | message types, quantization |
| `server/` | Network Engineer | authoritative game server |
| `client/` | Gameplay Engineer | Three.js app, input, camera, HUD |
| `tools/blender/*.py` | Technical Artist | asset build scripts |
| `assets/models/`, `assets/CREDITS.md` | Technical Artist | GLB files, collider sidecars, licenses |
| `tests/e2e/` | QA Engineer | Playwright tests |

Unit tests live next to the code they test and belong to that code's owner. `.factory/` holds tool output (browser screenshots, traces). It must be listed in `.gitignore`; if it is not, report it. Do not add it yourself unless `.gitignore` is in your scope.

## Contracts between seats

Change a contract only in your own area, and announce it in your handoff with the old and new shape.

- **Asset contract** (Technical Artist → Physics, Gameplay): `assets/models/<name>.glb` plus `<name>.colliders.json` (per-bone capsules in metres). Clip names: Idle, Walk, Run, Jump, Fall, GetUp, Grab, Throw, Wobble. Bone names stay stable across versions.
- **Simulation API** (Physics → Network, Gameplay): `createWorld(tuning)`, `step(world, inputs)`, `applyInput`, `snapshot(world)`, `restore(world, snapshot)`. The step is fixed (60 Hz by default) and deterministic for the same inputs on the same build.
- **Protocol** (Network → Gameplay): input messages carry a sequence number and a tick. State messages carry a tick and quantized body state. The schema lives in `shared/protocol`.
- **Test hook** (Gameplay → QA): `window.__game` exists in dev and test builds and exposes `state`, `frames`, `players`, `seed` and `tick`. It must not ship in production builds.

## Handoff

Your last progress report states:
- what changed and which files;
- the real commands you ran, with exit codes;
- the numbers that matter (frame time, triangle count, file size, bandwidth, test counts);
- contract changes;
- what is unverified;
- the next owner.

Use relative paths. Truncated or missing output stays unverified.

## Review and rework

QA reviews; authors never approve their own work. A failed check returns to the author's seat with reproduction steps and a failing test where possible. After two rework rounds, the Lead asks the operator.

## Shared machine resources

- One Blender GUI instance serves one agent at a time. Batch work uses `blender -b`, which is safe to run in parallel.
- Never bind fixed ports. Print the port you got.
- Paid generation services spend real money. Use them only when the task says the operator allowed it, and record what was generated.
