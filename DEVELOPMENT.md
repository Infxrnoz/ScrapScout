# ScrapScout

A free Rust+ companion for your desktop: live map, team tracker, alerts to Discord, server browser, ore and resource maps,
tracked players, map pins and decay timers, raid / crafting / power tools. It runs on your own machine and talks to the
Rust server through the Rust+ companion API (the same one rustplusplus uses).

*ScrapScout is a free fan-made tool. It isn't affiliated with or endorsed by Facepunch Studios; Rust and Rust+ are theirs.*

## Desktop app (Windows)

`npm run dist` builds `dist-app/ScrapScout-Setup-<version>.exe`, a one-click per-user installer (Electron). The app runs the same
backend as `npm start`, keeps its data in `%APPDATA%\ScrapScout`, lives in the tray, starts with Windows, links Steam in its
own login window (no Chrome needed). `npm run app` runs it from source.
`npm run dist:personal` builds `…-personal.exe`, the same app plus a tray item to import data from the old zip version (the shared build leaves it out).
The icon is drawn by `npm run icon` (desktop/make-icon.js).

## Run from source (no installer)

```
npm install --omit=dev   # just the app
npm start
```

Plain `npm install` also fetches Electron and electron-builder, needed for `npm run app` / `npm run dist`.

Then open http://localhost:3000.

## Tabs

- **Browse** — every Rust server (needs a free Steam Web API key) or look one up by IP or address like `play.server.com:28015` (no key). Shows pop, queue, wipe age, seed/size, header, description, and the map image straight from Facepunch — no pairing needed. Star servers to watch their pop and get an alert when they wipe. Pair in game later for the live features.
- **Resource filters** (map, top-left) — Markers: green/blue/red card monuments, recyclers, safe zones, water wells, caves. Heatmap: ore nodes, hemp, berries, animals, player spawns and terrain tiers from RustMaps (free API key in Settings). Custom maps work when the server's map is hosted on RustMaps. Spawn zones (mushrooms, crops, roses, orchids, sunflowers, woodpiles, polar bears, chickens, stags, wolves) are drawn from the biome and terrain layers inside the server's own map file, using RustHelp's spawn rules — available on servers that publish a map file (most custom maps). Items with no public data source are shown greyed out.
- **Ores by type** (Stone / Metal / Sulfur / HQM) — likelihood maps and hotspots built from the server's map file (biome, ground texture and terrain flags at full resolution) and Rust's own ore spawn tables (`data/ores.json`: densities, filters, and the per-biome mix — stone 2 : metal 1 : sulfur 1 in forest/tundra/jungle, 1 : 1 : 1 in desert and snow; HQM rare, 8× denser in jungle). Placement agrees with RustMaps' node simulation on 95–97% of cells. After a Rust update, refresh the tables with `python scripts/extract-ore-tables.py "<Rust install folder>"` (needs `pip install UnityPy`; reads asset data only).
- **Monument facilities, junkpiles, dive sites** (Resource filters) — recyclers, research tables, refineries, turrets, SAM sites, pumpjacks, repair benches, workbenches and card readers placed from each monument's own layout in the map file (`data/facilities.json`); junkpile and dive-site likelihood from Rust's spawn tables (`data/spawns.json`). Refresh both after a Rust update with `python scripts/extract-game-data.py "<Rust install folder>"`.
- **Map files** (Browse → Open a .map file, or drop one on the window) — reads any Rust `.map` offline: draws the map from its height/splat/water layers (`src/maprender.js`), names its monuments (`data/monuments.json`), and runs the same ore, spawn-zone and facility models as a live server. Opened files are cached by content hash in `data/terrain/`.
- **Shops** — search every vending machine, cheapest first; live sale feed.
- **Raiding** — sulfur "potential targets" + raid cost calculator (meta / cheapest, tool filter, send cost to team chat).
- **Team** — live positions, online/alive, time alive, deaths, activity log; deaths are marked on the map.
- **Threats** — everyone who killed you (from Rust+ death pushes) with Steam profile, VAC, and (with an API key) Rust hours + game bans.
- **Events** — cargo / heli / chinook / crate / vendor timers, alert history, event log, map layer toggles.
- **Devices** — smart switches (toggle), smart alarms, storage monitors with TC upkeep countdown. Pair them in game with the push listener running.
- **Chat** — team chat + an in-game bot (`!help`, `!pop`, `!wipe`, `!time`, `!online`, `!cargo`, `!craft`, `!recycle`, `!decay`, `!raid`, `!shop`, `!sulfur`, `!upkeep`, `!alarms`, `!sw <name> on|off`, …).
- **Tracked** — groups of players (by in-game name or Steam profile) with live state (on your server / in Rust / online / offline), session time, join/leave history and alerts; Steam profiles add Rust hours, VAC/game bans and account age.
- **Tools** — decay timers from a hammer HP reading (stored per server, pinned on the map, alerts before they fall; 📷 OCR fills them from a screenshot); your own map pins; crafting calculator broken down to raw. Right-click the map to drop a pin or timer.
- **Recycle** — monument vs safe-zone recycler yields.
- **Breeder** — best clone mix for a target genome (G/Y/H weight 0.6, W/X 1.0, ties are a coin flip); 📷 reads genes from screenshots.
- **Power** — solar/wind/generator + battery sizing, "survives the night" check, and a crafting list for the whole setup down to raw materials.
- **Settings** — servers, Discord webhook, Discord bot, Steam API key, bot prefix, per-alert toast/Discord toggles, desktop notifications.

## Discord bot and 24/7

The optional Discord bot (Settings → Discord bot; steps in SETUP.md) answers the in-game commands plus `!status`, `!timers`, `!tracked` and `!say` in one channel, talking to the Discord gateway directly (no discord.js).
All alerts are generated by the backend, so the app works headless: `autostart-on.bat` / `start-background.vbs` / `stop.bat` on Windows, or `scripts/install-linux-service.sh` (systemd) on a Linux box. See HOSTING.md.

Screenshot OCR uses tesseract.js in the browser, loaded from jsDelivr on first use.

## Credentials / pairing

`config.json` → `credentialsFile` points at either:

- a rustplusplus credentials file (`../rustplusplus/credentials/<guild>.json`); the `hoster` user is used unless `steamId` is set, or
- a `rustplus.config.json` created with `npx @liamcottle/rustplus.js fcm-register`.

With credentials loaded, go in game → **ESC → Rust+ → Pair with server** and the server shows up automatically.
You can also add a server by hand in the Servers panel (IP, app port, Steam ID, player token).

Don't run this and the rustplusplus bot on the same FCM credentials at once; they will fight over the push connection.

## How the sulfur targets work

Every marker poll (4s by default) the tracker diffs each vending machine's `amountInStock`.
A drop is recorded as a sale. Shops that received sulfur or sulfur ore as payment are ranked as targets,
because the owner collects that currency. An owner pulling stock out of their own machine also looks like a sale.

Data lives in `data/servers/<ip_port>/vending.json` and resets on a new wipe.

## Rebuilding static data

`npm run build-data` regenerates `data/items.json` and `data/raid.json` from `../rustplusplus/src/staticFiles`
(pass another path as the first argument to use a different source).
