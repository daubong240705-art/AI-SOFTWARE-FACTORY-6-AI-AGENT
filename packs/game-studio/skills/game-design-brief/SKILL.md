---
name: game-design-brief
description: Write a one-page game brief and tuning data that engineers and QA can build and test against, for a physics-driven party game with short rounds.
version: 0.1.0
source: Donchitos/Claude-Code-Game-Studios /prototype one-page brief and lean mode; Gaffer On Games (physics feel depends on stable fixed-step simulation); Factory software-team requirements practice.
---

# Game design brief

Use when the task asks for a brief, rules, or tuning. Write the smallest thing that lets the team build and test the next increment.

## One-page brief (`design/brief.md`, only when requested)

Write at most one page, with these sections:

1. **Pitch:** one sentence, original setting and characters.
2. **Players and session:** player count, round length, the device the game targets.
3. **Core loop:** what the player does every 10 seconds, every round, and every session.
4. **Verbs:** move, jump, grab, throw, bomb, get up. For each verb give the input, the effect and the counterplay.
5. **Round rules:** spawn, knockout, elimination or score, win condition, round end.
6. **Controls:** keyboard and gamepad mapping.
7. **Out of scope:** what this increment does not include.
8. **Open questions:** each one with the owner who can answer it.

Characters, names, levels and UI must be original. "Physics party brawler with wobbly animal-like characters" is a genre; a specific existing game's characters, maps or look are not to be copied.

## Feel and tuning

Wobbly, slapstick physics feels good when:
- characters stay controllable while their bodies sway;
- falls are readable and recovery is quick;
- big hits are rare and visible.

Express feel as numbers in `shared/tuning/*.json`. For example:

```json
{
  "moveSpeedMps": { "value": 4.5, "why": "crosses the small arena in about 4 s" },
  "knockoutImpulseNs": { "value": 18, "why": "a bomb within 1.5 m knocks out, beyond 3 m only staggers" },
  "getUpDelayMs": { "value": 1800, "why": "long enough to grab a downed player, short enough to stay fun" },
  "poseStrength": { "value": 0.6, "why": "0 is a limp ragdoll, 1 tracks the animation stiffly" }
}
```

Rules for tuning data:
- units in key names;
- one reason per value;
- no logic in data;
- change a few values per task, so the effect can be judged.

## Make every rule testable

For each rule, write how QA or a unit test observes it: the setup, the input, the expected outcome and the threshold. For example: "Bomb at 1.0 m from a standing player: the player is knocked out within 200 ms (state `knocked`). At 4.0 m: the player stays standing."

Tie each rule to the owner who implements it: Physics, Network or Gameplay.

## Playtest notes

After a playable build exists, record what you observed (not what you hoped), the tuning values at that time, and the one change you propose next. A human playtest by the operator outranks agent impressions. Mark agent-only observations as such.
