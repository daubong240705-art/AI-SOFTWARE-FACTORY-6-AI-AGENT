#!/bin/bash
# Starts the deployed Factory Host with every agent on the operator's local CLIs (Claude Code, Codex) and the Lead chat
# on the Claude Code CLI. No OpenCode, no bubblewrap sandbox, no model proxy, and no token budget that blocks work:
# usage is still recorded. Agents run with the operator's FULL permissions in each task's git worktree.
#
#   bash scripts/factory-v2/start-host-cli.sh --check          # verify prerequisites, start nothing
#   bash scripts/factory-v2/start-host-cli.sh                  # seats without an override run on Claude Code
#   bash scripts/factory-v2/start-host-cli.sh --agents codex   # ... or on Codex
#   bash scripts/factory-v2/start-host-cli.sh --slots 8        # agents running at the same time (default: from cores and RAM)
#
# Codex configured with a provider key (for example 9Router with env_key NINE_ROUTER_API_KEY): export that variable in
# this shell; it is passed to the CLIs only (FACTORY_CLI_PASS_ENV, default NINE_ROUTER_API_KEY when it is set).
# Optional: FACTORY_LEAD_EFFORT, FACTORY_LEAD_TIMEOUT_SECONDS (default here 600), FACTORY_MULTI_TEAM=1,
#           FACTORY_BUDGET_TASK_TOKENS / FACTORY_BUDGET_DAY_TOKENS (default here: no limit), FACTORY_PORT, FACTORY_STATE_DIR.
# Run `bash scripts/factory-v2/deploy-host-wsl.sh` first so the app and the UI build are deployed.
set -u
ROOT="${FACTORY_V2_HOME:-$HOME/factory-v2}"
CHECK=0
AGENTS=claude
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=1 ;;
    --agents) shift; case "${1:-}" in codex|claude) AGENTS="$1" ;; *) echo "--agents needs codex or claude" >&2; exit 1 ;; esac ;;
    --slots) shift; export FACTORY_NODE_SLOTS="${1:-}" ;;
    *) echo "Usage: $0 [--check] [--agents codex|claude] [--slots N]" >&2; exit 1 ;;
  esac
  shift
done
fail=0
ok()   { echo "  ok    $*"; }
bad()  { echo "  MISSING  $*" >&2; fail=1; }
note() { echo "  note  $*" >&2; }

