#!/bin/sh
# Runs the Codex CLI installed on the Docker machine. compose.yaml mounts its npm package (with the bundled native
# binary) read-only at /opt/host-cli/codex; its launcher only needs node.
set -eu
launcher=/opt/host-cli/codex/bin/codex.js
if [ ! -f "$launcher" ]; then
  echo "codex: Codex is not mounted. Install it on the machine and set CODEX_PACKAGE_DIR for compose.yaml." >&2
  exit 127
fi
exec /usr/local/bin/node "$launcher" "$@"
