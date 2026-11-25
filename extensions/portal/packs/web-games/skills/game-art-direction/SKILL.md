---
name: game-art-direction
description: Art direction for SVG and CSS browser games - a look that belongs to this game, palette and type tokens, one asset family, every state designed, screenshot critique. Read before drawing assets or styling screens.
---

# Game art direction

A game looks good when every piece belongs to one world, the board reads at a glance and one thing is memorable. Plain assets in one style beat pretty assets in mixed styles.

## 1. Ground the look in this game

Before drawing, record a short art brief in the "Presentation" section of `docs/design.md` (Game Designer) or with the design evidence (UI Artist):

- **The game keeps its name**: the world below is a visual setting only; never rename the game or add a brand/subtitle to its title.
- **World**: a concrete setting taken from the request and the game (caro: squared notebook paper and ink; a card game: a felt table, or candy wrappers, or a retro arcade). Follow the operator's style words exactly when given (for example chibi, pastel, pixel).
- **Mood**: three adjectives.
- **Palette**: 4 to 6 named hex colours as CSS custom properties (`--table`, `--ink`, `--accent`...), plus one colour per player that differs in lightness, not only hue. Default to milk, cream, beige, soft pastels and dark ink unless the brief sets another theme.
- **Type**: system font stacks only (no font files, no network). Give the title character with weight, size and spacing, or draw it as an SVG wordmark in `assets/`.
- **The memorable element**: one thing (the board surface, the card faces, a mascot). Spend your boldness there and keep the HUD quiet.

Generic defaults that make games look generated: dark navy with one neon accent, identical rounded cards with a soft grey shadow, decorative gradients, emoji used as art, ALL-CAPS labels everywhere, a different radius and shadow on every element. Use one only when the brief asks for it.

## 2. Draw assets as one family

- One `viewBox` grid per asset type (pieces 64x64, cards 120x168) and one stroke scale (for example 3 px outlines, 2 px details) with round joins and caps.
- Colours come from the palette variables or `currentColor`, never ad hoc hex values.
- One light direction for highlights and shadows (top-left), the same for every asset.
- Every piece and card is readable at 32 px and distinguishable by shape or symbol as well as colour (colour-blind players, monochrome screens).
- Clean files: no editor metadata, no embedded bitmaps, no translatable text.
- The thumbnail (`assets/thumb.svg`) shows the actual game at a glance: the board or table mid-match in the game's palette, not a logo on a gradient.

## 3. Lay out screens around the board

- The board or table is the hero: centred, as large as the frame allows without scrolling.
- Whose turn it is must be the second thing a player sees (a coloured frame around the active player, a large label, the piece colour).
- The HUD sits at the edges and stays compact on a phone (390x844); it never covers the board.
- Spacing and radii come from a small scale (4/8/12/16/24 px; radii 8/16 px) so neighbours line up.

## 4. Design every state, not just the idle board

Hover and focus, selected, legal move hint, last move, opponent thinking, disabled, illegal move, waiting for players, reconnecting, win (winning line or hand highlighted), draw and loss. Each needs a visible, non-colour-only signal. Text contrast at least 4.5:1, key game visuals at least 3:1, touch targets at least 44 px, visible focus ring.

## 5. Look at it, critique, fix

Look at the two UI sample screenshots (1280x720 and 390x844) and check:

1. Is the board the first thing you see, and whose turn is obvious?
2. Does every asset share palette, stroke and light direction?
3. Anything misaligned, unevenly spaced, clipped, or needing a scroll?
4. Is there one memorable element, and nothing competing with it?
5. Remove one decoration that does not help play.

Fix and look again once. Report what you checked and what you changed.

---
Adapted for SVG and CSS browser games from `frontend-design` (anthropics/skills) and `game-ui-ux` (gamedev-skills/awesome-gamedev-agent-skills), both Apache License 2.0; rewritten and condensed. See `../LICENSE-APACHE-2.0.txt`.
