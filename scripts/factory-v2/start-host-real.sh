#!/bin/bash
# Starts the deployed Factory Host with the REAL OpenCode runtime (agents run in a bubblewrap sandbox and call the
# model through the Host's loopback proxy). It spends real tokens, so it refuses to start without an explicit model
# and an explicit key from YOUR environment. Nothing secret is written to disk or printed.
#
#   export NINE_ROUTER_API_KEY=...                       # only in this shell
#   FACTORY_AGENT_MODELS=<model[,model]> bash scripts/factory-v2/start-host-real.sh
#   bash scripts/factory-v2/start-host-real.sh --check   # verify prerequisites, start nothing, spend nothing
#
# Optional: FACTORY_LEAD_MODEL, FACTORY_LEAD_EFFORT, FACTORY_MULTI_TEAM=1 (more than the default team),
#           FACTORY_BUDGET_TASK_TOKENS (default here 500000), FACTORY_BUDGET_DAY_TOKENS (default here 2000000),
#           FACTORY_PORT (default 8787), FACTORY_STATE_DIR (default ~/factory-v2/state).
# Run `bash scripts/factory-v2/deploy-host-wsl.sh` first so the app and the UI build are on ext4.
set -u
ROOT="${FACTORY_V2_HOME:-$HOME/factory-v2}"
CHECK=0; [ "${1:-}" = "--check" ] && CHECK=1
fail=0
ok()   { echo "  ok    $*"; }
bad()  { echo "  MISSING  $*" >&2; fail=1; }

echo "Factory Host (real OpenCode runtime) preflight"
export PATH="$ROOT/node/bin:$PATH"
command -v node >/dev/null 2>&1 && ok "node $(node --version)" || bad "node (expected $ROOT/node/bin/node)"
[ -f "$ROOT/app/apps/factory-host/dist/main.js" ] && ok "deployed Host build" || bad "Host build: run scripts/factory-v2/deploy-host-wsl.sh"
[ -f "$ROOT/app/apps/factory-ui/dist/index.html" ] && ok "UI build" || bad "UI build: run npm run build in apps/factory-ui, then redeploy"
command -v bwrap >/dev/null 2>&1 && ok "bubblewrap" || bad "bubblewrap (bwrap)"
[ -x "$ROOT/opencode/bin/opencode" ] && ok "OpenCode $("$ROOT/opencode/bin/opencode" --version 2>/dev/null | head -1)" || bad "OpenCode at $ROOT/opencode/bin/opencode"
[ -f "$ROOT/ca/caddy-root.crt" ] && ok "gateway CA certificate" || bad "CA certificate $ROOT/ca/caddy-root.crt"
[ -n "${NINE_ROUTER_API_KEY:-}" ] && ok "NINE_ROUTER_API_KEY is set (value not shown)" || bad "NINE_ROUTER_API_KEY is not set in this shell"
[ -n "${FACTORY_AGENT_MODELS:-}" ] && ok "agent models: ${FACTORY_AGENT_MODELS}" || bad "FACTORY_AGENT_MODELS (no default on purpose: you choose the model)"
case "$ROOT" in /mnt/*) bad "FACTORY_V2_HOME must not be under /mnt";; esac
GATEWAY="${FACTORY_GATEWAY_URL:-https://ai.lazy.local/v1}"
ok "gateway $GATEWAY"
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
echo "Starting on http://127.0.0.1:${FACTORY_PORT}/ (loopback only). Budget: ${FACTORY_BUDGET_TASK_TOKENS} tokens/task, ${FACTORY_BUDGET_DAY_TOKENS}/day."
echo "The one-time sign-in token is printed below; stop with Ctrl+C."
exec node "$ROOT/app/apps/factory-host/dist/main.js"
