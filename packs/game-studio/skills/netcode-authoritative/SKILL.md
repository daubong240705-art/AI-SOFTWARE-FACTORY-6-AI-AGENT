---
name: netcode-authoritative
description: Build the authoritative multiplayer server and protocol for a physics party game: fixed tick, input messages, prediction and reconciliation, interpolation, quantization, priority, and multi-client tests.
version: 0.1.0
source: Colyseus netcode docs (docs.colyseus.io/netcode, 0.18+) and load-test docs (docs.colyseus.io/tools/loadtest); Gaffer On Games networked physics series (snapshot interpolation, state synchronization, priority accumulator, jitter buffer, quantization).
---

# Authoritative netcode

## Model

- **The server is the authority.** It runs the shared simulation (`shared/physics`) at a fixed tick and owns all game state: positions, knockouts, grabs, scores. It never accepts positions from clients.
- **Clients send inputs.** Each message carries the input state (move vector, jump, grab, throw, bomb), a sequence number and the client tick. The server applies inputs at its tick, and rejects invalid or very late input.
- **Local prediction.** The client runs the same simulation for its own character. When server state arrives, it rolls back to that tick, replays the inputs the server has not processed yet, and smooths small corrections visually (render offset decay) rather than snapping the camera.
- **Remote players** are interpolated about 100 ms in the past between received states. Extrapolate only briefly when packets are late.
- **Colyseus 0.18+:** if the repository uses it, prefer its documented primitives: fixed timestep, room input, input definitions, prediction helpers, and rewind for hit checks. Read the installed version's docs first, because these APIs are new.

## Ragdolls over the network

Do not send every limb at full rate.
- **Authoritative and sent:** the character's root or pelvis transform and velocity, its state (`standing`, `knocked`, `gettingUp`, `grabbed`), grab links, and the bodies that matter for gameplay (held objects, thrown players).
- **Cosmetic and local:** limb wobble on clients, simulated locally from the authoritative root. Two clients may disagree on an arm's swing; they must agree on who is knocked out and who holds whom.

## Bandwidth

- **Quantize** positions to a fixed grid (millimetres are plenty) and rotations with smallest-three quaternion compression. Skip velocities for bodies at rest.
- **Priority accumulator** (Gaffer): each tick, add each object's priority to its accumulator; send the highest within the packet budget; reset only the ones you sent. Players near the receiver and moving objects get a higher priority.
- **Send rate:** start with a 60 Hz simulation and 20–30 Hz state updates. Tune by measurement, not by guess.
- **Jitter buffer:** hold a few ticks of state on the client, so updates come out evenly spaced.
- **Measure** bytes per second per client at 2, 4 and 8 players, and report them.

## Rooms and lifecycle

Lobby → countdown → round → results → next round. Handle join in progress (spectate until the next round), leave, and reconnect within a grace period. A timer on the server, not the client, ends rounds.

## Ports and processes

- Read `PORT`. If it is unset, listen on port 0 (ephemeral) and print the bound port on one line, for example `listening on 127.0.0.1:53817`.
- Never bind 0.0.0.0 in development unless the task asks for it.
- Stop every process you start before you finish.

## Tests

- **Room and unit tests:** input validation, tick application, round transitions, reconnect. Use the repo's runner; with Colyseus, its testing package if installed.
- **Scripted multi-client test:** two or more clients in one test. Assert that both see the same knockout within N ticks after a bomb.
- **Latency test:** add artificial latency and jitter, for example a delay in the test transport, and report the correction size and how often it happens.
- **Load test:** with Colyseus, run its load test tool with a client script, for example `npx tsx loadtest/example.ts --room <room> --numClients 8 --endpoint http://127.0.0.1:<port>`. Report CPU per tick and bandwidth.

Hand off:
- the start command;
- the port behaviour;
- message schemas and their file paths;
- tick and send rates;
- the measured numbers;
- known desync cases.