# Optional secrets file (the same one the systemd unit of the runbook uses): KEY=value lines, mode 600.
# Variables already set in this shell win; nothing from the file is printed.
ENV_FILE="${FACTORY_ENV_FILE:-$HOME/.config/factory/env}"
if [ -f "$ENV_FILE" ]; then
  case "$(stat -c '%a' "$ENV_FILE" 2>/dev/null)" in
    600|400) while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in ''|'#'*) continue ;; esac
        name="${line%%=*}"; value="${line#*=}"
        [[ "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
        [ -n "${!name+x}" ] || export "$name=$value"
      done < "$ENV_FILE" ;;
    *) echo "  note  ignoring $ENV_FILE: make it private with chmod 600" >&2 ;;
  esac
fi

echo "Factory Host (local CLI agents, Claude Code Lead) preflight"
export PATH="$ROOT/node/bin:$HOME/.local/bin:$HOME/.local/npm/bin:$PATH"
command -v node >/dev/null 2>&1 && ok "node $(node --version)" || bad "node (expected $ROOT/node/bin/node)"
[ -f "$ROOT/app/apps/factory-host/dist/main.js" ] && ok "deployed Host build ($(tr '
' ' ' < "$ROOT/app/VERSION" 2>/dev/null))" || bad "Host build: run scripts/factory-v2/deploy-host-wsl.sh"
[ -f "$ROOT/app/apps/factory-ui/dist/index.html" ] && ok "UI build" || bad "UI build: run npm run build in apps/factory-ui, then redeploy"
command -v git >/dev/null 2>&1 && ok "git" || bad "git"
command -v claude >/dev/null 2>&1 && ok "claude $(claude --version 2>/dev/null | head -1) (Lead chat and default agents)" \
  || bad "claude CLI not found in PATH (the Lead chat needs it; install and run claude auth login)"
if command -v codex >/dev/null 2>&1; then ok "codex $(codex --version 2>/dev/null | head -1)"
elif [ "$AGENTS" = codex ]; then bad "codex CLI not found in PATH"
else note "codex CLI not found: seats can only use Claude Code"; fi
case "$ROOT" in /mnt/*) bad "FACTORY_V2_HOME must not be under /mnt";; esac
if [ -z "${FACTORY_CLI_PASS_ENV+x}" ] && [ -n "${NINE_ROUTER_API_KEY:-}" ]; then export FACTORY_CLI_PASS_ENV=NINE_ROUTER_API_KEY; fi
[ -n "${FACTORY_CLI_PASS_ENV:-}" ] && ok "variables passed to the CLIs: ${FACTORY_CLI_PASS_ENV} (values not shown)" \
  || note "no variables passed to the CLIs (a Codex provider key such as NINE_ROUTER_API_KEY is not set)"
if [ "$fail" -ne 0 ]; then echo "Preflight failed: nothing started." >&2; exit 1; fi
if [ "$CHECK" -eq 1 ]; then echo "Preflight passed. Start without --check to run the Host."; exit 0; fi

# OpenCode, its sandbox and the model proxy stay off: none of their variables reach the Host.
unset FACTORY_RUNTIME FACTORY_OPENCODE_DIR FACTORY_PROXY_SOCKET FACTORY_PROXY_PORT FACTORY_AGENT_MODELS FACTORY_LEAD_MAX_OUTPUT_TOKENS
mkdir -p "$ROOT/workspaces" "$ROOT/worktrees" "$ROOT/state"
export FACTORY_LOCAL_CLI=1 FACTORY_DEFAULT_AGENT_CLI="$AGENTS" FACTORY_LEAD_CLI=claude
# No sign-in token: the Host listens on loopback only and gives the browser a session by itself.
# Set FACTORY_OPEN_LOGIN=0 to bring the one-time token back.
export FACTORY_OPEN_LOGIN="${FACTORY_OPEN_LOGIN:-1}"
export FACTORY_LEAD_TIMEOUT_SECONDS="${FACTORY_LEAD_TIMEOUT_SECONDS:-600}"
export FACTORY_STATE_DIR="${FACTORY_STATE_DIR:-$ROOT/state}"
export FACTORY_PROJECTS_ROOT="${FACTORY_PROJECTS_ROOT:-$ROOT/workspaces}"
export FACTORY_WORKTREES_ROOT="${FACTORY_WORKTREES_ROOT:-$ROOT/worktrees}"
export FACTORY_DEFAULT_PACK="${FACTORY_DEFAULT_PACK:-web-games}"
export FACTORY_PACKS="${FACTORY_PACKS:-web-games}"
if [ -z "${FACTORY_GAME_STARTER_DIR+x}" ] && [ -d "$HOME/GitHub/game-portal/starter/turn-based" ]; then
  export FACTORY_GAME_STARTER_DIR="$HOME/GitHub/game-portal/starter/turn-based"
fi
export FACTORY_PORT="${FACTORY_PORT:-8787}"
# No blocking budget: the largest value the Host accepts. Usage is still recorded per call.
export FACTORY_BUDGET_TASK_TOKENS="${FACTORY_BUDGET_TASK_TOKENS:-9007199254740991}"
export FACTORY_BUDGET_DAY_TOKENS="${FACTORY_BUDGET_DAY_TOKENS:-9007199254740991}"
if [ -z "${FACTORY_NODE_SLOTS:-}" ]; then
  CORES="$(nproc 2>/dev/null || echo 2)"; MEM_MB="$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 2400)"
  AUTO=$(( MEM_MB / 1200 )); [ "$CORES" -lt "$AUTO" ] && AUTO="$CORES"; [ "$AUTO" -lt 2 ] && AUTO=2; [ "$AUTO" -gt 16 ] && AUTO=16
  export FACTORY_NODE_SLOTS="$AUTO"
fi
echo "WARNING: agents run on the $AGENTS CLI (unless a seat is configured otherwise) with the operator's full permissions." >&2
echo "Agent slots: $FACTORY_NODE_SLOTS. Lead chat: Claude Code CLI. Token budget: not limited."
echo "Starting on http://127.0.0.1:${FACTORY_PORT}/ (loopback only). The one-time sign-in token is printed below; stop with Ctrl+C."
exec node "$ROOT/app/apps/factory-host/dist/main.js"
