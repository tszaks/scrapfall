# Upstream sync record

This repo was forked from `tobyszaks/robotshooter` at `1a073af` ("Renamed game to
Scrapfall", Toby's v1.0.2). This file records which upstream commit we have ported
up to, and where each change lives here — the next sync only has to diff from this SHA.

**Synced with tobyszaks/robotshooter at `704ca29b8b878bed390a69faf2f6c13ac9f4be30`
(2026-09-29)** — covers v1.0.3 and v1.0.4, including the post-1.0.4 commits
`838f321`…`704ca29` ("Dressed all 10 maps", boss/special art, muzzle-convergent bullets).

## Legend

- **ported** — landed as-is or with mechanical adaptation to our module layout
- **adapted** — same feature, re-implemented into our diverged architecture
- **skipped** — intentionally not brought over (rationale given)

## v1.0.3 — co-op and stats fixes

| Upstream change | Status | Where | Notes |
| --- | --- | --- | --- |
| Per-player kill credit (kill goes to the shooter, not the host) | adapted | `Game.tsx` `applyHit`/`killEnemy` carry `from` through every damage path; host replies `{type:"kill",i,el,bo}` | our hit pipeline already relays guest hits to the host; Toby's `from` argument rides along it |
| Accuracy counts a shot once however many enemies it pierces | ported | `Game.tsx` bullet loop counts `hit` only when `hitBodies.size === 1` | our pierce bookkeeping already tracked bodies per bullet |
| Co-op shards are single-use | adapted | `Shards.tsx` `taken`/`onTake` props, deterministic ids `${e}-${death}-${piece}`; `Game.tsx` broadcasts `{type:"shard"}`; `net.ts` relays it | our Shards keeps `groundY` height + `NEW_VALUE`; the taken-set is added on top |
| Co-op death: shop while down, heal guards, spectate banner | adapted | `shopBreak` allows `multiplayer \|\| !dead`; `buy` guards `h > 0` on heal/maxhp; "YOU DIED / SPECTATING" banner | Toby's flat screens adapted into our HUD banner + existing squad/down system |
| Co-op health pack + reward scaling | adapted | `onShard` gain `* (1 + 0.5·peers) * 0.8` when multiplayer; heal pack `take` broadcast already existed | shard income scaled down per squad size |
| Stat renames ("Hull Integrity", "+1 Piercing", "No Nano-Regen", …) | ported | `classes.ts`, `perks.ts` | verbatim |
| Unified stats UI overhaul (class tooltip, bought-cards grid, recap) | adapted | `ui/PauseEndScreens.tsx`: `StatMini` class name hover-tooltip (role + pros/cons), `PauseScreen.bought` UPGRADES BOUGHT grid, `EndScreen` recap rows | content ported onto our kit (Panel/SectionLabel/MenuButton), not his markup |
| TURRET_LIFE 30 | ported | `Game.tsx` `TURRET_LIFE = 30` | already matched |

## v1.0.4 — hazards, endless, dressing

| Upstream change | Status | Where | Notes |
| --- | --- | --- | --- |
| `src/game/hazards.ts` hazard defs | adapted | `hazards.ts` — same `HazardDef` shape; added `effect`/`shell`/`core` names and defs for our big-map blockShapes (`city` fuel drums, `western` powder kegs, `beach` gas canisters, `alpine` propane tanks) | Toby's defs are per-arena theme; our big maps needed their own themed props |
| Hazard placement per round, host-authoritative | adapted | `Game.tsx` `hazardAnchors()` places props at real landmarks (gas-station canopy, mine, lodge deck, pier wheel/coaster/fires/towers) with a `blocked()` clear-ground check + `spot()` fallback; `hazset` syncs to guests and late joiners | Toby scatters randomly on his arenas; our big maps anchor to authored landmarks so props never seal doors/stairs |
| `blowHazard` + `haz` message + bullet collision | ported | `Game.tsx` `blowHazard`, `msgSink` `haz`/`hazset`, bullet loop checks hazards first; guest blasts are visual-only, the host applies damage credited to the shooter | same semantics; `haz` added to `RELAYED` so guest blasts reach every client |
| `HazardProp` themed visuals | ported | `Game.tsx` `HazardProp` memo — drum/pod/condenser/relay/geyser/vat | verbatim geometry, driven by `HazardDef.look` |
| `boom` sfx | ported | `audio.ts` `playSfx("boom")` | verbatim |
| `src/game/endless.ts` (mutators, high-wave record) | ported | `endless.ts` | byte-identical |
| Endless overtime past wave 12 | adapted | `Game.tsx`: `endless` ref prop, `wonLatch`, spec = wave-11 lineup + boss every 5th OT wave, `enemyMul` keeps growing (+8%/wave), `hpMul` ramps `hpRamp*1.67` per OT wave | our wave system is difficulty-driven (`waveLineup`/`crowdMul`), not a fixed table — the ramp constants preserve Toby's growth |
| Overtime button on the win screen (host) + `ot` message | adapted | `EndScreen` `onOvertime` prop; `Game.tsx` `goingOvertime`/`endlessRef`, `handleMsg` `"ot"` | guests lift out of the end screen on the `ot` broadcast; run/build/map kept |
| Mutator effects | ported | `applyHit` (cryo chill 1.2s, gravity kb×2), `spd` (cryo ×0.85, gravity ×0.9), `moveState.gravityMul` 1.4, enemy step (`blood` regen 0.8/s, `surge` ×1.25), fire cd `surge` ×0.77, `flare` death blast | same numbers; siphon doubling also applied on the blast path |
| Best-wave record in localStorage | ported | `endless.ts` `readHighWave`/`saveHighWave`; `Game.tsx` `highWave` state; `EndScreen` "BEST EVER" row | same key `scrapfall-high-wave` |
| Weapon drop pacing | ported | `spawnWave`: `want = (pity ? 2 : rand<0.8) * players`; `depletedWave` locks a dry gun out for 2 waves (5% slip); `dryWaves` pity; `lostQueue` keeps floor drops from looping | verbatim algorithm; `players` = `1 + extra` from `playersRef` |
| Full sidearm at the start of each wave | ported | `spawnWave` + guest `status` banner handler refill pistol to `extmag ? 220 : GUNS.pistol.ammo` | |
| Ammo crate refills the pistol too | ported | crate pickup uses the same extmag cap | |
| Map scenery: tiered trees, `BLOCK_HALF`/`setBlockHalf`, per-biome decor | ported | `level.ts` | already landed earlier |
| `art/MapDressing.tsx` — painted ground, ground cover, skyline ring | ported | new file verbatim; `Level` renders `<Ground>`+`<MapDressing>` instead of plane+grid | arenas only — big maps have their own terrain |
| Boss/special art (`robots/bosses.ts`, `robots/specials.ts`, `SpecialBoss.tsx`) | ported | same paths | already identical; upstream's `(shape as string)` casts dropped — our `Theme` unions are typed |
| Muzzle-origin bullets converging on the crosshair | skipped | — | superseded: our `readGunMuzzle`/`playerMuzzle`/`ballisticDirection` already fire from the real barrel and converge at a zeroed distance (plus third-person `shoulderAim`) |
| Fog range `16, ARENA*1.7` | skipped | — | our fog is per-map time-of-day driven (`skyFog.ts`/`TimeScene`), not a flat arena value |
| Nuketown hazard work | skipped | — | Nuketown is being rebuilt by another agent; `hazardsEnabled()` returns false for `blockShape === "nuketown"` |
| Version → 1.0.4 | ported | `GAME_VERSION`, `package.json`, `SettingsScreen` footer | |

## Sync mechanics

- Room namespace bumped to `scrapfall-ts-arena-v9-` (`net.ts`): new message kinds
  `shard`, `haz`, `hazset`, `mut`, `ot`, `kill` — appended to `RELAYED` where guests
  originate them; all host-authoritative rules unchanged.
- No upstream `Game.tsx` hunk was copied wholesale — every change was re-expressed
  against our World/Game split, `waveLineup` difficulty curves and landmark maps.
