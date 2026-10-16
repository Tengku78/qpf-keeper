#!/bin/bash
# QPF Keeper uninstaller for macOS. Stops the keeper, leaves the validator set cleanly
# (no missed-slot penalties) and removes the startup file. Your ~/qpf folder and key stay.
set -uo pipefail
DIR="$HOME/qpf"

for LABEL in net.quantumproof.keeper net.quantumproof.qude; do
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null && echo "  ✅ Stopped $LABEL"
  rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
done
pkill -f "$DIR/qpf-node.js" 2>/dev/null || true
sleep 2

if [ -f "$DIR/qpf-validator.json" ]; then
  (cd "$DIR" && node qpf-node.js --exit) && echo "  ✅ Left the validator set (stake returned)"
fi
echo "  ✅ Removed. Your key is still in ~/qpf/qpf-validator.json; delete the folder yourself if you no longer need it."
