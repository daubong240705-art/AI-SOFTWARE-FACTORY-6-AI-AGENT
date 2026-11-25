---
name: game-design-doc
description: Turn an agreed brief into a small implementation-ready design, manifest and observable acceptance criteria.
---

# Template for docs/design.md

- **Approved brief / exclusions:** one-line appeal, player counts, expected duration, and what won't ship.
- **Core loop & victory:** setup, round/turn order, legal choices, win/loss/draw and termination. Specify tie-breakers and time/move caps where needed.
- **Worked examples:** two legal transitions with example seat/action/view and one rejection with identical state. Include a final-turn and malformed-input example. Describe any hidden information and which seat can see it.
- **Bot & balance:** simple policy, seed strategy, seat-advantage and match-length thresholds to look at, not promises.
- **Presentation:** screen and turn/status layout, two viewport sizes, keyboard/touch, feedback and reduced-motion behavior.
- **Acceptance:** numbered Given/When/Then checks for rules, client, bots, mobile, rematch and release. Map checks to rule tests or browser observations.
- **Manifest:** stable folder `id`, display `name`, description, category, player limits, bot support, SDK version and local paths. Match the rules spec.

Use an original theme, for example guiding lanterns through a shifting orchard; no commercial characters or borrowed art. Give Rules and Client the action/state examples before implementation.
