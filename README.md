<div align="center">

<img src="public/icon.png" width="96" alt="ScrapScout icon">

# ScrapScout

**Rust+ on your desktop, without having your phone out mid-raid.**
For help dm infxrno.jpg on discord.

[![Latest release](https://img.shields.io/github/v/release/Infxrnoz/ScrapScout?label=download)](https://github.com/Infxrnoz/ScrapScout/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Infxrnoz/ScrapScout/total)](https://github.com/Infxrnoz/ScrapScout/releases)
[![License](https://img.shields.io/badge/license-FSL--1.1--MIT-blue)](LICENSE)
![Windows](https://img.shields.io/badge/platform-Windows-0078d6)

</div>

ScrapScout is a free Rust+ companion for Windows. Pair it with a server once and you get the live map, your team,
smart alarms and a bunch of tools in one window, plus a small overlay you can pull up over the game.

> **Every feature is free.** There is no Pro tier, no licence key and no activation server any more.
> Cameras, automations, the overlay, colour profiles, the calculators, tracked players, the server browser,
> Discord alerts and everything else are unlocked for everyone.

ScrapScout was previously published as RustScout. It was renamed after a naming conflict with another
Rust community project. Same app, same author, new name.

## What it does

- **Live map** with your team, monuments, ore and resource spots
- **Team tracker** and tracked players, so you know who's online and where
- **Alerts** for smart alarms, teammate deaths, who killed you, low TC upkeep and decay timers, in the app and on Discord if you want
- **Server browser** with pop, wipe dates and map previews
- **Map pins and decay timers** so you stop forgetting to fill the TC
- **Raid, crafting, power and gene breeding calculators**
- **In-game HUD** with the clock, pop and your next decay timer
- **Custom crosshair** and **colour profiles** you switch with a hotkey
- **CCTV cameras, turrets and smart switches** from the Rust+ devices tab
- Shops and map events (heli, cargo, Chinook, crates…) aren't included: Facepunch removed them from Rust+ on 6 Aug 2026

## Install

1. Grab **ScrapScout-Setup.exe** from the [latest release](https://github.com/Infxrnoz/ScrapScout/releases/latest).
2. Run it. The installer isn't code-signed yet, so Windows may show *"Windows protected your PC"*. Hit **More info → Run anyway**.

## Getting started

1. Open ScrapScout and click **Link Steam**, then sign in with Steam in the window that pops up.
2. In Rust, go to **ESC → Rust+ → Pair with server**. The server shows up in ScrapScout on its own.

That's it. Anything you pair from now on gets picked up automatically.

## Hotkeys

| Keys | What it does |
|---|---|
| `Ctrl` `Alt` `M` | Open ScrapScout over the game (press again to go back) |
| `Ctrl` `Alt` `O` | Toggle the HUD |
| `Ctrl` `Alt` `X` | Toggle the crosshair (you design it in Settings) |
| `Ctrl` `Alt` `V` | Next colour profile (off after the last one) |

If another app already uses one of these, the tray menu shows which keys ScrapScout picked instead.

## Good to know

- The overlay and colour profiles only work with Rust in **Borderless** or **Windowed** mode.
- Some community servers don't allow crosshair overlays or gamma changes. Check the server rules first.
- Want it running 24/7 on a box somewhere? See [HOSTING.md](HOSTING.md).
- Building from source or poking at the internals? See [DEVELOPMENT.md](DEVELOPMENT.md).

## License

Source-available under the [Functional Source License 1.1, MIT Future License](LICENSE) (`FSL-1.1-MIT`).

You can read, use, modify, share and build on ScrapScout for anything except a **competing commercial product or service** — for example, selling a rebranded fork, a paid hosted version, or a paid tool that does substantially the same thing. Personal use, internal use, education, research and non-competing professional work are all fine.

Two years after each release, that release automatically becomes available under the **MIT license**, so the whole thing becomes fully open source over time.

The ScrapScout name and logo are not covered by the license and remain © Infxrnoz. A fork may not use them. For anything else, ask [@Infxrnoz](https://github.com/Infxrnoz).

---

<sub>ScrapScout is a fan-made project and isn't affiliated with or endorsed by Facepunch Studios. Rust and Rust+ belong to them.</sub>
