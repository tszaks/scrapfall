# Controller interaction and vehicle fixes

The standard Square mapping was correct, but its handler sent ordinary interactions only to the shop. Beside the same eligible Vice car, production Square did nothing while keyboard E entered. The same dropped action explains Whiteout's ski prompts.

Cars now require a 0.65-second Square hold with screen-fixed progress. Releasing, losing/changing the target, pausing, disconnecting or resetting controls cancels it. A completed hold cannot repeat or immediately exit. Other interactions keep a tap. Keyboard interaction bindings remain unchanged.

R2 supplies analog throttle; L2 brakes to a stop without automatically reversing; the movement stick steers. Releasing R2 coasts. Keyboard forward/reverse remains available. Steering uses the car's +Z forward direction, including reverse. Entry/exit requires neutral triggers before their new role becomes active; driving suppresses shooting, melee and ADS.

Local and remote standing rigs are hidden while their player owns a car and restored on exit. Remote pose caches follow the car while hidden. Driver targets sit inside the cabin; intercepted enemy shots damage the covering hull, and destruction uses existing ejection. Ownership is cleaned up for death/downing, departure and host transfer. This adds no new player mesh. Ambient/seated occupant art is a separate PR.

Room namespace v23 appends analog braking to guest driving input and separates clients with different driving behavior. All peers must load the new build to share the same room namespace.

## Evidence and checks

Hardware: MacBook Pro, Apple M4 Max. Functional checks use isolated Chromium with Metal,1280×800 viewport, and the built-in simulated DualSense `padshim=ps`; no physical controller or native Safari claim.

- Pure unit coverage: deliberate hold lifecycle, partial/full throttle, coast/brake priority, finite inputs and left/right forward/reverse steering at four headings.
- `scripts/playtest-vehicle-input.mjs`: real input routing, hold progress/cancel/range/pause/disconnect, held-button single activation, trigger pressures, coast, brake, weapon/aim carryover, local body hide, keyboard entry and steering, reload away from a car.
- `scripts/playtest-vehicle-coop.mjs`: actual PeerJS guest entry, host-authoritative gas/steer/brake, hidden/restored remote body, hull damage, host loss/transfer, same-code rejoin, actual vehicle destruction and ejection.
- `scripts/playtest-square-interactions.mjs`: a normal Square tap starts both blue and red Whiteout ski runs without reloading.

Fixtures deliberately position a registered moving-traffic car and players on open ground. These are controlled regression checks, not natural gameplay or proof that scenery-parked cars are drivable. Parked-car conversion, stopped-car collision, spawn range, revive position and the final ammo HUD are separate work.

No new sustained60fps claim. Browser behavior and regression evidence do not establish universal performance across devices or browsers.

## Recorded results

Runtime source: `cb57f36` (precise hull sweep correction included). [Before](before.json): simulated Square failed and E entered the same car. [Final controller results](controller.json):30 named checks,0 errors. [Final co-op](coop.json): enemy test round reduced hull HP100→90; guest braking stopped the host-authoritative car; local/remote standing rigs hid in the car and restored on exit, including host transfer and actual wreck ejection. [Whiteout ski results](ski.json): Square tap entered both blue/red runs without starting reload,0 errors.

[Hold progress](hold-progress.png), [local driver without standing rig](local-driver.png), [remote driver hidden](remote-hidden.png), [remote restored on exit](remote-restored.png), [Square starts red ski run](red-square-start.png).

Local full `npm run check` plus repo-map:73 tests, typecheck, build and8 map/time smoke cases passed on `c2c7c02`. The subsequent small hull-point/sweep correction passed typecheck/build,7 focused tests and all final browser suites above. Final PR CI repeats the complete repository gate on the final head. An abnormal generated output directory stalled one local staging attempt; it was preserved separately and clean staging succeeded. This was a local build artifact issue, not a runtime exception.
