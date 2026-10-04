# Grounded environment pass

Draft PR: https://github.com/tszaks/scrapfall/pull/42. Hold merge and deployment.

Production baseline: `5bc373dd147a6b4401c1131d77e9d5190621a770`.
Implementation and independent-review checkpoint: `f9584d7`.

## Visible changes

Vice Heights' lower office fronts now have projecting slab faces and structural bays,
with real glazing behind their outer face. Lower-floor sills, headers and jambs track the
facade's existing module grid and leave actual room openings clear. Usable elevator
entrances have wider cantilevered canopies with closed soffits and slatted undersides;
stair entrances have larger raised hoods. No new decorative doorway implies access.

Broadleaf crowns in Vice and Pier use original small-leaf sprays in the existing facade
atlas. The visible shader and shadow shader use the same cutout coverage. A crown uses
864 triangles, with fewer sprays at LOW. This trades vertex work for alpha-tested fragment
work, so triangle reduction alone is not a performance result.

Stairwells use round subdued rails, distinct poured-concrete floor and masonry wall
finishes, wall skirting and small construction fixtures. Pier/Whiteout structures share
upper fascia relief and timber courses. Dry Gulch paint chips are smaller and less
contrasty. Exterior glass has more reflection and lower room exposure, preserving night
lighting. Albedo-derived grain relief is now subtle (12 mm procedural maximum, 6 mm scan
proxy), avoiding the carved paint appearance in the Gulch night comparison. The four production maps, gameplay layouts and multiplayer remain. Nuketown is
excluded. An experimental spruce rewrite was rejected after matched images showed a
worse silhouette; the established production spruce geometry is retained.

These views show a stronger improvement than the initial thin-trim checkpoint, especially
in Vice architecture and leaf scale. The other three maps receive smaller construction and
material improvements. Whiteout spruce silhouettes remain a visible weakness. The maps
remain visibly stylized. This report does not
assign an objective realism score or claim that Tyler's subjective 60 target has been met.

## Visual evidence

[Interactive matched comparison](index.html). Images are unedited and use saved camera
coordinates and angles, seed 7,1280×800, DPR 1, HIGH. The day set uses `weather=sunny`; the
other sets explicitly use matching `time` and `weather` values for night and sunset.
Traffic, particles and idle weapon motion are not frozen, so those can differ.

The complete local capture set retains spawn, side-facing and three deterministic random
walkable views per map, plus the Vice stairwell. This includes weak views rather than
selecting only flattering compositions. Pose manifests and selected evidence accompany
the report. Debug warps select static comparison views; movement tests are separate.

## Performance method

Apple MacBook Pro, Mac16,6, M4 Max (14 CPU/32 GPU cores), 36 GB unified memory, macOS 26.5.1.
Playwright Chromium 151.0.7922.34, ANGLE Metal on Apple M4 Max, headless and uncapped
(`--disable-gpu-vsync --disable-frame-rate-limit`),1280×800 logical viewport,DPR2,
2560×1600 drawing buffer,HIGH. Attached desktop display is 3840×2160 at 30 Hz; these are
browser headroom measurements, not physical display FPS. 60fps requires 16.7 ms/frame.

Production is served from an exact archived 5bc373d build on port 5286; candidate is its own
production build on 5287. Initial runs against an unrelated old 5186 server and SwiftShader
were discarded. They are not comparison evidence.

The active-combat diagnostic uses seed 11,rain,wave 4,40 seconds of WASD phases and aiming
at the nearest live enemy, with invulnerability/ammunition assistance. Trajectories and
enemy counts can diverge with frame timing; it is a reproducible workload, not an identical
simulation replay. Full-run p95/p99,worst frames,>16.7/>25/>50ms counts,CPU render submission,
GPU timer samples,draw calls,triangles and memory are retained. Program-count events and
startup long tasks separate first-use work from later hitches. The after 10 s subset is
reported without discarding whole-run failures. A later hitch is not automatically a shader
hitch just because the first one coincided with program creation.

