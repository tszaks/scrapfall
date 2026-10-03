# Repo map

Where things live, and where to go to change them. Every folder under `src/` must appear here: CI fails if one is missing (`scripts/check-repo-map.mjs`).

## Top level

| Path | What's there |
| --- | --- |
| `src/` | The game (everything that ships) |
| `api/` | Vercel Functions. `turn.ts` mints Cloudflare TURN relay credentials for co-op, served at `/game/api/turn` (needs `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN`) |
| `scripts/` | Tests, the smoke test, the static-build staging step and one-off map audit scripts |
| `docs/` | This map and the upstream sync record (`UPSTREAM.md`) |
| `public/` | Favicon and robots.txt |
| `.github/workflows/ci.yml` | CI: unit tests, typecheck, build, repo-map check, smoke test on every map |
| `AGENTS.md` | How to work in this repo (read it first) |
| `RELEASE_CHECKS.md` | The manual play-test checklist for a release |
| `roadmap.md` | Toby's feature roadmap, carried over from his repo |
| `vercel.json`, `vite.config.ts` | Deploy and build config. The app is served under `/game/` |

## `src/`: the app shell

| Path | What's there |
| --- | --- |
| `src/routes/` | TanStack Start file routes. `index.tsx` mounts `<Game />`; `__root.tsx` holds the page `<head>` (title, meta, credits) |
| `src/components/` | Shared React components. `src/components/ui/` holds generated shadcn primitives, which are rarely touched |
| `src/hooks/` | Small React hooks (`use-mobile`) |
| `src/lib/` | Error capture and error page, plus `utils.ts` |

## `src/game/`: the game

`Game.tsx` (about 8,800 lines) is the hub: the game loop, weapons, enemies, waves, HUD state and the co-op message handling. It's shared by every agent, so put new work in its own module and hook it in with a few lines.

### Core systems (top-level files in `src/game/`)

| Area | Files |
| --- | --- |
| Maps list and picker rules | `themes.ts` (every map; `offered()` decides which appear in the picker), `matchEnvironment.ts` (one seed picks the weather for every peer) |
| Arena layout and collision | `level.ts` (arena grid, `blocked()`), `staticCollision.ts` (collision from rendered triangles), `posts.ts` (thin-prop collision), `terrain.ts` (ground height), `soloBounds.ts` (the solo blockade square) |
| Player | `PlayerView.tsx` (the camera and the one final `gl.render` each frame), `PostFx.tsx` (bloom passes layered on that render), `viewMode.ts` (first or third person), `useKeyboard.ts`, `touch.ts`, `MobileControls.tsx`, `ScopeOverlay.tsx` |
| Weapons and shots | `projectiles.ts`, `ballistics.ts` (bullet drop), `projectileContact.ts`, `impacts.ts`, `CombatFx.tsx`, `fxCore.ts` |
| Enemies | `enemyKinds.ts`, `enemyAI.ts`, `steerCache.ts` (a short-lived route-pick cache), `EnemyModels.tsx`, `enemyProjectiles.ts`, `enemySync.ts` (the compact host→guest snapshot) |
| Accounts | `account.ts`, `accountClient.ts`, `accountTypes.ts`, `profileSession.ts`, `useAccount.ts`, `ui/AccountBox.tsx`; setup and backend prerequisites in `docs/ACCOUNTS.md` |
| Run rules | `difficulty.ts` (five levels and the wave curve), `classes.ts`, `abilities.ts`, `perks.ts`, `Shards.tsx` (currency drops), `revive.ts`, `soloRevive.ts`, `SelfReviveView.tsx` |
| Co-op | `net.ts` (PeerJS rooms; the `PREFIX` version is bumped whenever the shared world or messages change), `netHeartbeat.ts`, `iceServers.ts` (fetches TURN relay servers, falls back to STUN), `joinErrors.ts` (join failure messages), `Remote.tsx`, `RemoteDeployables.tsx`, `Squad.tsx`, `squadState.ts`, `ping.ts` |
| Vice Heights (the city) | `cityLayout.ts` (the generator), `City.tsx`, `cityMesh.ts`, `cityGeo.ts`, `cityTextures.ts`, `cityMinimap.ts`, `cityBlockades.tsx`, `cityWeather.ts`, `CityRain.tsx` (rain and the wet-street mirror pass), `interiors.ts` (fake rooms behind windows), `Palms.tsx`, `Fountains.tsx` |
| Traffic and police | `trafficCore.ts`, `trafficSim.ts`, `Traffic.tsx`, `vehicles.ts`, `pursuit.ts` |
| Look: sky, light, time | `sky.ts`, `skyFog.ts`, `Atmosphere.tsx`, `lighting.ts`, `timeOfDay.ts`, `TimeScene.tsx`, `lookBlend.ts`, `MatchRain.tsx` |
| Performance | `quality.ts` (the tiers: AUTO, HIGH, MEDIUM, LOW), `QualityGovernor.tsx` (adaptive resolution), `QualitySettings.tsx`, `Prewarm.tsx` (shader pre-warm), `sceneOpt.ts` |
| Sound | `audio.ts` (gun and sfx synthesis), `ambience.ts`, `AmbienceListener.tsx`, `musicStyles.ts`, `musicVoices.ts` |
| HUD pieces | `Minimap.tsx` |

