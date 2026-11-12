#!/bin/bash
# Starts the deployed Factory Host with the REAL OpenCode runtime (agents run in a bubblewrap sandbox and call the
# model through the Host's loopback proxy). It spends real tokens, so it refuses to start without an explicit model
# and an explicit key from YOUR environment. Nothing secret is written to disk or printed.
#
#   export NINE_ROUTER_API_KEY=...                       # only in this shell
#   FACTORY_AGENT_MODELS=<model[,model]> bash scripts/factory-v2/start-host-real.sh
#   bash scripts/factory-v2/start-host-real.sh --check   # verify prerequisites, start nothing, spend nothing
#   bash scripts/factory-v2/start-host-real.sh --agents codex   # seats of the team run on the Codex CLI unless you configured them otherwise (or claude)
#   bash scripts/factory-v2/start-host-real.sh --slots 8        # agents running at the same time (default: from cores and RAM)
#   bash scripts/factory-v2/start-host-real.sh --local-cli  # enable local Codex/Claude attempts (full operator permissions)
#
# Optional: FACTORY_LEAD_MODEL, FACTORY_LEAD_EFFORT, FACTORY_MULTI_TEAM=1 (more than the default team),
#           FACTORY_BUDGET_TASK_TOKENS (default here 500000), FACTORY_BUDGET_DAY_TOKENS (default here 2000000),
#           FACTORY_PORT (default 8787), FACTORY_STATE_DIR (default ~/factory-v2/state).
# Run `bash scripts/factory-v2/deploy-host-wsl.sh` first so the app and the UI build are on ext4.
set -u
ROOT="${FACTORY_V2_HOME:-$HOME/factory-v2}"
CHECK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=1 ;;
    --local-cli) export FACTORY_LOCAL_CLI=1
      echo "WARNING: local CLI agents run with the operator's full permissions." >&2 ;;
    --agents) shift; case "${1:-}" in
        codex|claude) export FACTORY_LOCAL_CLI=1 FACTORY_DEFAULT_AGENT_CLI="$1"
          echo "WARNING: seats without an override run on the $1 CLI with the operator's full permissions." >&2 ;;
        opencode) ;;
        *) echo "--agents needs codex, claude or opencode" >&2; exit 1 ;;
      esac ;;
    --slots) shift; export FACTORY_NODE_SLOTS="${1:-}" ;;
    *) echo "Usage: $0 [--check] [--local-cli] [--agents codex|claude|opencode] [--slots N]" >&2; exit 1 ;;
  esac
  shift
done
fail=0
ok()   { echo "  ok    $*"; }
bad()  { echo "  MISSING  $*" >&2; fail=1; }

