# Scrapfall

Scrapfall is Toby Szakacs's arena shooter (this build is based on his 1.0.2 release:
classes, loadouts, the shop, touch controls). This fork by Tyler Szakacs adds four
real-scale maps, a compact Nuketown arena and the systems around them.

Fight waves of robots through a real-scale
downtown (1 unit = 1 metre): about 600 x 600 m solo and 800 x 800 m in co-op, with a
480 m landmark tower, glass skyscrapers, walk-ups, a park, a boardwalk, live traffic
that stops at the lights, day and night, and up to four players in co-op.

The map picker offers Vice Heights, Dry Gulch, Pacific Pier, Whiteout Pass and
Nuketown, plus Random. Nuketown has opposing two-storey houses, accessible interiors,
garages, balconies, backyards and a central bus/truck lane. Add `?map=city` to go
straight to the city or `?map=nuketown` for the compact arena.

Every match randomly chooses sunny, rainy, night or sunset conditions and keeps them
for the entire run. Co-op players share the host's conditions, including late joins.
Whiteout Pass uses snowfall for its wet-weather condition.

Play it at **https://szakacsmedia.com/game/**.

## Controls

These are the defaults. In Settings, choose Auto, Keyboard + Mouse or Controller,
then select an action and press the key, mouse button or controller button to bind it.
Bindings and device preferences are saved; conflicts can be replaced and defaults restored.

| Keyboard + mouse           | Controller (Xbox / PlayStation / Switch Pro) | Action                                           |
| -------------------------- | -------------------------------------------- | ------------------------------------------------ |
| W A S D                    | Left stick                                   | Move                                             |
| Mouse / arrows             | Right stick (aim assist, Settings)           | Look                                             |
| Hold left click (or Enter) | RT / R2 / ZR                                 | Shoot                                            |
| Right click                | LT / L2 / ZL                                 | Aim down sights (toggle or hold in Settings)     |
| Space                      | A / ✕ / B                                    | Jump                                             |
| Hold Shift                 | Click left stick                             | Sprint (1.5x; no shooting while sprinting)       |
| Double-tap Shift           | Double-click left stick                      | Tactical sprint (1.9x for 3 s, recharges in 6 s) |
| F                          | B / ○ / A                                    | Ability                                          |
| 1-0, Q / E                 | LB / RB, d-pad up / down                     | Switch weapon                                    |
| E (in an elevator car)     | X / □ / Y                                    | Floor button                                     |
| G / middle mouse           | Y / △ / X                                    | Ping                                             |
| Hold R                     | Hold right stick in                          | Revive yourself in solo or a teammate in co-op   |
| Z X C, H, R                | LB / RB, then X / □ / Y                      | Shop items, field dressing, reroll               |
| J                          | Select in shop, then X / □ / Y               | Buy a replacement solo self-revive kit           |
| V                          | Assign in Settings                           | First / third person                             |
| M                          | View / Create / −                            | Big map                                          |
| P / Esc                    | Menu / Options / +                           | Pause                                            |

Menus work with the d-pad or left stick, A to press and B to go back. On-screen hints
switch to the controller's own glyphs when you use it, and back when you touch the
keyboard. Phones get JUMP and SPRINT buttons (tap SPRINT twice for a tactical sprint).

Collision follows the visible solid geometry, including round props, wall edges and
vehicle shapes. Jumps clear waist-high fences and props; higher barriers still block you.
Roofs can be jumped off, with continuous falling onto lower roofs or the ground.
Falls hurt by height, and a fall of seven or more floors downs you.

Solo runs start with one self-revive kit. While down, hold Revive for three seconds
before the twenty-second bleed-out ends. A revive restores half your class's health
and grants three seconds of protection. Carry one kit at a time; replacements cost
12 shards in the shop, with rare enemy drops from wave three onward (at most two finds
per run, at least three waves apart). A new run resets the kit.

Metal rounds drop under gravity; energy weapons retain their straight trajectories.
The Longshot sniper becomes available from wave four, carries 12 rounds and uses a
4× scope with a 50 m sight zero. Aiming reduces sway and look sensitivity; scoping
from third person temporarily uses the eye view, then restores the shoulder view.

Downed players attract no new attacks. Enemies pursue a standing co-op teammate or
wander locally until a live player becomes available again.

Dry Gulch now places its town in a valley with traversable hills, while roads,
railways and building foundations retain level footing. Doorways, foundation trim,
porch steps, furniture supports and horse/wagon assemblies share their visible
geometry with collision.

Dry Gulch tumbleweeds roll when bumped and break when shot. Their fragments remain
where they settle for the rest of the run, including for co-op players joining later.

Solo diagnostic URL options: `?weather=sunny`, `?weather=rain`, `?weather=night`,
`?weather=sunset`, `?shadows=0` / `?shadows=1`. Co-op ignores local weather overrides.

## Development

Needs Node.js 20.19 or newer.

```sh
npm ci
npm run dev            # Vite dev server; open the printed URL + /game/
npm test               # deterministic physics and match-weather regressions
```

## Build and hosting

The game is a static single-page app served under the `/game/` base path. There is no
server runtime: TanStack Start runs in SPA mode and prerenders one HTML shell.

```sh
npm run build          # vite build, then stages dist/client into dist/site/game/
npm run serve:static   # serves dist/site like the deployment: http://localhost:4173/game/
```

- Build command: `npm run build`
- Output directory: `dist/site` (the game lives in `dist/site/game/`)
- `vercel.json` sets the install / build commands and output directory, and rewrites
  `/game` and any unknown `/game/*` path to `/game/index.html`, so hard refreshes work.
- szakacsmedia.com proxies `/game/*` to this project's deployment; tylerszakacs.com redirects there.

## Code map

- `src/game/Game.tsx`: the game loop, weapons, enemies, waves, HUD, co-op.
- `src/game/cityLayout.ts`: the city generator (streets, lots, buildings, props); pure
  data, so every co-op client builds the same city from the shared seed.
- `src/game/cityMesh.ts`, `cityGeo.ts`, `cityTextures.ts`, `City.tsx`: the city renderer
  (merged chunk geometry, one facade texture array, sky reflections, night lighting).
- `src/game/trafficSim.ts`, `Traffic.tsx`: traffic simulation and rendering.
- `src/game/Minimap.tsx`: the city minimap.
- `src/game/net.ts`: co-op over PeerJS.
- `src/game/nuketown/`: compact arena layout, shared structure/collision data and rendering.
- `src/game/western/earth.ts`: matching Dry Gulch rendered and walkable terrain.
- `src/game/ballistics.ts`, `projectileContact.ts`: trajectories and swept projectile hits.
- `src/game/matchEnvironment.ts`, `MatchRain.tsx`: fixed match conditions and sheltered rain.
- `src/game/input/aim.ts`, `ScopeOverlay.tsx`: remappable aiming and sniper scope.
