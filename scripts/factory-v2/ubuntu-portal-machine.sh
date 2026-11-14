#!/bin/bash
# Prepares an Ubuntu machine to run the Game Portal as its own unprivileged service. It listens on one LAN address so that a
# Cloudflare Tunnel on another machine and the Factory can reach it. Run as your normal user (sudo is used where needed).
# Safe to run again. Copy the Portal sources to $PORTAL_SRC first (see the commands at the end of the Factory instructions).
#
#   FACTORY_IP=192.168.1.12 TUNNEL_IP=<ip of the machine running the tunnel> bash ubuntu-portal-machine.sh
#
# What it sets up: a system user "portal" (no shell, not in the docker group), Node in /opt, the app in /opt/game-portal,
# data in /var/lib/game-portal, a systemd unit with limits, ufw rules for the Factory and the tunnel, and a firewall rule
# that stops the portal user from opening ANY new outgoing connection (IPv4 and IPv6). The Portal only answers incoming
# connections, which are not affected. Game rules written by agents run inside the Portal and the Node permission model
# does not block the network, so this rule keeps them away from every other service: the LAN, Docker containers (their
# published ports are redirected before a filter on the LAN address would see them), loopback and the internet.
set -euo pipefail
NODE_VERSION="${NODE_VERSION:-22.23.4}"
APP=/opt/game-portal
DATA=/var/lib/game-portal
ENVF=/etc/game-portal.env
SRC="${PORTAL_SRC:-$HOME/game-portal-src}"
PORT="${PORTAL_PORT:-8800}"
LISTEN_IP="${LISTEN_IP:-$(hostname -I | awk '{print $1}')}"
FACTORY_IP="${FACTORY_IP:?set FACTORY_IP to the address of the Factory machine}"
TUNNEL_IP="${TUNNEL_IP:-}"
[ "$(id -u)" -ne 0 ] || { echo "Run this as your normal user, not as root." >&2; exit 1; }
[ -f "$SRC/package.json" ] || { echo "Portal sources not found in $SRC (set PORTAL_SRC or copy them first)." >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }

step "1/7 packages (sudo)"
sudo apt-get update -y
sudo apt-get install -y curl xz-utils rsync ca-certificates iptables

step "2/7 Node $NODE_VERSION in /opt (sudo)"
NODE_DIR="/opt/node-$NODE_VERSION"
if [ -x "$NODE_DIR/bin/node" ]; then echo "already installed"; else
  tmp="$(mktemp -d)"; file="node-v$NODE_VERSION-linux-x64.tar.xz"
  curl -fsSL -o "$tmp/$file" "https://nodejs.org/dist/v$NODE_VERSION/$file"
  curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c -)
  sudo mkdir -p "$NODE_DIR"
  sudo tar -xJf "$tmp/$file" -C "$NODE_DIR" --strip-components=1
  rm -rf "$tmp"
fi

step "3/7 user, folders and the application"
id portal >/dev/null 2>&1 || sudo useradd --system --no-create-home --shell /usr/sbin/nologin portal
sudo install -d -o portal -g portal -m 750 "$DATA" "$APP" "$APP/.home"
sudo rsync -a --delete --exclude node_modules --exclude data --exclude .git --exclude web/dist --exclude .home "$SRC"/ "$APP"/
sudo chown -R portal:portal "$APP"
run_as_portal() { sudo -u portal env HOME="$APP/.home" PATH="$NODE_DIR/bin:/usr/bin:/bin" bash -c "cd $APP && $*"; }
# --ignore-scripts: better-sqlite3 ships its Linux x64 binary inside the package; its install step would try to compile it (needs make).
run_as_portal "npm ci --ignore-scripts --no-audit --no-fund"
run_as_portal "npm run web:build"

step "4/7 environment file $ENVF (sudo, mode 600)"
if sudo test -f "$ENVF"; then echo "kept the existing file"; else
  token="$(openssl rand -base64 48 | tr -d '/+=' | head -c 40)"
  sudo install -m 600 -o root -g root /dev/null "$ENVF"
  printf '%s\n' "PORTAL_HOST=$LISTEN_IP" "PORTAL_PORT=$PORT" "PORTAL_ALLOW_PUBLIC=1" "PORTAL_COOKIE_SECURE=1" \
    "PORTAL_DATA_DIR=$DATA" "PORTAL_PUBLISH_TOKEN=$token" | sudo tee "$ENVF" >/dev/null
fi

step "5/7 systemd unit (sudo)"
sudo tee /etc/systemd/system/game-portal.service >/dev/null <<EOF
[Unit]
Description=Game Portal
After=network-online.target

[Service]
User=portal
Group=portal
WorkingDirectory=$APP
EnvironmentFile=$ENVF
# The portal user may not open NEW outgoing connections (answers to incoming connections are ESTABLISHED and unaffected).
ExecStartPre=+/bin/sh -c 'for t in iptables ip6tables; do command -v \$\$t >/dev/null || continue; \$\$t -C OUTPUT -m owner --uid-owner portal -m conntrack --ctstate NEW -j REJECT 2>/dev/null || \$\$t -I OUTPUT -m owner --uid-owner portal -m conntrack --ctstate NEW -j REJECT; done'
ExecStart=$NODE_DIR/bin/node server/src/main.ts
Restart=on-failure
RestartSec=3
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=$DATA
MemoryMax=768M
TasksMax=256

[Install]
WantedBy=multi-user.target
EOF

step "6/7 firewall (sudo)"
sudo ufw allow from "$FACTORY_IP" to any port "$PORT" proto tcp comment 'game-portal: factory publishes'
if [ -n "$TUNNEL_IP" ]; then sudo ufw allow from "$TUNNEL_IP" to any port "$PORT" proto tcp comment 'game-portal: tunnel'
else echo "NOTE: TUNNEL_IP not set, so nothing allows the tunnel machine yet: sudo ufw allow from <tunnel ip> to any port $PORT proto tcp"; fi

step "7/7 start"
sudo systemctl daemon-reload
sudo systemctl enable game-portal
sudo systemctl restart game-portal
sleep 3
echo "listening: $(sudo ss -ltnp 2>/dev/null | grep ":$PORT " | awk '{print $4}' | head -1)"
echo "answer:    $(curl -sS -m 5 -o /dev/null -w 'http %{http_code}' "http://$LISTEN_IP:$PORT/api/games" || echo 'no answer')"

echo
echo "Done. Point the tunnel origin at   http://$LISTEN_IP:$PORT"
echo "In the tunnel configuration, do NOT expose the publish API to the internet: answer 404 for the path /api/publish*"
echo "The publish token is in $ENVF (read it with: sudo cat $ENVF). Give the same value to the Factory as FACTORY_PORTAL_TOKEN."
