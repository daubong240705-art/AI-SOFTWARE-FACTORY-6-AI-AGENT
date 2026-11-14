#!/bin/bash
# Prepares an Ubuntu machine to run the Factory Host with Codex on 9Router: no Claude login and no Codex login.
# Run it as your normal user (not root). sudo is used only for packages, the Chrome package, the CA certificate and linger.
# Safe to run again. It does not start the Host: copy the app first (see "Next" at the end).
#
#   bash ubuntu-factory-machine.sh
#   LISTEN_HOST=192.168.1.12 ALLOW_FROM="192.168.1.0/24" bash ubuntu-factory-machine.sh    # also open the UI on that address
#
# Network access (optional, LISTEN_HOST): the Host then listens on that one address instead of loopback only, asks for a sign-in
# token (FACTORY_LOGIN_TOKEN, generated here, stored in the environment file) and ufw lets ALLOW_FROM reach port 8787. Anyone who
# signs in controls this machine (agents run with your permissions): allow only networks you trust.
#
# Needs, before it runs:
#   $FACTORY_V2_HOME/caddy-root.crt   the root certificate of the Caddy that serves ai.lazy.local (public, not a secret)
#   ~/.config/factory/env             a file (mode 600) with a line NINE_ROUTER_API_KEY=...
set -euo pipefail
ROOT="${FACTORY_V2_HOME:-$HOME/factory-v2}"
NODE_VERSION="${NODE_VERSION:-22.23.4}"
CODEX_VERSION="${CODEX_VERSION:-0.166.0}"
CA_FILE="${CADDY_ROOT_CA:-$ROOT/caddy-root.crt}"
ENV_FILE="${FACTORY_ENV_FILE:-$HOME/.config/factory/env}"
GATEWAY_URL="${GATEWAY_URL:-https://ai.lazy.local/v1}"
PORTAL_URL="${FACTORY_PORTAL_URL:-http://192.168.1.14:8800}"
[ "$(id -u)" -ne 0 ] || { echo "Run this as your normal user, not as root." >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }

step "1/8 system packages (sudo)"
sudo apt-get update -y
sudo apt-get install -y git curl ca-certificates xz-utils rsync python3 tar

step "2/8 Google Chrome for the QA seat (sudo)"
if command -v google-chrome-stable >/dev/null 2>&1; then echo "already installed"; else
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/chrome.deb" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  sudo apt-get install -y "$tmp/chrome.deb"
  rm -rf "$tmp"
fi

step "3/8 Node $NODE_VERSION in $ROOT/node (no sudo)"
if [ -x "$ROOT/node/bin/node" ] && [ "$("$ROOT/node/bin/node" -v)" = "v$NODE_VERSION" ]; then echo "already installed"; else
  tmp="$(mktemp -d)"; file="node-v$NODE_VERSION-linux-x64.tar.xz"
  curl -fsSL -o "$tmp/$file" "https://nodejs.org/dist/v$NODE_VERSION/$file"
  curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c -)
  rm -rf "$ROOT/node"; mkdir -p "$ROOT/node"
  tar -xJf "$tmp/$file" -C "$ROOT/node" --strip-components=1
  rm -rf "$tmp"
fi
export PATH="$ROOT/node/bin:$HOME/.local/npm/bin:$PATH"
node -v

step "4/8 Codex CLI $CODEX_VERSION in ~/.local/npm (no sudo)"
npm config set prefix "$HOME/.local/npm"
npm install -g "@openai/codex@$CODEX_VERSION" --no-audit --no-fund
codex --version

step "5/8 trust the Caddy root certificate that signs $GATEWAY_URL (sudo)"
[ -f "$CA_FILE" ] || { echo "missing $CA_FILE: copy the Caddy root certificate there first" >&2; exit 1; }
sudo install -m 644 "$CA_FILE" /usr/local/share/ca-certificates/caddy-local-root.crt
sudo update-ca-certificates

