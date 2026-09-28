# Scrapfall · Vice Heights

Scrapfall is Toby Szakacs's arena shooter (this build is based on his 1.0.2 release:
classes, loadouts, the shop, touch controls). This fork by Tyler Szakacs adds four
real-scale maps and the systems around them.

Fight waves of robots through a real-scale
downtown (1 unit = 1 metre): about 600 x 600 m solo and 800 x 800 m in co-op, with a
480 m landmark tower, glass skyscrapers, walk-ups, a park, a boardwalk, live traffic
that stops at the lights, day and night, and up to four players in co-op.

The map picker offers the four big maps (Vice Heights, Dry Gulch, Pacific Pier,
Whiteout Pass) plus Random; add `?map=city` to the URL to go straight to the city.

Play it at **https://tylerszakacs.com/game**.

## Controls

| Keyboard + mouse     | Controller (Xbox / PlayStation / Switch Pro) | Action |
| -------------------- | -------------------------------------------- | ------ |
| W A S D              | Left stick                                   | Move |
| Mouse / arrows       | Right stick (aim assist, Settings)           | Look |
| Hold left click (or Enter) | RT / R2 / ZR                           | Shoot |
| Space                | A / ✕ / B                                    | Jump (A / ✕ presses the floor button in an elevator car) |
| Hold Shift           | Click left stick                             | Sprint (1.5x; no shooting while sprinting) |
| Double-tap Shift     | Double-click left stick                      | Tactical sprint (1.9x for 3 s, recharges in 6 s) |
| F                    | B / ○ / A                                    | Ability |
| 1-0, Q / E           | LB / RB, d-pad up / down                     | Switch weapon |
| E (in an elevator car) | X / □ / Y                                  | Floor button |
| G / middle mouse     | Y / △ / X                                    | Ping |
| Hold R               | Hold right stick in                          | Revive a teammate |
| Z X C, V, R          | D-pad left / right, then X / □ / Y           | Shop |
| M                    | View / Create / −                            | Big map |
| N                    |                                              | Day / night |
| P / Esc              | Menu / Options / +                           | Pause |

Menus work with the d-pad or left stick, A to press and B to go back. On-screen hints
switch to the controller's own glyphs when you use it, and back when you touch the
keyboard. Phones get JUMP and SPRINT buttons (tap SPRINT twice for a tactical sprint).

A jump clears low props (benches, barrels, bins, hydrants) but not walls, railings or
blockades. Jumping over a roof's parapet drops you to the street: falls hurt by the
number of floors (7+ floors downs you; solo, that is game over).

URL options: `?map=city`, `?night=1` / `?night=0`, `?shadows=0` / `?shadows=1`.

## Development

Needs Node.js 20.19 or newer.

```sh
npm ci
npm run dev            # Vite dev server; open the printed URL + /game/
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
- tylerszakacs.com proxies `/game/*` to this project's deployment.

## Code map

- `src/game/Game.tsx`: the game loop, weapons, enemies, waves, HUD, co-op.
- `src/game/cityLayout.ts`: the city generator (streets, lots, buildings, props); pure
  data, so every co-op client builds the same city from the shared seed.
- `src/game/cityMesh.ts`, `cityGeo.ts`, `cityTextures.ts`, `City.tsx`: the city renderer
  (merged chunk geometry, one facade texture array, sky reflections, night lighting).
- `src/game/trafficSim.ts`, `Traffic.tsx`: traffic simulation and rendering.
- `src/game/Minimap.tsx`: the city minimap.
- `src/game/net.ts`: co-op over PeerJS.
