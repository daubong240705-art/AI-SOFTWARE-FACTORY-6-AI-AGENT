#!/bin/bash
# Runs the Host test suite on Linux from an ext4 copy (full dev install), not from /mnt/<drive>:
# loading node_modules over 9p is so slow that tests which spawn node time out.
#   bash /mnt/e/GIT/AI-SOFTWARE-FACTORY-6-AI-AGENT/scripts/factory-v2/test-host-wsl.sh
set -euo pipefail
export PATH="$HOME/factory-v2/node/bin:$PATH"
SRC="${FACTORY_SRC:-/mnt/e/GIT/AI-SOFTWARE-FACTORY-6-AI-AGENT}"
DST="${FACTORY_CI_DIR:-$HOME/factory-v2/ci}"
case "$DST" in /mnt/*) echo "refusing to use /mnt" >&2; exit 1;; esac
rm -rf "$DST"; mkdir -p "$DST/apps/factory-host" "$DST/packages/factory-contracts" "$DST/packs" "$DST/scripts"
tarx() { (cd "$1" && tar cf - --exclude=node_modules --exclude=dist "${@:3}") | tar xf - -C "$2"; }
tarx "$SRC/packages/factory-contracts" "$DST/packages/factory-contracts" .
tarx "$SRC/apps/factory-host" "$DST/apps/factory-host" .
# workers/ is a runtime sibling of dist/; keep it in the ext4 test copy.
test -f "$DST/apps/factory-host/workers/doc_worker.py"
(cd "$SRC/packs" && tar cf - .) | tar xf - -C "$DST/packs"
mkdir -p "$DST/schema" && (cd "$SRC/schema" && tar cf - factory-v2) | tar xf - -C "$DST/schema"
(cd "$DST/packages/factory-contracts" && npm ci --ignore-scripts --no-audit --no-fund >/dev/null && npm run build >/dev/null)
(cd "$DST/apps/factory-host" && npm ci --ignore-scripts --no-audit --no-fund >/dev/null)
cd "$DST/apps/factory-host"
npm test 2>&1 | grep -E "^# (tests|pass|fail|skipped)|^not ok" || true
