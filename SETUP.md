# ScrapScout — setup

A live Rust+ map for your team: teammates on the map, deaths, team chat + bot, smart switches/alarms, TC upkeep,
a server browser, resource filters and heatmaps, and raid / decay / crafting / recycle / breeding / power tools.
It runs on your own PC. Nothing is shared with anyone.

## 1. Install

1. Run **`ScrapScout-Setup-1.0.0.exe`**.
   Windows may show *"Windows protected your PC"*, because the installer isn't code-signed (signing costs money,
   and this is a free tool). Click **More info → Run anyway**.
2. It installs and opens by itself. No admin rights, Node.js or Chrome needed.

ScrapScout starts with Windows and sits in the tray (bottom-right, by the clock) so alerts keep coming.
Closing the window just hides it there. Right-click the tray icon to quit or turn off *Start with Windows*.

## 2. Link your Steam account (once)

Click **Link Steam** on the start screen (or Settings → *Link Steam*). A Rust+ login window opens:
sign in with Steam there. It closes by itself when it's done.

## 3. Pair your server

1. Join the server in Rust.
2. Press **ESC** → **Rust+** → **Pair with server**.
   (If it says you already allowed notifications from this server, press **Disable** first, then pair again.)
3. Within a few seconds the server shows up in the app and connects by itself.

To pair smart switches, alarms or storage monitors: look at the device in game, hold **E** → **Pair**.

## Optional keys (Settings tab, gear icon bottom-left)

| Key | What it unlocks | Where to get it |
|---|---|---|
| Steam Web API key | Server browser list; finding custom maps for heatmaps | https://steamcommunity.com/dev/apikey (any domain name works) |
| RustMaps API key | Heatmaps (ore nodes, hemp, berries, animals), water wells & caves | Sign in at https://rustmaps.com → your account → API key |
| Discord webhook | Alerts posted to a Discord channel | Discord channel → Edit → Integrations → Webhooks |
| Discord bot | Ask the app things from Discord (`!pop`, `!timers`, `!tracked`…) | See below |

## Discord bot (optional)

The webhook only *posts* alerts. The bot also *answers* commands in one channel.

1. Go to https://discord.com/developers/applications → **New Application** → name it (e.g. *ScrapScout*).
2. **Bot** page → **Reset Token** → copy the token. On the same page, turn on **Message Content Intent** and save.
3. **OAuth2 → URL Generator** → tick **bot**, then under permissions tick **View Channels**, **Send Messages**,
   **Embed Links**, **Read Message History**. Open the generated link and add the bot to your Discord server.
4. In Discord: **User Settings → Advanced → Developer Mode** on. Right-click the channel the bot should use → **Copy Channel ID**.
5. In the app: Settings → **Discord bot** → tick *Run the Discord bot*, paste the token and channel ID, **Save settings**.
   The status line should say `online as <your bot>`.

Type `!help` in that channel. Commands are the same as the in-game bot, plus `!status`, `!timers` (your decay timers),
`!tracked` (tracked players) and `!say <text>` (posts to team chat, only if you tick *Allow !say*).
Anyone who can write in that channel can use the bot, including `!sw` for smart switches, so use a private channel.
With no webhook set, alerts are posted through the bot instead.

## Run it 24/7

The desktop app already does this while your PC is on: it starts with Windows and keeps running in the tray.
To keep alerts going with your PC off, put it on a free Linux server: see **HOSTING.md**.

## Without the installer (zip version, Linux, servers)

The zip has the same app as plain files. Needs **Node.js LTS** (https://nodejs.org) and, once, Chrome or Edge for the Steam login.
Unzip it, double-click **`setup.bat`**, then **`start.bat`** (opens http://localhost:3000). Or in a terminal inside the folder:

```
npm install --omit=dev
npm run register
npm start
```

## Handy extras

- **Map pins & decay timers:** right-click the map (long-press on a phone) → *Drop pin* or *Decay timer*.
  Drag pins to move them; click one to edit it or update a decay timer's HP. Timers warn you (toast + Discord) before the wall falls.
- **Scan screenshots:** in Tools → Decay Tracker press **📷 Scan** (or paste with Ctrl+V) on a screenshot of the hammer
  view to fill in the structure and HP. In Breeder, scan screenshots of plant genes to add them to your list.
  Always double-check what it read. The first scan downloads the reader (~5 MB).
- **App over the game:** **Ctrl + Alt + M** opens the whole app full-screen on top of Rust (map, team, tools — everything),
  like the Steam overlay. Press it again to hide it and drop straight back into the game. Borderless/Windowed mode only.
- **In-game HUD + crosshair:** a small HUD (game clock + time to night, pop, your next decay timer, live alerts) and your own
  crosshair, drawn over Rust. **Ctrl + Alt + O** toggles the HUD, **Ctrl + Alt + X** the crosshair. Design the crosshair
  (style, size, gap, thickness, colour, outline, centre dot) in Settings → *In-game overlay*. Borderless/Windowed mode only.
- **Colour profiles:** make your own screen profiles (vibrance, saturation, brightness, contrast, gamma, temperature)
  in Settings → *Colour profiles*, or start from the Night, Snow and Desert presets. **Ctrl + Alt + V** switches to the next
  profile in game and turns colours off after the last one. Also in the tray menu. It changes your display settings like the
  NVIDIA Control Panel and never touches the game. Some community servers ban gamma changes in their rules, so check first.
- **Map files:** got a server's `.map` file (or one from RustMaps)? Drag it onto the window, or Browse → *Open a .map file*.
  You get the full map with monuments, recyclers, card readers, ore and junkpile hotspots, offline, before you ever join.
  *Save image* exports it as a PNG.
- **Tracked players:** the crosshair tab. Make a group (e.g. *Neighbours*), add players by in-game name or Steam
  profile link, and get an alert when they join or leave your server. Steam profiles show Rust hours and bans
  (needs the Steam API key).

## Troubleshooting

- **"Windows protected your PC" when installing** — the installer isn't code-signed. Click **More info → Run anyway**.
- **Server never shows up after pairing** — check Settings → *Push listener* says `listening`.
  If not (or it says the login expired), click **Link Steam** again, then re-pair in game.
- **Only one copy can use your Rust+ login at a time** — don't run the desktop app and the zip version together.
- **Where's my data?** Tray icon → *Open data folder* (`%APPDATA%\ScrapScout`). Uninstalling keeps it.
- Zip version: **"Node.js is not installed"** — install it from nodejs.org and run `setup.bat` again.
  **Port 3000 already in use** — another copy is running; close its black window (or run `stop.bat`).
- **Discord bot status says to turn on Message Content Intent** — Developer Portal → your app → Bot → switch it on, then Save settings in the app again.
- **No shops, events or their commands** — Facepunch removed shops (vending machines) and map events (heli, cargo, Chinook,
  crates, explosions, travelling vendor, oil rigs, airdrops) from Rust+ on 6 Aug 2026. No companion app can see them, so
  ScrapScout removed those features. They come back if Facepunch brings the data back.
- **Heatmaps say "custom map"** — that server's map isn't on RustMaps, so there's no heat data for it.

## Keep these private

Never send anyone your `config.json` or `rustplus.config.json` (in the data folder for the desktop app) — they hold your
API keys and your Rust+ login. Share the installer, never your data folder.
