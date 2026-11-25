#!/bin/bash
# Starts the deployed Factory Host with every agent on the operator's local CLIs (Claude Code, Codex) and the Lead chat
# on the Claude Code CLI. No OpenCode, no bubblewrap sandbox, no model proxy, and no token budget that blocks work:
# usage is still recorded. Agents run with the operator's FULL permissions in each task's git worktree.
#
#   bash scripts/factory-v2/start-host-cli.sh --check          # verify prerequisites, start nothing
#   bash scripts/factory-v2/start-host-cli.sh                  # seats without an override run on Claude Code
#   bash scripts/factory-v2/start-host-cli.sh --agents codex   # ... or on Codex
#   bash scripts/factory-v2/start-host-cli.sh --slots 8        # agents running at the same time (default: from cores and RAM)
#   bash scripts/factory-v2/start-host-cli.sh --agents codex --lead gateway   # Lead through the configured model gateway
#   ... --api-models <model>   # also run api-agent agents (research/writing) through the Host model proxy
#
# For gateway mode set FACTORY_MODEL_BASE_URL and, if required, FACTORY_MODEL_API_KEY.
# Set NODE_EXTRA_CA_CERTS only if your gateway uses a private CA.
# Optional: FACTORY_LEAD_EFFORT, FACTORY_LEAD_TIMEOUT_SECONDS (default here 600), FACTORY_MULTI_TEAM=1,
#           FACTORY_BUDGET_TASK_TOKENS / FACTORY_BUDGET_DAY_TOKENS (default here: no limit), FACTORY_PORT, FACTORY_STATE_DIR.
# Run `bash scripts/factory-v2/deploy-host-wsl.sh` first so the app and the UI build are deployed.
set -u
ROOT="${FACTORY_V2_HOME:-$HOME/factory-v2}"
CHECK=0
AGENTS=claude
LEAD=claude
API_MODELS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=1 ;;
    --agents) shift; case "${1:-}" in codex|claude) AGENTS="$1" ;; *) echo "--agents needs codex or claude" >&2; exit 1 ;; esac ;;
    --lead) shift; case "${1:-}" in claude|gateway) LEAD="$1" ;; *) echo "--lead needs claude or gateway" >&2; exit 1 ;; esac ;;
    --slots) shift; export FACTORY_NODE_SLOTS="${1:-}" ;;
    --api-models) shift; API_MODELS="${1:-}" ;;
    *) echo "Usage: $0 [--check] [--agents codex|claude] [--lead claude|gateway] [--slots N] [--api-models m1,m2]" >&2; exit 1 ;;
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

echo "Factory Host (local CLI agents, Lead on $LEAD) preflight"
export PATH="$ROOT/node/bin:$HOME/.local/bin:$HOME/.local/npm/bin:$PATH"
command -v node >/dev/null 2>&1 && ok "node $(node --version)" || bad "node (expected $ROOT/node/bin/node)"
[ -f "$ROOT/app/apps/factory-host/dist/main.js" ] && ok "deployed Host build ($(tr '
' ' ' < "$ROOT/app/VERSION" 2>/dev/null))" || bad "Host build: run scripts/factory-v2/deploy-host-wsl.sh"
[ -f "$ROOT/app/apps/factory-ui/dist/index.html" ] && ok "UI build" || bad "UI build: run npm run build in apps/factory-ui, then redeploy"
command -v git >/dev/null 2>&1 && ok "git" || bad "git"
if [ "$LEAD" = claude ] || [ "$AGENTS" = claude ]; then
  command -v claude >/dev/null 2>&1 && ok "claude $(claude --version 2>/dev/null | head -1) (Lead chat and default agents)" \
    || bad "claude CLI not found in PATH (the Lead chat needs it; install and run claude auth login)"
else ok "claude CLI not needed (Lead on the model gateway, agents on $AGENTS)"; fi
if [ "$LEAD" = gateway ] || [ -n "$API_MODELS" ]; then
  [ -n "${FACTORY_MODEL_BASE_URL:-}" ] && ok "FACTORY_MODEL_BASE_URL is set" || bad "set FACTORY_MODEL_BASE_URL in the shell or $ENV_FILE"
fi
if [ -n "${NODE_EXTRA_CA_CERTS:-}" ]; then
  [ -r "$NODE_EXTRA_CA_CERTS" ] && ok "additional CA certificate is readable" || bad "NODE_EXTRA_CA_CERTS is not readable"
