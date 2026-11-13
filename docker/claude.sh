#!/bin/sh
# Runs the Claude Code CLI installed on the Docker machine. compose.yaml mounts ~/.local/share/claude read-only at
# /opt/host-cli/claude; the newest version there is used, so updating Claude Code on the machine updates it here.
set -eu
dir=/opt/host-cli/claude/versions
bin="$(ls -1t "$dir" 2>/dev/null | head -n 1)"
if [ -z "$bin" ] || [ ! -x "$dir/$bin" ]; then
  echo "claude: Claude Code is not mounted. Install it on the machine (~/.local/share/claude) and check compose.yaml." >&2
  exit 127
fi
exec "$dir/$bin" "$@"
