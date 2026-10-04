# Driving route measurements — 2026-10-04

The wider chase view adds measurable work in this diagnostic. It is not an FPS improvement, and these results do not establish a clean non-regression pass. The playability changes and further performance work should be assessed separately.

## Method and validity

Apple M4 Max; Chromium 151.0.7922.34; actual renderer `ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)`; 1512×982, DPR 1, HIGH quality, sunny Vice seed 11. Uncapped headless Chromium used `--disable-gpu-vsync --disable-frame-rate-limit`. Each case measured scripted W input for 15 seconds after 3 seconds of stationary warmup. This is controlled simulation input, not Safari, a physical controller, or real-player FPS.

Baseline port 5309 served `15540cf9cd74356c2aeaf805691e54b4e32c8255` (released 49/47); candidate port 5307 served `b038d4d8304eab1d320eaf80f476168120797dd3`. The supplied source SHA is provenance metadata, not independently verified by the harness; HTML hashes and asset URLs fingerprint served content. Hardware, renderer, route poses, and metrics are in [performance.json](performance.json). Both use the same street start and normal simulation acceleration. Traffic encounters and distance can vary, so these are matched start/duration scenarios rather than identical replayed frames.

Order: baseline native, candidate native, baseline 4× CPU, candidate 4× CPU, candidate native repeat, baseline native repeat. The final candidate drive covered 199.94 m versus baseline 200.88 m. All six driving cases sustained movement and had zero page errors.

The first three walking fixtures hit a parked car after about 4.5 m. They are **invalid for moving-foot comparisons**. The corrected candidate walking cases cover 58.12 m (4×) and 58.68 m (native), but a corrected baseline walking case remains missing. `validMovingRoute` overrides the legacy `sustainedMotion` field in archived data. Do not compare those invalid baseline walking samples against the moving candidate. Route version 2 moves the unused parked car to the opposite lane; the driving setup is unchanged.

The window was coordinated but desktop-contended. A full process snapshot during the final run showed fileproviderd 120.6%, mds 107.8%, Google Drive 103.1%, WindowServer 33.9%, and mds_stores 33.3% CPU. These are late-window observations, not exact per-case utilization. Earlier process-name columns were truncated and cannot support precise app attribution. No background apps were killed. Full process inventories remain local.

Candidate native repeat ran within 20:54:16.097–20:54:59.262 UTC (two cases). Baseline native repeat ran within 20:56:02.359–20:56:24.401 UTC (one case), with a 15.0065-second measurement. Those bounds come from run-start metadata and final report modification times. Exact wall-clock measurement starts were not captured; later harness versions add them. The final browser closed after report writing and before the completion notification. These data do not show overlap with the separately reported 20:57–20:58 driver isolation window.

## Driving results

All time values below are milliseconds. The columns labeled CPU measure elapsed callback wall time with `performance.now()`, not CPU consumption. They include scheduling interruptions, synchronous driver waits, throttling delays, and small diagnostic overhead. Render duration includes all renderer submissions; GPU p95 samples only the main scene pass, not every pass. CPU and GPU execute concurrently; do not sum them. Throttled GPU p95 has only 37–38 samples, so precise tail comparisons are unsupported.

| Case | Frame p95 / p99 | >25 / >50 ms frames | RAF elapsed mean | Outside-render elapsed mean | Render elapsed mean | Main GPU p95 | Draw calls mean | Triangles mean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline native | 4.0 / 8.8 | 1 / 0 | 2.386 | 0.895 | 1.490 | 3.841 | 177.0 | 1.809 M |
| Candidate native | 4.5 / 13.5 | 5 / 1 | 2.964 | 1.381 | 1.584 | 4.464 | 181.1 | 1.829 M |
| Baseline 4× CPU | 31.4 / 49.0 | 74 / 9 | 12.066 | 6.818 | 5.248 | 3.137 | 175.5 | 1.777 M |
| Candidate 4× CPU | 33.3 / 49.6 | 79 / 10 | 12.459 | 7.138 | 5.321 | 2.981 | 180.9 | 1.821 M |
| Candidate native repeat | 4.1 / 12.1 | 3 / 1 | 2.751 | 1.207 | 1.545 | 3.833 | 184.5 | 1.858 M |
| Baseline native repeat | 3.9 / 9.6 | 1 / 0 | 2.281 | 0.885 | 1.397 | 3.731 | 175.0 | 1.784 M |

The closest-distance repeat shows +0.470 ms mean RAF callback duration, about +0.322 ms outside render submission and +0.148 ms in render submission. Outside-render time includes rendering-related work outside `gl.render` and diagnostic overhead; it is not a physics timer. Draw calls increase about 5.4% and triangles about 4.1%. Native candidate frame tails are worse in both orders. Under contention these values are diagnostic, not a causal estimate of the camera alone.

## What is and is not explained

- **Visibility/rendering:** the 83° chase camera sees more geometry than the 75° baseline. Draw counts support added rendering work. Main-pass GPU timing varies between runs; the 4× CPU tail is far larger than the sampled GPU pass.
- **CPU/collision:** `vehicleCamera.ts` performs seven offset sweeps through `PlayerView.tsx`. Each `firstWorldHit` in `enemyProjectiles.ts` checks static and traffic rays plus 10 cm world point samples. This is a concrete added path, but the measurements do not isolate its time. Existing `driving.ts` hull collision probes and substeps are another candidate; no profiler evidence yet establishes their contribution.
- **Shader/streaming:** one to three shader-program-count changes occurred during each driving route. No new resource entries occurred during the measured routes. This does not rule out CPU scene construction, geometry uploads, or shader hitches; individual stalls have not been correlated to those events.
- **Co-op:** functional host/guest transfer and control tests pass, but this solo benchmark does not measure guest snapshot cadence or prove that smoothing eliminates network-related judder.

Further attribution needs a coordinated CPU profile, corrected paired walking routes, and representative real gameplay. Low-overhang/slope routes, permanent room-leave restoration, and physical Safari/DualSense behavior remain separate validation limits. Do not infer a 60 FPS guarantee from this uncapped diagnostic.
