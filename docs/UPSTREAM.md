# Upstream sync record

This repo was forked from `tobyszaks/robotshooter` at `1a073af` ("Renamed game to
Scrapfall", Toby's v1.0.2). This file records which upstream commit we have ported
up to, and where each change lives here — the next sync only has to diff from this SHA.

**Synced with tobyszaks/robotshooter at `9955437` (v1.0.7, 2026-09-29)** — covers
v1.0.3 through the post-1.0.4 range `838f321`…`9955437` ("Dressed all 10 maps",
boss/special art, muzzle-convergent bullets, big-map integration, SNOW CANNON, and
his adoption of our gun/menu modules — those are marked "originates here" below).

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
| Co-op health pack + reward scaling | adapted | `onShard` gain `* (1 + 0.5·peers) * 0.8` when multiplayer; heal pack `take` broadcast; shop heal card gates on `n >= (extra>0 ? 1 : 2)` so co-op gets the pack from wave 1 | shard income scaled down per squad size |
| Stat renames ("Hull Integrity", "+1 Piercing", "No Nano-Regen", …) | ported | `classes.ts`, `perks.ts` | verbatim |
| Unified stats UI overhaul (class popover, bought-cards grid, recap) | adapted | `ui/PauseEndScreens.tsx`: `StatMini` class name opens a real popover (hover + tap; role + pros/cons), `PauseScreen.bought` UPGRADES BOUGHT grid with per-card effects (pros green, cons red, `Total:` rollup, `x{lvl}` count), `EndScreen` recap rows | content ported onto our kit (Panel/SectionLabel/MenuButton), not his markup; the old flat ATTRIBUTES badge row is removed — the per-card effects carry the same information in context |
| TURRET_LIFE 30 | ported | `Game.tsx` `TURRET_LIFE = 30` | already matched |

## v1.0.4 — hazards, endless, dressing

| Upstream change | Status | Where | Notes |
| --- | --- | --- | --- |
| `src/game/hazards.ts` hazard defs | adapted | `hazards.ts` — same `HazardDef` shape; added `effect`/`shell`/`core` names and defs for our big-map blockShapes (`city` fuel drums, `western` powder kegs, `beach` gas canisters, `alpine` snow cannons) | Toby's defs are per-arena theme; our big maps needed their own themed props |
| Hazard placement per round, host-authoritative | adapted | `Game.tsx` `hazardAnchors()` places props at real landmarks (gas-station canopy + construction yards + garage aprons + alley dumpsters on Vice; mine/station on Gulch; pier wheel/coaster/fires/towers; village cafes/chalets/shops on Whiteout) with `blocked()` + `hazardOk` ground checks + `spot()` fallback; `hazset` syncs to guests and late joiners | Toby scatters randomly on his arenas; our big maps anchor to authored landmarks so props never seal doors/stairs; Whiteout's summit island and ice rink are excluded (see Intentional differences) |
| `blowHazard` + `haz` message + bullet collision | ported | `Game.tsx` `blowHazard`, `msgSink` `haz`/`hazset`, bullet loop checks hazards first; guest blasts are visual-only, the host applies damage credited to the shooter; a hazard pop counts as the shot's one accuracy hit (Toby's `track`, mapped onto our `hitBodies`); each prop gets `rotation.y = i * 1.3` | same semantics; `haz` added to `RELAYED` so guest blasts reach every client |
| `HazardProp` themed visuals | ported | `Game.tsx` `HazardProp` memo — drum/pod/condenser/relay/geyser/vat | verbatim geometry, driven by `HazardDef.look` |
| `boom` sfx | ported | `audio.ts` `playSfx("boom")` | verbatim |
| `src/game/endless.ts` (mutators, high-wave record) | ported | `endless.ts` | byte-identical |
| Endless overtime past wave 12 | adapted | `Game.tsx`: `endless` ref prop, `wonLatch`, spec = wave-11 lineup + boss every 5th OT wave, `enemyMul` keeps growing (+8%/wave), `hpMul` ramps `hpRamp*1.67` per OT wave | our wave system is difficulty-driven (`waveLineup`/`crowdMul`), not a fixed table — the ramp constants preserve Toby's growth |
| Overtime button on the win screen (host) + `ot` message | adapted | `EndScreen` `onOvertime` prop; `Game.tsx` `goingOvertime`/`endlessRef`, `handleMsg` `"ot"` | guests lift out of the end screen on the `ot` broadcast; run/build/map kept |
| Mutator effects | ported | `applyHit` (cryo chill 1.2s, gravity kb×2), `spd` (cryo ×0.85, gravity ×0.9), `moveState.gravityMul` 1.4, enemy step (`blood` regen 0.8/s, `surge` ×1.25), fire cd `surge` ×0.77, `flare` death blast | same numbers; siphon doubling also applied on the blast path; the `mut` message falls through to World's `msgSink` so guests apply it (no early return in `handleMsg`) |
| Best-wave record in localStorage | ported | `endless.ts` `readHighWave`/`saveHighWave`; `Game.tsx` `highWave` state; `EndScreen` "BEST EVER" row | same key `scrapfall-high-wave` |
| Weapon drop pacing | ported | `spawnWave`: `want = (pity ? 2 : rand<0.8) * players`; `depletedWave` locks a dry gun out for 2 waves (5% slip); `dryWaves` pity; `lostQueue` keeps floor drops from looping | verbatim algorithm; `players` = `1 + extra` from `playersRef` |
| Full sidearm at the start of each wave | ported | `spawnWave` + guest `status` banner handler refill pistol to `extmag ? 220 : GUNS.pistol.ammo` | |
| Ammo crate refills the pistol too | ported | crate pickup uses the same extmag cap | |
| Map scenery: tiered trees, `BLOCK_HALF`/`setBlockHalf`, per-biome decor | ported | `Game.tsx`: `Obstacle` tree = root flare + slim trunk + 3 stacked canopy tiers; `Decor` component (mushrooms, frost shards, cracked slabs, kelp, conduit boxes, pipes/puddles) replaces the generic marker posts; level memo calls `setBlockHalf(0.72)` for tree/coral, `0.86` pagoda, `BLOCK/2` otherwise and on big maps | adapted to our `layoutOf(theme)` structure |
| `art/MapDressing.tsx` — painted ground, ground cover, skyline ring | ported | new file verbatim; `Level` renders `<Ground>`+`<MapDressing>` instead of plane+grid | arenas only — big maps have their own terrain |
| Boss/special art (`robots/bosses.ts`, `robots/specials.ts`, `SpecialBoss.tsx`) | ported | same paths | already identical; upstream's `(shape as string)` casts dropped — our `Theme` unions are typed |
| Muzzle-origin bullets converging on the crosshair | skipped | — | superseded: our `readGunMuzzle`/`playerMuzzle`/`ballisticDirection` already fire from the real barrel and converge at a zeroed distance (plus third-person `shoulderAim`) |
| Fog range `16, ARENA*1.7` | skipped | — | our fog is per-map time-of-day driven (`skyFog.ts`/`TimeScene`), not a flat arena value |
| Nuketown hazard work | skipped | — | Nuketown is being rebuilt by another agent; `hazardsEnabled()` returns false for `blockShape === "nuketown"` |
| Version → 1.0.4 | ported | `GAME_VERSION`, `package.json`, `SettingsScreen` footer | raised to 1.0.6 below |