Runs alternate baseline/candidate. No other task-owned GPU test runs concurrently with a
benchmark. Background desktop, file-sync and Docker activity was observed, and unchanged
baseline Whiteout p99 ranged 17.3–37.7 ms. This is a material measurement limitation; do not
interpret a single favorable run as proof of universal or hitch-free 60 fps.

[Full measurements and raw reports](PERFORMANCE.md) show final native candidate frame
p99 of 14.5 ms (Vice), 6.2 ms (Pier), 8.0 ms (Whiteout), and 11.9 ms (Gulch). This favorable
pass does not establish a patch-caused speedup in the other maps: baseline/run variability
is large. Vice's paired GPU p95 is 8.76 versus 8.38 ms baseline; CPU render submission is
4.31 versus 3.74 ms mean. The added visual detail has a measured cost.

All maps still have slow frames: final worst frames range 55.9–258.1 ms, and an earlier
candidate Gulch pass reached 621.9 ms. Some spikes occur after the first ten measured
seconds. Locked HIGH under 4× CPU stress averages 46.1 fps candidate versus 49.5 baseline.
AUTO reaches LOW/DPR 1 and averages 61.3 versus 65.2 fps, but still misses the strict target
on slow frames. Neither result proves sustained 60 fps under that stress.

The matched close-tree case has GPU p95 6.40 versus 6.12 ms and frame p99 14.2 versus
14.8 ms baseline. Its 864-triangle leaf crown improves visible leaf scale within that
measured budget. See the raw poses and reports rather than extrapolating to every device.

## Validation and remaining acceptance work

Independent review has no outstanding actionable code findings; see [review notes](REVIEW.md).

Final implementation browser checks passed:

- [64 matched camera pairs](evidence/capture-audit.json) across sunny, sunset and night;
  exact saved poses and zero measured camera-position difference, zero console errors.
- [Keyboard traversal](evidence/keyboard-playtest.json): a complete Vice switchback
  ascent/descent, map-menu transitions through all four maps, street movement and 30 shots.
- [Quality transitions](evidence/quality-transitions.json): manual and forced AUTO
  HIGH→LOW→HIGH on all four maps preserve world, geometry and instance buffers.
- [Two-page co-op](evidence/coop.json): matching wave/enemy health, host migration and
  guest rejoin; zero errors.
- [Gallery check](evidence/gallery-check.json): all 14 images load and seven comparison
  sliders work. Full local captures remain under `output/playwright/{views,sunset,night}`.

The final-head local check result is recorded in the PR description and handoff.
The earlier implementation checkpoint passed all 61 tests, type checking, build,
repo-map validation and all eight map/time smoke entries with zero errors.

Remaining acceptance limits: the game is visibly more grounded in the representative Vice
views, but remains stylized; the subjective 60 target needs visual review. Sporadic long
frames remain and sustained hitch-free 60 fps is not proven. The short-range facade batch is a coarse LOD; every possible boundary crossing was not
visually inspected. Collision verification covers
a reproduced stair route and sampled map movement; it does not establish that every
previously reported invisible wall or prop snag is fixed. Production release remains held.

## Budgets and provenance

Facade relief stays below 26 m and starts above 3.05 m. A dedicated merged batch per city
chunk is visible within 90 m of the 150 m chunk bounds, instead of the 330 m prop range.
This is coarse chunk culling, not a precise per-facade radius. Relief is removed on LOW
without changing movement. Crowns remain non-solid.
Quality changes reuse geometry/index/instance buffers. The room namespace is bumped to
v21 because generated visuals changed. No additional final scene render was introduced.

No new downloaded assets, purchases, accounts or credentials. New geometry, leaf texture
and concrete finish are authored here. Existing CC0 scans retain their provenance in
[material-sources.md](../material-sources.md).
