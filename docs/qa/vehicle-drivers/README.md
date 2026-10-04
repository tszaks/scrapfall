# Ambient vehicle driver art

The optional `driver` flag on `CarBatch.place` draws an original seated upper-body silhouette. One cached 348-triangle geometry and one shared instance batch serve every car type. Existing paint-mask material colors the shirt per vehicle; no texture, skeleton, NPC simulation or collision is added. Driver visibility distance follows the current quality tier: HIGH 45 m, MEDIUM 32 m, LOW 22 m. Parked callers default to empty; wrecks suppress occupants.

Cabin fitting lowers the concealed torso rather than compressing the head. The first prototype compressed sports-car figures vertically; independent review identified that risk and the placement was corrected before these captures.

## Diagnostic visual evidence

Current-production baseline 3cbda85 and isolated candidate were served from separate verified static builds. Chromium 151 used ANGLE Metal on the M4 Max, viewport 1280×800, DPR 1, HIGH, Vice seed 11, sunny sunset. All nine vehicle types were captured from front and side at 1.6 m player eye height. Traffic was frozen for matching camera poses. All 18 before/after camera pairs match; both runs have zero errors.

The candidate capture explicitly uses `DIAGNOSTIC_DRIVERS=1`: a temporary runtime getter enables the art before the gameplay-owned Traffic integration lands. This is visual evidence only. It does not establish car-entry behavior, co-op behavior or performance. The script and JSON record this override; it is not game code.

Independent review inspected all 18 candidate views and matched baselines for sedan, sports, bus and van. No roof, glass or exterior protrusion blocker was found. Seated silhouettes read through the glass, especially from the side and through bus/van windshields. Low sports roofs limit visibility; hands sit low relative to the wheel, so this is not evidence of anatomically accurate steering grip. The bus side view crops the driver end; the front view establishes its occupant.

| Empty sedan | Seated driver |
| --- | --- |
| ![Before](images/before-sedan-side.png) | ![After](images/after-sedan-side.png) |

| Empty sports car | Driver under the low roof |
| --- | --- |
| ![Before](images/before-sports-side.png) | ![After](images/after-sports-side.png) |

| Empty bus | Bus driver |
| --- | --- |
| ![Before](images/before-bus-front.png) | ![After](images/after-bus-front.png) |

| Empty van | Van driver |
| --- | --- |
| ![Before](images/before-van-side.png) | ![After](images/after-van-side.png) |

Full local captures are preserved in `output/playwright/drivers/`; representative pairs and full camera/error metadata are committed here. The full local suite passed 69/69 on the initial art commit; the revised placement passed all three focused geometry/occupancy/quality tests, typecheck and build. Final-head CI and independent review are separate gates.

## Night views

All 18 matched night camera pairs also passed independent visual review with no browser errors. Silhouettes are naturally dim through tinted glass; standard front views are faintest and the van front is clearer. The same diagnostic override is recorded. Full camera/error metadata is in `night-before.json` and `night-after.json`.

| Empty sedan at night | Seated driver at night |
| --- | --- |
| ![Before](images/night-before-sedan-side.png) | ![After](images/night-after-sedan-side.png) |

| Empty van at night | Van driver at night |
| --- | --- |
| ![Before](images/night-before-van-front.png) | ![After](images/night-after-van-front.png) |

## Traffic integration

The gameplay owner approved and released the Traffic hook: unclaimed ambient cars show a driver; local driving hides it; remote ownership shows it. Parked ambient cars, previously claimed empty cars and wrecks suppress it. The optional art flag still defaults false for other callers. Player-body hiding remains owned by the controller release and must be present before activation.

`activation.json` verifies the actual Traffic caller with no occupant override on Metal M4 Max: keyboard entry hides the driver, keyboard exit keeps the claimed car empty, an explicit parked fixture is empty, remote ownership shows the driver and remote exit removes it. A real ray-based `damageVehicle` call reduces the car to zero health and suppresses its driver. Browser errors are empty. Remote ownership is a direct state fixture here, not a two-peer co-op acceptance test.

The reviewed art/API commit `ce869ed` passed required CI, including 69 tests, typecheck, build, repository map and smoke. Eight additional local map/time smoke cases passed. The later Traffic hook passed typecheck, build, three focused tests and independent static review. Final integration-head checks, actual two-peer body cooperation and the exclusive rendering comparison remain pending. This document does not establish a production release or sustained frame rate.