## Post-1.0.4 → a2a4efa (v1.0.5/v1.0.6 era)

Most of this range is upstream integrating *our* big maps and UI into his repo
(`src/bro/` is a copy of this codebase). Only the changes that touch shared game
behaviour are listed; everything else is "skipped: originates here".

| Upstream change | Status | Where | Notes |
| --- | --- | --- | --- |
| `alpine` hazard def → SNOW CANNON (freeze condenser, red shell) | ported | `hazards.ts` `BY_SHAPE.alpine` | replaces our earlier PROPANE TANK for Whiteout's lodge props |
| "No shootable/explodable hazards on any big map" | adapted | `hazards.ts` `BIG_MAP_HAZARDS` switch + `Game.tsx` `hazOn` gate (`!(city \|\| western)`) | **owner decision: KEEP them** (`BIG_MAP_HAZARDS = true`) — see Intentional differences |
| `level.ts`: cell-grid `blocked` for >400 blocks | skipped | — | superseded: our `blocked` already runs through the `BlockGrid` cell lookup (plus posts/room hooks) |
| `level.ts`: `spawnFocus` ring for big maps | skipped | — | superseded: our `spawnNear` already spawns around live players, hidden, with a routable-spot check |
| `level.ts`: flowField `nd > 70` cap on big maps | skipped | — | our flow field already has the `maxD` cut-off |
| `terrain.ts` `setBigGround` bridge to `bro/game/terrain` | skipped | — | originates here: big-map `groundY` is native in our repo |
| `themes.ts`: `alpine` in `blockShape` union | skipped | — | already present |
| `audio.ts`: `"Whiteout Pass" → "ice"` | skipped | — | ours maps it to a dedicated `alpine` style (harp pluck over organ pad) |
| `r3fDevFix.ts` (`data-tsd-source` preview crash) | skipped | — | Lovable-preview tooling only; nothing here injects that attribute |
| Big-map integration (`BIG_BASE` seeds, `?bigmap=`, `setupBigMap`, `BigMapScene`, `MapEvents`, `bigMinimap`, `bigPlayerBlocked`, `feetY`, `spawnFocus` drive, menu drift cam) | skipped | — | originates here: all of it is his port of our maps, events and collision |
| `Minimap.tsx`, `ui/TitleScreen.tsx`, `ui/RunScreens.tsx`, `ui/BrandLogo.tsx`, `ui/LoadoutScreen.tsx`, `ui/SettingsScreen.tsx`, menu fade/drift showcase | skipped | — | originates here: his extraction/rematch of our menu kit |
| `GunView`/`gunFx`/`readGunMuzzle` adoption | skipped | — | originates here: he imports our `src/game/art/*` via `src/bro/` |
| `VERSION = "1.0.6"` | ported | `GAME_VERSION` | upstream's v1.0.7 label rides on our-content commits (all "originates here"); v1.0.8 is listed under Not yet synced |

