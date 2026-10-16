#!/bin/bash
# QPF Keeper installer for macOS and Linux. Safe to run again: it upgrades in place and keeps your key and settings.
# What it touches: the folder ~/qpf and one startup file
#   macOS: ~/Library/LaunchAgents/net.quantumproof.keeper.plist
#   Linux: ~/.config/systemd/user/qpf-keeper.service
# Nothing else. No sudo needed.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DIR="$HOME/qpf"
LABEL="net.quantumproof.keeper"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/qpf-keeper.service"
SITE="https://quantumproofchain.net"
OS="$(uname)"

say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  ✅ %s\n' "$1"; }
fail() { printf '  ❌ %s\n' "$1"; exit 1; }

say "QPF Keeper installer"

# 1. Checks
case "$OS" in
  Darwin) ok "macOS" ;;
  Linux)  command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1 \
            || fail "This Linux has no systemd user session (common in Docker/WSL1). Run the keeper by hand instead: cd ~/qpf && nohup node qpf-keeper.js >> node.log 2>&1 &"
          ok "Linux with systemd" ;;
  *)      fail "This installer supports macOS and Linux. On other systems run: node ~/qpf/qpf-keeper.js" ;;
esac
NODE="$(command -v node || true)"
[ -n "$NODE" ] || fail "Node.js is not installed. Install Node 24 or newer (nodejs.org, or on Linux: https://github.com/nvm-sh/nvm then 'nvm install 24'), then run this again."
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 24 ] || fail "Node $("$NODE" -v) is too old. The validator needs Node 24 or newer."
ok "Node $("$NODE" -v) at $NODE"

mkdir -p "$DIR"

# 2. Validator script
if [ ! -f "$DIR/qpf-node.js" ]; then
  say "Downloading the official validator script"
  curl -fsSL "$SITE/qpf-node.js" -o "$DIR/qpf-node.js" || fail "Could not download $SITE/qpf-node.js"
  ok "Saved $DIR/qpf-node.js ($(wc -l < "$DIR/qpf-node.js" | tr -d ' ') lines). Read it before trusting it: open -e ~/qpf/qpf-node.js"
else
  ok "Validator script already in place"
fi

# 3. Keeper
cp "$SRC/qpf-keeper.js" "$DIR/qpf-keeper.js"
ok "Keeper installed"

# 4. Validator name (only needed the very first time; an existing key keeps its name)
if [ -f "$DIR/qpf-validator.json" ]; then
  NAME="$("$NODE" -p "require('$DIR/qpf-validator.json').name")"
  ok "Existing validator key found: $NAME"
else
  while true; do
    read -r -p "  Choose a validator name (2-24 letters, digits, space . _ -): " NAME || fail "No name given."
    [[ "$NAME" =~ ^[A-Za-z0-9\ ._-]{2,24}$ ]] && break
    echo "  That name is not allowed, try again."
  done
fi

# 5. Settings (kept if they already exist)
if [ ! -f "$DIR/keeper.config.json" ]; then
  NAME="$NAME" "$NODE" -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({name: process.env.NAME, summaryHour: 9}, null, 2))' "$DIR/keeper.config.json"
  ok "Settings created: ~/qpf/keeper.config.json"
else
  ok "Settings kept: ~/qpf/keeper.config.json"
fi

# 6. Discord webhook (optional)
if [ ! -s "$DIR/discord-webhook.txt" ]; then
  echo
  echo "  Discord alerts are optional. In Discord: Server Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL."
  read -r -p "  Paste the webhook URL (or just press Return to skip): " HOOK || HOOK=""
  if [[ "$HOOK" =~ ^https://(discord|discordapp)\.com/api/webhooks/ ]]; then
    printf '%s\n' "$HOOK" > "$DIR/discord-webhook.txt"; chmod 600 "$DIR/discord-webhook.txt"
    ok "Webhook saved"
  else
    ok "No webhook, alerts disabled (you can add one later and run this again)"
  fi
else
  ok "Discord webhook already set"
fi

# 7. Approve the current validator script (tamper check)
"$NODE" "$DIR/qpf-keeper.js" --trust | sed 's/^/  ✅ /'

# 8. Install the background service
if [ "$OS" = "Linux" ]; then
  systemctl --user stop qpf-keeper 2>/dev/null || true
  pkill -f "$DIR/qpf-node.js" 2>/dev/null || true
  sleep 2
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT" <<EOF
[Unit]
Description=QPF Keeper (QuantumProof testnet validator)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=$DIR
ExecStart=$NODE $DIR/qpf-keeper.js
Restart=always
RestartSec=10
StandardOutput=append:$DIR/node.log
StandardError=append:$DIR/node.log

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now qpf-keeper >/dev/null 2>&1 || systemctl --user enable --now qpf-keeper
  ok "Running in the background (systemd user service qpf-keeper)"
  # Keep it running after you log out / close SSH, and start it at boot.
  if loginctl enable-linger "$USER" 2>/dev/null; then
    ok "Keeps running after logout and starts at boot"
  else
    printf '  ⚠️  To keep it running after you log out, run once:  sudo loginctl enable-linger %s\n' "$USER"
  fi
  say "Done"
  echo "  Watch it:   tail -f ~/qpf/node.log      (Control+C stops watching, not the node)"
  echo "  Status:     systemctl --user status qpf-keeper"
  echo "  Remove it:  bash \"$SRC/uninstall.sh\""
  exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents"
for OLD in net.quantumproof.qude "$LABEL"; do
  launchctl bootout "gui/$(id -u)/$OLD" 2>/dev/null || true
done
rm -f "$HOME/Library/LaunchAgents/net.quantumproof.qude.plist"
pkill -f "$DIR/qpf-node.js" 2>/dev/null || true
sleep 2

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/caffeinate</string><string>-i</string>
    <string>$NODE</string><string>$DIR/qpf-keeper.js</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/node.log</string>
  <key>StandardErrorPath</key><string>$DIR/node.log</string>
</dict></plist>
EOF
launchctl bootstrap "gui/$(id -u)" "$PLIST"
ok "Running in the background (starts automatically when you log in)"

say "Done"
echo "  Watch it:   tail -f ~/qpf/node.log      (Control+C stops watching, not the node)"
echo "  Remove it:  bash \"$SRC/uninstall.sh\""