step "6/8 Codex configuration for 9Router (no login)"
mkdir -p "$HOME/.codex"
if [ -f "$HOME/.codex/config.toml" ] && ! grep -q '^\[model_providers.9router\]' "$HOME/.codex/config.toml"; then
  cp "$HOME/.codex/config.toml" "$HOME/.codex/config.toml.bak.$(date +%s)"
fi
if grep -q '^\[model_providers.9router\]' "$HOME/.codex/config.toml" 2>/dev/null; then echo "9router provider already configured"; else
  cat >> "$HOME/.codex/config.toml" <<EOF
model = "gpt-6.1-sol"
model_provider = "9router"
model_reasoning_effort = "high"

[model_providers.9router]
name = "9Router"
base_url = "$GATEWAY_URL"
wire_api = "responses"
env_key = "NINE_ROUTER_API_KEY"
EOF
fi

step "7/8 folders and the environment file"
mkdir -p "$ROOT/state" "$ROOT/workspaces" "$ROOT/worktrees" "$(dirname "$ENV_FILE")"
[ -f "$ENV_FILE" ] || : > "$ENV_FILE"
chmod 600 "$ENV_FILE"
ensure() { grep -q "^$1=" "$ENV_FILE" || echo "$1=$2" >> "$ENV_FILE"; }
ensure FACTORY_GAME_STARTER_DIR "$ROOT/game-starter"
ensure FACTORY_PORTAL_URL "$PORTAL_URL"
ensure FACTORY_PORTAL_ALLOW_PRIVATE_HTTP 1
ensure FACTORY_NODE_SLOTS "${SLOTS:-3}"
# Node (the Host and its Lead gateway) does not use the system certificate store: give it the CA that signs the 9Router address.
ensure NODE_EXTRA_CA_CERTS "$CA_FILE"
if [ -n "${LISTEN_HOST:-}" ]; then
  ensure FACTORY_LISTEN_HOST "$LISTEN_HOST"
  grep -q '^FACTORY_LOGIN_TOKEN=.' "$ENV_FILE" || echo "FACTORY_LOGIN_TOKEN=$(openssl rand -base64 48 | tr -d '/+=' | head -c 32)" >> "$ENV_FILE"
  for net in ${ALLOW_FROM:-192.168.1.0/24}; do sudo ufw allow from "$net" to any port 8787 proto tcp comment 'factory ui'; done
  echo "Network access on $LISTEN_HOST:8787. The sign-in token is the line FACTORY_LOGIN_TOKEN in $ENV_FILE"
fi
grep -q '^NINE_ROUTER_API_KEY=.' "$ENV_FILE" && echo "NINE_ROUTER_API_KEY: present (value not shown)" || echo "WARNING: NINE_ROUTER_API_KEY is missing in $ENV_FILE"
grep -q '^FACTORY_PORTAL_TOKEN=.' "$ENV_FILE" && echo "FACTORY_PORTAL_TOKEN: present (value not shown)" \
  || echo "NOTE: add FACTORY_PORTAL_TOKEN=<the token in /etc/game-portal.env on the Portal machine> to $ENV_FILE to enable Publish"

step "8/8 systemd user service (starts at boot, no login needed)"
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/factory-host.service" <<EOF
[Unit]
Description=Factory Host (game factory)
After=network-online.target

[Service]
Environment=FACTORY_V2_HOME=$ROOT
ExecStart=/bin/bash $ROOT/start-host-cli.sh --agents codex --lead 9router --slots ${SLOTS:-3}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
sudo loginctl enable-linger "$USER"

echo
echo "Check that 9Router is reachable with the certificate (prints only a status code):"
echo "  curl -sS --cacert $CA_FILE -o /dev/null -w '%{http_code}\n' $GATEWAY_URL/models    # 401 without a key is correct"
echo
echo "Next: copy the app (from the machine that built it), then start the Host:"
echo "  systemctl --user enable --now factory-host && journalctl --user -u factory-host -f"
echo "  open it through an SSH tunnel:  ssh -L 8787:127.0.0.1:8787 $USER@<this machine>   then   http://127.0.0.1:8787"
