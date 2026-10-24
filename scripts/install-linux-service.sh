#!/bin/sh
set -e
APP="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "Node.js not found. Install Node 18+ first (see HOSTING.md)."; exit 1; }
[ -f "$APP/rustplus.config.json" ] || echo "Warning: no rustplus.config.json yet - copy it from your PC (see HOSTING.md) or pairing/alerts won't work."

mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/scrapscout.service" <<UNIT
[Unit]
Description=ScrapScout (Rust+ companion)
After=network-online.target

[Service]
WorkingDirectory=$APP
ExecStart=$NODE $APP/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now scrapscout.service
loginctl enable-linger "$USER" 2>/dev/null || sudo loginctl enable-linger "$USER"
echo
echo "Running. Logs:    journalctl --user -u scrapscout -f"
echo "Restart:          systemctl --user restart scrapscout"
echo "Open the UI from your PC with an SSH tunnel:  ssh -L 3000:localhost:3000 $USER@<server-ip>   then browse http://localhost:3000"
