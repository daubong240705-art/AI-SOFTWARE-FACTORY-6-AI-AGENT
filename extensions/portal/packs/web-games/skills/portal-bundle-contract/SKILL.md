---
name: portal-bundle-contract
description: Verify a standalone Portal tar.gz candidate from dist without changing the game's identity or sending a network request.
---

# Portal bundle contract

- Archive the contents of `dist/`, not the `dist` directory: `game.json` is at the tar.gz root. Include `index.html`, `main.js`, `theme.css`, standalone ESM `rules.js` and all manifest-referenced files including `thumb.svg` for this pack. The starter copies `assets/` contents into the root of `dist/`.
- Check manifest `id` equals the game project folder's stable lowercase slug (`^[a-z0-9][a-z0-9-]{1,39}$`); do not infer it from a temporary worktree directory name. Rename via `name`, not `id`. Check display name (1–60 characters), description (up to 300), allowed category (`board`, `card`, `puzzle`, `party`, `other`), integer player bounds (1–8, min ≤ max), boolean `bot`, `sdk: 1` and relative `entry`, `rules`, `thumbnail`. No traversal, absolute paths or symlinks in `dist/`.
- HTML loads `./main.js` and `./theme.css`; keep all runtime assets local and relative. Use `connectGame()`; only the host owns the network. No external resource URLs, network calls, source maps, `.dev/`, source/tests, dependency folders or secrets. An inert SVG namespace is not a resource request.

Run `npm run check`, `npm test` (including bundle tests) and `npm run build`. Inspect `find dist -type f` and `find dist -type l`, check manifest targets and inspect HTML, JS, CSS and SVG for external resources. Check a browser Network log for unexpected requests. Inspect `tar -C dist -czf - . | tar -tzf -` and measure `tar -C dist -czf - . | wc -c`; use a shell with `pipefail` to catch a failed tar. The archive must be strictly below `52428800` bytes (50 MiB). Also flag unexpectedly large unpacked content. Report sizes and command exit codes; never upload from the shell.