### Folders

| Folder | What's there |
| --- | --- |
| `src/game/ui/` | Menus and HUD styling: title screen, loadout, settings, pause and end screens, shop bar; `kit.tsx` holds the shared design tokens |
| `src/game/input/` | Keyboard, gamepad and touch bindings, remapping, aim and aim assist, movement, falls, the sprint meter, controller settings |
| `src/game/art/` | Shared art kit: guns (`guns.ts`, `GunView.tsx`), the player rig, cars, muzzle flash and gun effects, debris, shadows, boss models |
| `src/game/art/robots/` | Robot enemy models: classic kinds, new kinds, specials, bosses |
| `src/game/access/` | Elevators, stairs, ladders and rooftops, shared by every big map (4 floors or fewer get stairs, 5 or more get an elevator) |
| `src/game/scenes/` | Lazy per-map scene bundles: one `React.lazy` wrapper per big map so its meshes/textures download only when picked |
| `src/game/structures/` | Physical rooms and stacked floors (the plan that rendering, feet, cameras and shots all read), facades and openings |
| `src/game/events/` | Mid-match map events: the Vice blackout, the Whiteout avalanche, and hooks for the Gulch train robbery and the Pier wave surge |
| `src/game/life/` | Ambient life: marine animals on the Pier, skiers and wildlife on Whiteout |
| `src/game/western/` | Dry Gulch: layout, meshes, cliffs, river, train and robbery, riders, tumbleweeds, storm, sounds |
| `src/game/beach/` | Pacific Pier: layout, meshes, the Ferris wheel ride, the wave surge |
| `src/game/alpine/` | Whiteout Pass: terrain, forest, lift ride, weather, enemies |
| `src/game/nuketown/` | Nuketown: layout and scene (being rebuilt) |

## Where to change…

| I want to… | Go to |
| --- | --- |
| Add or hide a map in the picker | `themes.ts` (`offered()`, `wip`) |
| Tune how hard a wave is | `difficulty.ts` |
| Change a class, ability or perk | `classes.ts`, `abilities.ts`, `perks.ts` |
| Change a gun | `art/guns.ts` (looks), `projectiles.ts` and `ballistics.ts` (behaviour) |
| Add an enemy type | `enemyKinds.ts` and `art/robots/`, appended to the end of the list (co-op sends kinds by index) |
| Change a menu or the HUD | `ui/` |
| Change the page title or credits | `src/routes/__root.tsx` |
| Change what counts as "slow" | `quality.ts`, `QualityGovernor.tsx` |
| Add a stair, lift or roof | `access/` |
