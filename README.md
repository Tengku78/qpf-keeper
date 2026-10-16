# QPF Keeper

Keeps a QuantumProof testnet validator online on macOS or Linux (laptop or VPS) and reports to Discord.

QuantumProof's testnet resets often, and a validator that stays registered while its node is down loses 4 points per missed proposer slot. QPF Keeper runs the official `qpf-node.js` in the background, restarts it and re-registers after every reset, and tells you what is happening.

## What you get

- **Auto-restart.** After a chain reset the node is restarted at once and re-registers by itself; if it signs nothing for 60 seconds for any other reason (crash, site down), it is restarted too. Starts automatically (at login on macOS, at boot on Linux) and keeps a Mac awake.
- **Discord alerts** (optional):
  - 🔴 offline for 3 minutes, 🟢 back online after every restart (with downtime)
  - ⚠️ every missed proposer slot (−4 points)
  - 🔄 chain reset detected
  - 📈 / 📉 leaderboard rank changes, with the gap to the validators above and below you
  - 📊 a daily report: rank, points gained in 24 h, uptime %, restarts, resets, blocks proposed and attested
  - 🆕 the official `qpf-node.js` changed on the site (never installed automatically)
- **Tamper check.** The keeper fingerprints `qpf-node.js` and refuses to run it if it changes on your computer.
- **Log cleanup.** `node.log` is cleared once it passes 5 MB.

## Requirements

- **macOS**, or **Linux with systemd** (Ubuntu, Debian, Fedora… including a cheap VPS)
- **Node.js 24 or newer** (`node -v`). macOS: nodejs.org. Linux: install [nvm](https://github.com/nvm-sh/nvm), then `nvm install 24`

## Install

```
bash ~/Downloads/qpf-keeper/install.sh   # or wherever you unzipped it
```

On a Linux server:

```
git clone https://github.com/Tengku78/qpf-keeper && bash qpf-keeper/install.sh
```

No sudo needed. On Linux, if the installer prints a `sudo loginctl enable-linger` line, run it once so the keeper keeps running after you close SSH.

It asks for a validator name (first time only) and, optionally, a Discord webhook URL (Discord: Server Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL). Running it again upgrades in place and keeps your key and settings.

Watch it work: `tail -f ~/qpf/node.log` · Linux status: `systemctl --user status qpf-keeper`

## Uninstall

```
bash ~/Downloads/qpf-keeper/uninstall.sh
```

Stops the keeper, leaves the validator set cleanly so you are not penalised, and removes the startup file. Your key stays in `~/qpf`.

## Settings

`~/qpf/keeper.config.json`, all optional:

| Setting | Default | Meaning |
|---|---|---|
| `summaryHour` | `9` | Hour (local time) for the daily report |
| `restartAfterSec` | `60` | Restart the node after this many seconds without a signature |
| `alertAfterSec` | `180` | Send the offline alert after this long |
| `rankAlerts`, `missAlerts`, `resetAlerts`, `updateWatch` | `true` | Turn individual alerts off with `false` |
| `maxLogMB` | `5` | Clear `node.log` above this size |

After editing, restart:
- macOS: `launchctl kickstart -k gui/$(id -u)/net.quantumproof.keeper`
- Linux: `systemctl --user restart qpf-keeper`

## Safety

- Everything lives in `~/qpf` plus one startup file: `~/Library/LaunchAgents/net.quantumproof.keeper.plist` on macOS, `~/.config/systemd/user/qpf-keeper.service` on Linux. No admin password, no system settings.
- The keeper only **reads** from quantumproofchain.net (`/api/points`, `/rpc`, `/qpf-node.js`). The only thing it sends is messages to your own Discord webhook.
- It reads your validator **address** from `qpf-validator.json`. The private key is only ever used by the official `qpf-node.js`.
- It never downloads or installs updates by itself.
- Single file, under 200 lines: read `qpf-keeper.js` before you run it.

Unofficial community tool, not made by the QuantumProof team. Testnet only.
