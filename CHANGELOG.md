# Changelog

All notable changes to Scrapfall are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Scrapfall ships continuously from `main` to https://szakacsmedia.com/game/, so entries are grouped by date, not by release. `package.json` is at 1.0.6.

## [Unreleased]

## 2026-10-04 and earlier in October

### Added
- Host-controlled live room pause for co-op, with teammate presentation held stable during a pause.
- Controller support: remappable buttons, analog trigger travel, and a DualSense mapping.
- Context notices and a compact shop kept clear of touch and controller controls.
- Grouped HUD status and ammo display that stays visible through scopes.

### Changed
- Held brake now eases through a stop into reverse.
- Players are recovered only when the match advances to a new wave.
- Enemy fire uses precise hull sweeps.
- Four-map realism pass: scanned materials, branch-and-leaf tree crowns, snow-laden spruce and natural lighting.

### Fixed
- Cached vehicle pedals are cleared across room pauses.
- Stopped traffic is solid to walking players, and revived teammates stay at their current floor.

## 2026-10-03

Tagged `2026-10-03-gameplay-update`. See the tag and its commits for the gameplay changes in that update.

## 2026-09

- 2026-09-22: project started from a Lovable TanStack Start template.
- 2026-09-28: Nuketown (since hidden as work in progress), fixed random match weather, bullet drop and the Longshot rifle with remappable aiming, the Dry Gulch terrain and model pass (see [RELEASE_CHECKS.md](RELEASE_CHECKS.md)).
- Synced with the upstream `tobyszaks/robotshooter` at v1.0.7 (see [docs/UPSTREAM.md](docs/UPSTREAM.md)).
