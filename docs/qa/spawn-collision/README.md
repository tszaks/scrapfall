# Shorter enemy approaches and solid stopped traffic

Tyler requested halving the existing long-distance spawn policy after live play on 2026-10-04. The shared `spot()` street ring now uses `min(400, PLAY_HALF) / 2` for its inner radius and 1.5 times that radius for its outer radius.

| Map / mode | Previous requested ring | New requested ring |
| --- | --- | --- |
| Vice Heights / Dry Gulch solo | 280–420 m | 140–210 m |
| Vice Heights / Dry Gulch co-op | 400–600 m | 200–300 m |
| Pacific Pier / Whiteout Pass solo and co-op | 400–600 m | 200–300 m |

Pier and Whiteout use PLAY_HALF=400 in both modes; their generators enforce their own solo seals. The isolated summit and explicit roof-zone ring stay 18–27 m; direct roof placement, roof capacity, doorstep overflow, train boss placement, small arenas and short pickup placements retain their existing behavior.

Initial enemies, reinforcements and stuck/distant-enemy recovery already call the same `spot()` policy. All those street arrivals therefore use the halved ring. `spawnNear()` is unchanged: hidden placement may try an outer radius 1.6 times larger (solo Vice/Gulch336 m; other street cases480 m), with its existing LOS preference, all-player exclusion, terrain/nav constraints and cramped-area fallbacks. Requested ring values are not a guarantee of every observed distance: reachable space and those fallbacks still apply. Recovery's far-enemy trigger remains max(500, PLAY_HALF*1.5), avoiding respawn churn for an enemy already approaching.

Stopped traffic had no player movement collision; its speed-dependent contact code only applied a weak intermittent sideways impulse. Player walking now uses the existing enemy traffic hull collision, shared from `trafficCore.ts`. A zero-speed car remains solid, long moves are swept, roof clearance is height-aware, and an already-overlapped body can move toward shallower overlap or slide along an existing overlap toward an open end. Each hull is checked separately so escape cannot enter a second car. Enemy separation uses the same guard. Vehicle exit candidates reject other traffic hulls. No vehicle art, ambient driving, damage rules or driver visibility changes.

Validation status and browser evidence are recorded below before review. Unit coverage includes rotated fronts/sides, clear sliding, roof clearance, overlap escape, long-step tunneling, obstacle relocation and existing enemy collisions. A physical controller is not part of this scoped change.

## Browser verification

Released baseline `3cbda85` and candidate runtime `911b25c` were tested in isolated Chromium 151.0.7922.34 with Metal, 1280×800 viewport, on the same Apple M4 Max Mac. This was a functional comparison, not a performance benchmark. Vice Heights seed 11 uses the same unclaimed car (`city-1`), pose `(4,-112.1962)`, heading π, and keyboard W input for 2.5 seconds. The fixture pauses that car's ambient simulation without altering player collision or movement. The candidate replays the exact baseline fixture.

- Baseline: the player crossed from lateral −2.925 m to +6.306 m, through the car. The expected assertion failure is retained in `before.json`.
- Candidate: movement stopped at −1.370 m from one side and +1.340 m from the other, outside the 0.925 m half-width plus player clearance. Keyboard E entered/exited, and the player could walk away after exit.
- Both runs had 0 browser errors. Initial first-wave queued positions measured 302.5–358.2 m before and 167.5–183.0 m after (four enemies). These are unmodified initial placements captured before the car fixture; no claim about universal arrival time.
- Both independent-review findings were fixed and covered by tests: tangential escape between two cars, and enemy separation bypassing traffic collision. Review cleared exact runtime `911b25c`.
- 72 unit tests, typecheck, production build and repository-map check passed. All eight night/sunset smoke runs passed across Vice, Gulch, Pier and Whiteout, with 0 console/page errors.

Matched starting views: [before](before-approach.png), [after](after-approach.png). Results after the same held-forward input: [before: car crossed](before-walk-result.png), [after: stopped outside car](after-walk-result.png). Raw [baseline report](before.json) and [candidate report](after.json) include coordinates and entry/exit evidence.

Limits: no physical-controller testing, fresh co-op browser run or sustained-frame-rate claim for this follow-up; controller/co-op changes are covered separately by PR #48. Scope does not make scenery-only parked cars drivable. Room v24 is pending integration after controller release v23; re-review and integration checks are required after merging that release.

## Untouched natural engagement

A separate Vice Heights seed 11 run reached actual enemy melee contact without moving the player, firing, warping, spawning enemies or enabling invulnerability after entering the game. The checked candidate was `b1c24d66f48d46eb5247135034d06b74cdcbe523`, Chromium 151.0.7922.34/Metal, 1280×800 on Apple M4 Max.

| Observation | Prior live long-range run | Shorter-range candidate |
| --- | --- | --- |
| First sampled health loss | 265.419 seconds | 140.309 seconds |
| Health at contact | 15 / 16 | 15 / 16 |
| Player position throughout | x −57, z −28 | x −57, z −28 |
| Shots fired in candidate | — | 0 |
| Candidate nearest enemy at contact | — | 1.000 metre, line of sight clear |
| Browser errors | 0 | 0 |

All four candidate enemies remained alive on wave 1 at contact, with generation 1. Sampling was every five seconds: these are first observed damage times, not exact hit timestamps. This is one untouched scenario and demonstrates actual engagement after the distance reduction; it is not a general arrival-time or performance guarantee. The earlier live report did not record its build SHA, so it is labeled as a prior long-range run rather than an exact-head binary comparison. The separately replayed stopped-car comparison above does identify both builds.

Raw reports: [prior long-range](natural-before.json), [shorter-range candidate](natural-after.json). Contact screenshots: [before](natural-before-contact.png), [after](natural-after-contact.png). Browser and local server were closed when the run finished. This evidence was collected before integrating controller PR #48; repeat integration validation on the resulting head.

## Local controller integration preparation

Controller PR #48 head `1d0dad24010cb457a739bbfe6ab2dbad4f2fbd0d` (including released revive main `e39d9330cb78584188c33d910ef18004771e3e23`) is integrated locally for preparation. The merge retains all controller interactions, analog braking, steering and driver-body cleanup. Relative to that controller head, `driving.ts` adds only the traffic-depth import and exit-candidate collision check. Both collision and controller regression suites remain in `npm test`; room namespace stays v24 with the v23 protocol history retained. Final released-main integration, full checks and browser verification remain release gates before this branch is pushed.
