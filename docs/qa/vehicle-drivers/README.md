# Ambient vehicle driver art

The optional `driver` flag on `CarBatch.place` draws an original seated upper-body silhouette. One cached 348-triangle geometry and one shared instance batch serve every car type. Existing paint-mask material colors the shirt per vehicle; no texture, skeleton, NPC simulation or collision is added. Driver visibility distance follows the current quality tier: HIGH45m, MEDIUM32m, LOW22m. Parked callers default to empty; wrecks suppress occupants.

Cabin fitting lowers the concealed torso rather than compressing the head. The first prototype compressed sports-car figures vertically; independent review identified that risk and the placement was corrected before these captures.

## Diagnostic visual evidence

Current-production baseline3cbda85 and isolated candidate were served from separate verified static builds. Chromium151 used ANGLE Metal on the M4Max, viewport1280×800, DPR1, HIGH, Vice seed11, sunny sunset. All nine vehicle types were captured from front and side at1.6m player eye height. Traffic was frozen for matching camera poses. All18 before/after camera pairs match; both runs have zero errors.

The candidate capture explicitly uses `DIAGNOSTIC_DRIVERS=1`: a temporary runtime getter enables the art before the gameplay-owned Traffic integration lands. This is visual evidence only. It does not establish car-entry behavior, co-op behavior or performance. The script and JSON record this override; it is not game code.

Independent review inspected all18 candidate views and matched baselines for sedan, sports, bus and van. No roof, glass or exterior protrusion blocker was found. Seated silhouettes read through the glass, especially from the side and through bus/van windshields. Low sports roofs limit visibility; hands sit low relative to the wheel, so this is not evidence of anatomically accurate steering grip. The bus side view crops the driver end; the front view establishes its occupant.

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

Full local captures are preserved in `output/playwright/drivers/`; representative pairs and full camera/error metadata are committed here. The full local suite passed69/69 on the initial art commit; the revised placement passed all three focused geometry/occupancy/quality tests, typecheck and build. Final-head CI and independent review are separate gates.

## Integration boundary

The optional flag defaults false. Gameplay owns the Traffic caller and player-body hiding. Activation must distinguish ambient cars, local driving, remote occupants, previously claimed empty cars, parked cars and wrecks without duplicate bodies. The current diagnostic is not proof that this integration has shipped. Controlled rendering measurements and actual entry/exit/co-op checks remain required before enabling the feature in production.