fi
if command -v codex >/dev/null 2>&1; then ok "codex $(codex --version 2>/dev/null | head -1)"
elif [ "$AGENTS" = codex ]; then bad "codex CLI not found in PATH"
else note "codex CLI not found: seats can only use Claude Code"; fi
case "$ROOT" in /mnt/*) bad "FACTORY_V2_HOME must not be under /mnt";; esac
[ -n "${FACTORY_CLI_PASS_ENV:-}" ] && ok "variables passed to the CLIs: ${FACTORY_CLI_PASS_ENV} (values not shown)" \
  || note "no extra variables passed to the CLIs"
case "${FACTORY_LISTEN_HOST:-127.0.0.1}" in
  127.0.0.1|::1) ;;
  *) login_token="${FACTORY_LOGIN_TOKEN:-}"
     if [ "${#login_token}" -ge 24 ]; then ok "network access on $FACTORY_LISTEN_HOST, sign-in with FACTORY_LOGIN_TOKEN (value not shown)"
     else bad "FACTORY_LOGIN_TOKEN (24+ characters) is required when FACTORY_LISTEN_HOST is a network address: put it in $ENV_FILE"; fi ;;
esac
if [ -n "$API_MODELS" ]; then ok "api-agent models: $API_MODELS (through the Host model proxy)"; fi
if [ "$fail" -ne 0 ]; then echo "Preflight failed: nothing started." >&2; exit 1; fi
if [ "$CHECK" -eq 1 ]; then echo "Preflight passed. Start without --check to run the Host."; exit 0; fi

# OpenCode, its sandbox and the model proxy stay off: none of their variables reach the Host.
unset FACTORY_RUNTIME FACTORY_OPENCODE_DIR FACTORY_PROXY_SOCKET FACTORY_PROXY_PORT FACTORY_AGENT_MODELS FACTORY_LEAD_MAX_OUTPUT_TOKENS
# --api-models turns on the loopback model proxy only for api-agent agents (no OpenCode, no sandbox).
if [ -n "$API_MODELS" ]; then export FACTORY_AGENT_MODELS="$API_MODELS"; fi
mkdir -p "$ROOT/workspaces" "$ROOT/worktrees" "$ROOT/state"
export FACTORY_LOCAL_CLI=1 FACTORY_DEFAULT_AGENT_CLI="$AGENTS"
# Lead uses the local CLI login or the Host model gateway.
if [ "$LEAD" = claude ]; then export FACTORY_LEAD_CLI=claude; else unset FACTORY_LEAD_CLI; fi
# Loopback only: no sign-in, the Host gives the browser a session by itself (FACTORY_OPEN_LOGIN=0 brings the one-time token back).
# Network access: FACTORY_LISTEN_HOST=<one IP address of this machine> needs FACTORY_LOGIN_TOKEN (24+ characters you choose; it
# signs in any number of times) and turns open login off. FACTORY_ALLOWED_HOSTS=name1,name2 adds names used in the browser address.
case "${FACTORY_LISTEN_HOST:-127.0.0.1}" in 127.0.0.1|::1) export FACTORY_OPEN_LOGIN="${FACTORY_OPEN_LOGIN:-1}" ;; *) export FACTORY_OPEN_LOGIN=0 ;; esac
export FACTORY_LEAD_TIMEOUT_SECONDS="${FACTORY_LEAD_TIMEOUT_SECONDS:-600}"
export FACTORY_STATE_DIR="${FACTORY_STATE_DIR:-$ROOT/state}"
export FACTORY_PROJECTS_ROOT="${FACTORY_PROJECTS_ROOT:-$ROOT/workspaces}"
export FACTORY_WORKTREES_ROOT="${FACTORY_WORKTREES_ROOT:-$ROOT/worktrees}"
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
echo "Agent slots: $FACTORY_NODE_SLOTS. Lead chat: $([ "$LEAD" = claude ] && echo "Claude Code CLI" || echo "model gateway"). Token budget: not limited."
case "${FACTORY_LISTEN_HOST:-127.0.0.1}" in
  127.0.0.1|::1) echo "Starting on http://127.0.0.1:${FACTORY_PORT}/ (loopback only). Stop with Ctrl+C." ;;
  *) echo "Starting on http://${FACTORY_LISTEN_HOST}:${FACTORY_PORT}/ (network access: sign in with FACTORY_LOGIN_TOKEN). Stop with Ctrl+C." ;;
esac
exec node "$ROOT/app/apps/factory-host/dist/main.js"
