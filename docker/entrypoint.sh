#!/bin/bash
# Container start: prepare /data and the CLI home as root, copy the operator's CLI logins once, then run the Host as
# FACTORY_UID:FACTORY_GID (default 1000:1000, the usual first Linux user) so files in /data belong to the operator.
#
# Commands: host (default), reseed (copy the logins again from the machine, then exit), check, shell.
set -euo pipefail
uid="${FACTORY_UID:-1000}"; gid="${FACTORY_GID:-1000}"
seed=/seed

as_user() { setpriv --reuid="$uid" --regid="$gid" --clear-groups -- "$@"; }

prepare() {
  mkdir -p /data/state /data/workspaces /data/worktrees "$HOME"
  chown "$uid:$gid" /data /data/state /data/workspaces /data/worktrees "$HOME"
}

# Copies only what the CLIs need to be logged in and configured; history, sessions and caches stay on the machine.
# Nothing is ever written back to the mounted originals (they are read-only).
seed_logins() {
  local force="${1:-0}" copied=0
  copy() { # copy <source> <target> <mode>
    [ -f "$1" ] || return 0
    if [ "$force" = 1 ] || [ ! -f "$2" ]; then
      install -D -m "$3" -o "$uid" -g "$gid" "$1" "$2"; copied=$((copied + 1))
    fi
  }
  copy "$seed/claude/.credentials.json" "$HOME/.claude/.credentials.json" 600
  copy "$seed/claude/settings.json" "$HOME/.claude/settings.json" 600
  copy "$seed/claude.json" "$HOME/.claude.json" 600
  copy "$seed/codex/auth.json" "$HOME/.codex/auth.json" 600
  copy "$seed/codex/config.toml" "$HOME/.codex/config.toml" 600
  [ -d "$HOME/.claude" ] && chown "$uid:$gid" "$HOME/.claude"
  [ -d "$HOME/.codex" ] && chown "$uid:$gid" "$HOME/.codex"
  echo "factory: CLI login files copied: $copied"
}

# The document worker runs in a bubblewrap sandbox. Docker's default seccomp profile usually blocks the namespaces it
# needs; then the worker runs directly, still inside this container and under a 2 GiB memory limit.
doc_worker() {
  [ "${FACTORY_DOC_WORKER:-}" = off ] && return 0
  [ -n "${FACTORY_DOC_WORKER_COMMAND:-}" ] && return 0
  if as_user bwrap --unshare-all --die-with-parent --ro-bind / / true 2>/dev/null; then
    echo "factory: document worker sandbox: bubblewrap"
  else
    export FACTORY_DOC_WORKER_COMMAND='["/usr/bin/prlimit","--as=2147483648","--","/opt/doc-worker/venv/bin/python","-I","/app/apps/factory-host/workers/doc_worker.py"]'
    echo "factory: document worker sandbox: none (bubblewrap is blocked here); the container is the boundary"
  fi
}

check() {
  local fail=0
  echo "Factory container check"
  echo "  node $(node --version)"
  as_user git --version | sed 's/^/  /'
  if as_user claude --version >/dev/null 2>&1; then echo "  claude $(as_user claude --version 2>/dev/null | head -n 1)"; else echo "  MISSING claude CLI (mount ~/.local/share/claude)"; fail=1; fi
  if as_user codex --version >/dev/null 2>&1; then echo "  codex $(as_user codex --version 2>/dev/null | head -n 1)"; else echo "  note    codex CLI not mounted: seats can only use Claude Code"; fi
  [ -f "$HOME/.claude/.credentials.json" ] || [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && echo "  claude login present" || { echo "  MISSING claude login (run: docker compose run --rm factory reseed)"; fail=1; }
  [ -n "${NINE_ROUTER_API_KEY:-}" ] && echo "  NINE_ROUTER_API_KEY set (value not shown)" || echo "  note    NINE_ROUTER_API_KEY not set: Codex seats on 9router will fail"
  echo "  data: /data (state, workspaces, worktrees); port ${FACTORY_PORT}"
  return "$fail"
}

prepare
case "${1:-host}" in
  reseed) seed_logins 1; exit 0 ;;
  check) seed_logins 0; check; exit $? ;;
  shell) seed_logins 0; exec setpriv --reuid="$uid" --regid="$gid" --clear-groups -- bash ;;
  host) ;;
  *) exec "$@" ;;
esac

seed_logins 0
doc_worker
# compose passes optional settings as empty strings when they are not set; the Host treats empty as invalid.
for name in FACTORY_LEAD_EFFORT FACTORY_LEAD_MODEL FACTORY_LEAD_MAX_OUTPUT_TOKENS FACTORY_DEFAULT_AGENT_CLI; do
  [ -z "${!name:-}" ] && unset "$name"
done
# Pass the provider key and Claude Code settings through to the CLIs; values are never printed.
if [ -z "${FACTORY_CLI_PASS_ENV:-}" ]; then
  pass=DISABLE_AUTOUPDATER
  for name in NINE_ROUTER_API_KEY CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY OPENAI_API_KEY; do
    [ -n "${!name:-}" ] && pass="$pass,$name"
  done
  export FACTORY_CLI_PASS_ENV="$pass"
fi
check || { echo "factory: fix the items above, then restart the container." >&2; exit 1; }
echo "factory: starting on http://127.0.0.1:${FACTORY_PORT}/ (loopback only)"
exec setpriv --reuid="$uid" --regid="$gid" --clear-groups -- node /app/apps/factory-host/dist/main.js
