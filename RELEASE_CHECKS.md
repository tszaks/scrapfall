# Scrapfall release checks — 2026-09-28

This release adds Nuketown, fixed random match weather, bullet drop and Longshot with
remappable aiming, the Dry Gulch terrain/model pass, and shared geometry/AI fixes.

## Repeatable checks

```sh
npm test
npx tsc --noEmit
npm run build
```

`npm test` checks frame-rate-independent trajectories, fixed-speed sight zeros,
Longshot drop, degenerate inputs, deterministic weather and co-op override isolation.
The production build stages the static app at `dist/site/game/`.

## Gameplay acceptance

- All five maps: start, move, jump, shoot, change aim state and confirm no renderer errors.
- Weather: sunny/rain/night/sunset remains fixed through waves; co-op and late joins
  share the host seed. New Arena replaces rain resources, including sunny→sunset.
- Dry Gulch: store and saloon front/rear doors, sheriff/bank front doors, stable
  front/rear doors and the hotel porch work in both directions. Low/high generated
  decks retain doorway headroom. Walk on hills and return to the valley.
- Nuketown: both mirrored front/rear entrances, garage/kitchen openings, internal
  stairs, rear balconies/external stairs and the truck ramp are traversable. AI
  navigation excludes furniture and player-only upper floors.
- Hold and toggle aiming: mouse, remapping, touch AIM and pause/reset. Longshot
  scopes to the eye from third person and restores the saved shoulder view.
- Down state: enemies leave downed players, pursue standing teammates or wander;
  revive consumes/restores the correct resource and health and permits reacquisition.
- Geometry: crane slings meet the beam; wheel openings clear body cladding;
  parked wagon tongues are folded without unsupported team harnesses; furniture
  has feet; log ends are closed; fountains have recessed water and continuous jets.

## Evidence and limits

The local acceptance record includes 20 weather/map cases, five-map actual PeerJS
checks plus late joins, 16 Dry doorway directions using actual keyboard movement,
both Nuketown house routes, solo/co-op fall-and-revive sequences, 51 configured
weapon/pitch zero calculations, 38 combat regressions and six terrain/layout seeds.
Each independent QA artifact records its source hashes and distinguishes diagnostic
positioning from actual input. Later fixes received focused retests.

Full raw reports, screenshots and scripts are retained at
`/tmp/scrapfall-polish-20260928/`; the live release record is at
`http://127.0.0.1:8787`. Browser device emulation does not establish physical phone
or controller acceptance. The weather matrix checks launch/input and fixed state;
it does not mean every map/weather combination was played through all 12 waves.
Production acceptance additionally requires the deployed commit, direct/proxy asset
readback and gameplay against `https://szakacsmedia.com/game/`.
