# Running ScrapScout 24/7

Everything that matters while you're away runs inside the app's backend, not the browser tab:
alerts (raids/smart alarms, deaths, tracked players joining, decay timers, TC upkeep, wipes) go to
**Discord** through the webhook or the bot, and the Discord bot answers commands. So for 24/7 you only
need the backend running somewhere that stays on. You don't need a browser open.

Pick one:

| Option | Cost | Effort |
|---|---|---|
| A. Your own PC, started hidden at login | free | 1 minute |
| B. A small Linux server (Oracle Cloud free tier, a Raspberry Pi, an old laptop) | free–cheap | 20 minutes |

Run **only one copy at a time** with the same Rust+ login. Two copies fight over the push connection,
and you'd get double alerts.

---

## A. Your own PC (Windows)

**Desktop app:** nothing to do. It starts with Windows and runs in the tray (tray icon → *Start with Windows* to
switch it off). The steps below are for the zip version.

1. Set up Discord first (Settings → *Discord webhook* and/or *Discord bot*, see SETUP.md) so alerts reach your phone.
2. Close any open `start.bat` window.
3. Double-click **`autostart-on.bat`**.
   The app starts now with no window, and again every time you log in to Windows.
4. Open http://localhost:3000 whenever you want the map.

- **Stop it:** `stop.bat`
- **Start it again without rebooting:** double-click `start-background.vbs`
- **Turn autostart off:** `autostart-off.bat`
- **Logs:** `data\app.log`

This only runs while the PC is on and logged in. Set Windows *Power → Sleep* to *Never* if you want it to keep running.

---

## B. A Linux server

### 1. Get a server

- **Oracle Cloud Always Free:** an Ampere (ARM) VM with Ubuntu. Free forever, plenty of power.
- **Raspberry Pi 3/4/5** with Raspberry Pi OS, or any old PC/laptop running Ubuntu/Debian.
- Any $4–6/month VPS (Hetzner, DigitalOcean, …) works too.

You need SSH access to it (`ssh user@server-ip`).

### 2. Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 3. Copy the app over

Linking Steam needs a desktop browser, so do the setup on your **PC first** (setup.bat, pair your server,
fill in Settings). Then copy the whole folder, **including your private files**, to the server:

```bash
scp -r "C:/Users/<you>/Documents/ScrapScout" user@server-ip:~/ScrapScout
```

The private files are `rustplus.config.json` (your Rust+ login), `config.json` (keys, Discord) and `data/`
(paired servers, pins, tracked players). Only copy them to a machine you control.

Then on the server:

```bash
cd ~/ScrapScout
rm -rf node_modules
npm install --omit=dev
```

### 4. Run it as a service

```bash
sh scripts/install-linux-service.sh
```

It starts now, restarts if it crashes, and starts again after a reboot.

- **Logs:** `journalctl --user -u scrapscout -f`
- **Restart** (after changing config.json): `systemctl --user restart scrapscout`
- **Stop:** `systemctl --user stop scrapscout`

### 5. Look at the map

The web page only listens on the server itself, so nobody else can reach it. From your PC, open a tunnel:

```bash
ssh -L 3000:localhost:3000 user@server-ip
```

Leave that open and browse to http://localhost:3000 on your PC. Close the tunnel when you're done; the app keeps running.

### Pairing new servers later

In game: **ESC → Rust+ → Pair with server**. The pairing push reaches the server copy the same way it reached
your PC, so it shows up there by itself. Check with `journalctl --user -u scrapscout -f`.

If the log says the Rust+ credentials expired, run `setup.bat` on your PC again and copy the new
`rustplus.config.json` to the server, then `systemctl --user restart scrapscout`.

---

## What works without a browser open

| Works 24/7 in the backend | Needs the page open |
|---|---|
| All Discord alerts (webhook or bot) | Toast pop-ups and desktop notifications |
| Discord bot commands | The map itself |
| In-game team chat bot (`!pop`, `!sw`, …) | OCR screenshot scanning (runs in the browser) |
| Decay timer and TC upkeep warnings | |
| Tracked players (joins/leaves, history) | |
| Team, deaths, killers, smart devices, pop/wipe watch | |
