---
name: active-ragdoll-physics
description: Implement wobbly physics-driven characters with Rapier: fixed-step world, active ragdoll that tracks an animated pose, balance, knockout and get-up, grabbing, throwing and bomb impulses, with headless tests.
version: 0.1.0
source: Rapier docs (rapier.rs joints and motors guide, rapier.js API); active ragdoll practice (animated target plus PD-driven physics body, per-joint strength blend, e.g. corle-bell/active-ragdolls); DiffMimic/DeepMimic PD control law; Gaffer On Games fixed timestep.
---

# Active ragdoll physics

## Architecture

- **Fixed step:** step in fixed increments (`world.timestep = 1 / 60`) from an accumulator. Rendering interpolates between the last two states.
- **Pure module:** `shared/physics` imports Rapier only (`@dimforge/rapier3d-compat`, after `await RAPIER.init()`). No three.js, no DOM.
- **Determinism:** when server and clients must match, use `@dimforge/rapier3d-deterministic-compat`, with identical inputs, step order and body creation order.
- **Version check:** Rapier method names change between versions. Check the installed types before using any call named here.

## Character model

1. **Target pose:** an animated skeleton plays the GLB clips (Idle, Walk, …) and gives a desired orientation for each bone. It is never simulated.
2. **Physics body:** one dynamic rigid body per main bone, using the capsules from `<name>.colliders.json`. Joint the bodies at the bone pivots: spherical joints for shoulders, hips and neck, revolute joints for elbows and knees. Give every joint limits.
3. **Self-collision:** disable contacts between bodies in the same ragdoll, using collision groups (16 membership bits and 16 filter bits) or `joint.setContactsEnabled(false)` on jointed pairs. Without this the solver fights the joints and the character jitters.
4. **Tracking:** each physics body is pushed towards its target orientation with a PD controller: torque = kp · angleError − kd · angularVelocity. Revolute joints can use position motors with stiffness and damping. For multi-axis joints, if the installed version has no suitable motor, apply the PD torque as a torque impulse on the child body, computed from the quaternion error.
5. **Strength blend:** each joint gets a strength from 0 (limp) to 1 (stiff tracking), scaled by `poseStrength` from the tuning data. Wobble comes from moderate strength plus the body's inertia.
6. **Balance:** keep the pelvis or torso upright with an extra PD torque towards world-up. Drive locomotion by applying force at the pelvis from the input. Feet do not need to be perfect.

## States

| State | Behaviour |
|---|---|
| `standing` | normal strength and the balance torque |
| `staggered` | strength reduced briefly after a medium impulse |
| `knocked` | strength 0 and balance off, after an impulse above `knockoutImpulseNs` or a fall from height |
| `gettingUp` | after `getUpDelayMs`, ramp strength and balance back over a few hundred milliseconds, and play GetUp as the target pose |
| `grabbed` / `grabbing` | see below |

Make the transitions explicit, and expose the state in snapshots so the client and QA can observe it.

## Grab, throw, bombs

- **Grab:** when a hand body touches a grabbable body and the grab input is held, create a temporary spherical joint between them. Remove it when the input is released or the break force is exceeded.
- **Throw:** on release, apply an impulse to the held body along the aim direction. Scale it by `throwImpulseNs`.
- **Bomb:** find the bodies within `bombRadiusM` and apply an impulse away from the centre, falling off with distance (linear or quadratic, as defined in tuning). Wake sleeping bodies. Decide knockouts from the impulse received.

## Tests (headless, no browser)

- **Stability:** a standing character over 10,000 steps does not fall, does not drift beyond a set tolerance, and produces no NaN in any position or rotation.
- **Knockout thresholds:** a bomb at 1.0 m gives `knocked`, a bomb at 4.0 m keeps the player `standing`. The values come from tuning.
- **Grab:** after grab and release, the joint count returns to its value before the grab.
- **Replay:** take the same seed and inputs and compare `world.takeSnapshot()` bytes or a hash of the body states. Check `snapshot` and `restore` on the installed version.
- **Performance:** measure milliseconds per step for 8 characters on the repo's machine.

Report the test command, its exit code and the numbers.
