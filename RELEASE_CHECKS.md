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
  decks retain doorway headroom. Start approaches in the public street, before all
  frontage props, rather than immediately beside the door. Check the full usable
  width: rotated crate/barrel clusters, troughs, lamps, hitch rails, door leaves and
  window sills must respect the actual opening. Repeat generated layouts with seeds
  1, 7, 11, 42, 1337 and 20260928. Walk on hills and return to the valley.
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

The separate doorway correction checks 48 centerline approaches and 552 width lanes
across six generated layouts using the rendered collision triangles. All 186 rear
lanes and 174 stable-front lanes clear. The only 48 contacts are at visible angled
saloon door leaves outside their usable opening; those are intentional. Actual-input
checks cover 31 front/rear roundtrips over three seeds, plus six focused stable rear
edge roundtrips. Prop collision grids follow relocated props; seeded random-number
consumption and repeated generation match. Room namespace v7 separates this changed
layout from older clients. Joining clients have a 15s initial heartbeat grace while
they construct the shared world; established host/guest silence limits remain 5/8s.
The timer-policy regression covers slow loading, eventual timeout, recent heartbeat
recovery and late joins. Co-op acceptance must verify actual position updates after
world construction, not merely the appearance of a room code or player count.
The final packaged two-client check passed four actual front/rear roundtrips,
with zero remote-position error and both clients still connected after 34 seconds.

Full raw reports, screenshots and scripts are retained at
`/tmp/scrapfall-polish-20260928/`; the live release record is at
`http://127.0.0.1:8787`. Browser device emulation does not establish physical phone
or controller acceptance. The weather matrix checks launch/input and fixed state;
it does not mean every map/weather combination was played through all 12 waves.
Production acceptance additionally requires the deployed commit, direct/proxy asset
readback and gameplay against `https://szakacsmedia.com/game/`.
