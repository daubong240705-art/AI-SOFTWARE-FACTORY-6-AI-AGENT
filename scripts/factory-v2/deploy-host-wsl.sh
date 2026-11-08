#!/bin/bash
# Copies the built Host (and the built contracts it links to) from the Windows checkout to ext4 in WSL and
# installs production dependencies there. Run from WSL after `npm test` (host/contracts) and `npm run build` (ui) on Windows:
#   bash /mnt/e/GIT/AI-SOFTWARE-FACTORY-6-AI-AGENT/scripts/factory-v2/deploy-host-wsl.sh
# Why: loading node_modules from /mnt/<drive> (9p) takes 20+ seconds and WAL needs a local filesystem.
set -euo pipefail
export PATH="$HOME/factory-v2/node/bin:$PATH"
SRC="${FACTORY_SRC:-/mnt/e/GIT/AI-SOFTWARE-FACTORY-6-AI-AGENT}"
DST="${FACTORY_APP_DIR:-$HOME/factory-v2/app}"
case "$DST" in /mnt/*) echo "refusing to deploy under /mnt" >&2; exit 1;; esac
rm -rf "$DST"; mkdir -p "$DST/apps/factory-host" "$DST/apps/factory-ui" "$DST/packages/factory-contracts" "$DST/packs"
(cd "$SRC/packages/factory-contracts" && tar cf - package.json package-lock.json dist) | tar xf - -C "$DST/packages/factory-contracts"
(cd "$SRC/apps/factory-host" && tar cf - package.json package-lock.json dist migrations) | tar xf - -C "$DST/apps/factory-host"
(cd "$SRC/packs" && tar cf - .) | tar xf - -C "$DST/packs"
# The built UI (run `npm run build` in apps/factory-ui first); the Host serves it from apps/factory-ui/dist.
if [ -d "$SRC/apps/factory-ui/dist" ]; then (cd "$SRC/apps/factory-ui" && tar cf - dist) | tar xf - -C "$DST/apps/factory-ui"; else echo "note: apps/factory-ui/dist not found, the Host will serve no UI" >&2; fi
(cd "$DST/packages/factory-contracts" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null)
(cd "$DST/apps/factory-host" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null)
echo "Deployed to $DST. Start with:"
echo "  FACTORY_STATE_DIR=\$HOME/factory-v2/state FACTORY_PORT=8787 node $DST/apps/factory-host/dist/main.js"