## Intentional differences

Deliberate divergences from upstream, decided by the owner — do not "fix" these on a
future sync:

- **Big maps keep their shootable hazards.** Toby's v1.0.6 removes explodable props
  from the big maps; Tyler keeps ours (owner decision 2026-09-29). The switch is
  `BIG_MAP_HAZARDS = true` in `hazards.ts` — flip it if the call ever changes.
- **Whiteout's props are SNOW CANNONs at village level, not the summit.** Toby's alpine
  def is ported, but his placement targeted the lift-only summit island and the ice
  rink; ours anchors beside the village cafes/chalets/shops and `hazardOk` keeps the
  rink and the island clear (owner note: a prop kept landing at the top terminal, ~100 m
  up, and on the rink).
- **Big maps get 8 props, arenas 5** (`HAZARD_COUNT_BIG`); Vice drums spread across gas
  stations, construction yards, garage/warehouse loading aprons and alley dumpsters so
  they sit near the usual fights (owner note: drums were only reachable at gas stations).
- Whiteout's hazard prop was our PROPANE TANK before a2a4efa; the lodge-deck propane
  anchors are superseded by the village SNOW CANNON spots.
- **ADS + per-gun accuracy model.** Upstream has one generic aim offset, a flat
  `spread * 0.65` while aimed and no sights; here every gun declares a sight in
  `art/sights.ts` (iron / reflex / holo / scope, eye line, relief, fov, ADS-in time,
  move multiplier) and `accuracy.ts` owns the cones — hip > ads always, movement and
  sustained-fire bloom on top, first aimed shot from standstill exact. The live cone
  is broadcast in the fire group so co-op replays stay deterministic (`PREFIX` v13).

## Sync mechanics

- Room namespace bumped to `scrapfall-ts-arena-v11-` (`net.ts`; main took v9 for the
  Pier/Whiteout doorway work and v10 is reserved for Dry Gulch): new message kinds
  `shard`, `haz`, `hazset`, `mut`, `ot`, `kill` — appended to `RELAYED` where guests
  originate them; all host-authoritative rules unchanged.
- No upstream `Game.tsx` hunk was copied wholesale — every change was re-expressed
  against our World/Game split, `waveLineup` difficulty curves and landmark maps.

## Not yet synced — `9955437`…`77046d5` (v1.0.8 "mobile polish")

Pushed upstream 2026-09-29; deliberately left out of this sync — the next one starts here:

- Touch-device perf on big maps: `setAutoTier("low")`, no sun shadows
  (`shadows={!touchUi}`), `dpr={touchUi ? [0.6,1] : [1,1.6]}`, alpine far plane
  1200→700 on touch.
- Phone minimap/map guide moved under the health/shard readout (off the buttons),
  92 px fixed box.
- `MobileControls`: movement stick driven directly (no HUD re-render per finger
  move); jump moved to the right side, stacked above the ability button.
- 4-player co-op join fixes: stale slot pruning, keep-alive heartbeat, full-room
  notice, lobby catch-up (`net.ts`, ~+84).
- Version bumps to `1.0.8`; roadmap gains "his 10 new enemy types on big maps" and
  "preload/warm big maps" items.
