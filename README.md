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

Play it at **https://tylerszakacs.com/gta**.

## Controls

| Key            | Action        |
| -------------- | ------------- |
| W A S D        | Move          |
| Mouse / arrows | Look          |
| Click          | Shoot         |
| 1-0            | Switch weapon |
| F              | Ability       |
| E              | Use (elevator, ladder, revive) |
| N              | Day / night   |
| P / Esc        | Pause         |

URL options: `?map=city`, `?night=1` / `?night=0`, `?shadows=0` / `?shadows=1`.

## Development

Needs Node.js 20.19 or newer.

```sh
npm ci
npm run dev            # Vite dev server; open the printed URL + /gta/
```

## Build and hosting

The game is a static single-page app served under the `/gta/` base path. There is no
server runtime: TanStack Start runs in SPA mode and prerenders one HTML shell.

```sh
npm run build          # vite build, then stages dist/client into dist/site/gta/
npm run serve:static   # serves dist/site like the deployment: http://localhost:4173/gta/
```

- Build command: `npm run build`
- Output directory: `dist/site` (the game lives in `dist/site/gta/`)
- `vercel.json` sets the install / build commands and output directory, and rewrites
  `/gta` and any unknown `/gta/*` path to `/gta/index.html`, so hard refreshes work.
- tylerszakacs.com proxies `/gta/*` to this project's deployment.

## Code map

- `src/game/Game.tsx`: the game loop, weapons, enemies, waves, HUD, co-op.
- `src/game/cityLayout.ts`: the city generator (streets, lots, buildings, props); pure
  data, so every co-op client builds the same city from the shared seed.
- `src/game/cityMesh.ts`, `cityGeo.ts`, `cityTextures.ts`, `City.tsx`: the city renderer
  (merged chunk geometry, one facade texture array, sky reflections, night lighting).
- `src/game/trafficSim.ts`, `Traffic.tsx`: traffic simulation and rendering.
- `src/game/Minimap.tsx`: the city minimap.
- `src/game/net.ts`: co-op over PeerJS.