echo "Factory Host (real OpenCode runtime) preflight"
export PATH="$ROOT/node/bin:$HOME/.local/bin:$PATH"
command -v node >/dev/null 2>&1 && ok "node $(node --version)" || bad "node (expected $ROOT/node/bin/node)"
[ -f "$ROOT/app/apps/factory-host/dist/main.js" ] && ok "deployed Host build ($(tr '
' ' ' < "$ROOT/app/VERSION" 2>/dev/null))" || bad "Host build: run scripts/factory-v2/deploy-host-wsl.sh"
[ -f "$ROOT/app/apps/factory-ui/dist/index.html" ] && ok "UI build" || bad "UI build: run npm run build in apps/factory-ui, then redeploy"
command -v bwrap >/dev/null 2>&1 && ok "bubblewrap" || bad "bubblewrap (bwrap)"
[ -x "$ROOT/opencode/bin/opencode" ] && ok "OpenCode $("$ROOT/opencode/bin/opencode" --version 2>/dev/null | head -1)" || bad "OpenCode at $ROOT/opencode/bin/opencode"
[ -f "$ROOT/ca/caddy-root.crt" ] && ok "gateway CA certificate" || bad "CA certificate $ROOT/ca/caddy-root.crt"
[ -n "${NINE_ROUTER_API_KEY:-}" ] && ok "NINE_ROUTER_API_KEY is set (value not shown)" || bad "NINE_ROUTER_API_KEY is not set in this shell"
[ -n "${FACTORY_AGENT_MODELS:-}" ] && ok "agent models: ${FACTORY_AGENT_MODELS}" || bad "FACTORY_AGENT_MODELS (no default on purpose: you choose the model)"
case "$ROOT" in /mnt/*) bad "FACTORY_V2_HOME must not be under /mnt";; esac
if [ "${FACTORY_LOCAL_CLI:-0}" = "1" ]; then
  for cli in codex claude; do
    if command -v "$cli" >/dev/null 2>&1; then ok "$cli $("$cli" --version 2>/dev/null | head -1) (login status is shown on the System page)"
    else bad "$cli CLI not found in PATH (install it inside WSL and log in)"; fi
  done
fi
GATEWAY="${FACTORY_GATEWAY_URL:-https://ai.lazy.local/v1}"
ok "gateway $GATEWAY"
# With a key and a model chosen, ask the gateway which models it offers (a free listing call: no tokens are spent).
if [ "$fail" -eq 0 ]; then
  LIST="$(curl -sS --max-time 20 --cacert "$ROOT/ca/caddy-root.crt" -H "Authorization: Bearer $NINE_ROUTER_API_KEY" "$GATEWAY/models" 2>/dev/null || true)"
  if printf '%s' "$LIST" | grep -qiE '"error"|unauthori|invalid api|forbidden'; then bad "the gateway rejected the key (check NINE_ROUTER_API_KEY)"
  elif [ -n "$LIST" ]; then
    for model in $(echo "${FACTORY_AGENT_MODELS}${FACTORY_LEAD_MODEL:+,$FACTORY_LEAD_MODEL}" | tr ',' ' '); do
      if printf '%s' "$LIST" | grep -q "\"$model\""; then ok "gateway offers $model"; else bad "gateway does not list $model (check the spelling)"; fi
    done
  else echo "  note  could not list models from the gateway (network or key); continuing" >&2; fi
fi
if [ "$fail" -ne 0 ]; then echo "Preflight failed: nothing started." >&2; exit 1; fi
if [ "$CHECK" -eq 1 ]; then echo "Preflight passed. Start without --check to run the Host."; exit 0; fi

mkdir -p "$ROOT/proxy" "$ROOT/workspaces" "$ROOT/worktrees" "$ROOT/state"
chmod 700 "$ROOT/proxy"
export NODE_EXTRA_CA_CERTS="$ROOT/ca/caddy-root.crt"
export FACTORY_RUNTIME=opencode
export FACTORY_OPENCODE_DIR="$ROOT/opencode"
export FACTORY_PROXY_SOCKET="$ROOT/proxy/model.sock"
export FACTORY_GATEWAY_URL="$GATEWAY"
export FACTORY_STATE_DIR="${FACTORY_STATE_DIR:-$ROOT/state}"
export FACTORY_PROJECTS_ROOT="${FACTORY_PROJECTS_ROOT:-$ROOT/workspaces}"
export FACTORY_WORKTREES_ROOT="${FACTORY_WORKTREES_ROOT:-$ROOT/worktrees}"
export FACTORY_PORT="${FACTORY_PORT:-8787}"
export FACTORY_BUDGET_TASK_TOKENS="${FACTORY_BUDGET_TASK_TOKENS:-500000}"
export FACTORY_BUDGET_DAY_TOKENS="${FACTORY_BUDGET_DAY_TOKENS:-2000000}"
# Agent slots follow the hardware unless you set them: cores and about 1.2 GB of available RAM per agent, 2 to 16.
if [ -z "${FACTORY_NODE_SLOTS:-}" ]; then
  CORES="$(nproc 2>/dev/null || echo 2)"; MEM_MB="$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 2400)"
  AUTO=$(( MEM_MB / 1200 )); [ "$CORES" -lt "$AUTO" ] && AUTO="$CORES"; [ "$AUTO" -lt 2 ] && AUTO=2; [ "$AUTO" -gt 16 ] && AUTO=16
  export FACTORY_NODE_SLOTS="$AUTO"
fi
echo "Agent slots: $FACTORY_NODE_SLOTS (override with --slots N or FACTORY_NODE_SLOTS)."
echo "Starting on http://127.0.0.1:${FACTORY_PORT}/ (loopback only). Budget: ${FACTORY_BUDGET_TASK_TOKENS} tokens/task, ${FACTORY_BUDGET_DAY_TOKENS}/day."
echo "The one-time sign-in token is printed below; stop with Ctrl+C."
exec node "$ROOT/app/apps/factory-host/dist/main.js"
