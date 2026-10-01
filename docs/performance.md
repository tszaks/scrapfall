# Performance verification

Target: highest sustainable AUTO graphics at 60 FPS. Desktop AUTO may reach HIGH's DPR 2;
mobile starts conservatively. Manual presets remain available. The controller trades
visual detail, never enemy counts, physics rates or network simulation.

## Reproduce

Run `npm ci`, `npx playwright install chromium webkit`, `npm test`, `npm run build`,
then `npm run serve:static`. In another terminal:

```
QUALITY=auto WAVE=10 REPEATS=3 SECONDS=600 npm run benchmark
ENGINE=webkit QUALITY=auto WAVE=10 REPEATS=3 SECONDS=600 npm run benchmark
node scripts/performance-flows.mjs
node scripts/performance-adaptation.mjs
node scripts/performance-coop.mjs
node scripts/performance-loading.mjs
SOAK=1 MAPS=vice QUALITY=auto WAVE=10 SECONDS=1800 TAG=endurance npm run benchmark
```

Results default to `artifacts/performance`. Set `BASE` for a different server, `OUT`
for the output directory, `TAG` to preserve each report, `MAPS` to select scenarios,
and `BROWSER_PATH` to use a specific installed browser. `PLAYWRIGHT_MODULE` optionally
points at an existing Playwright ESM installation. `COMMIT` can label an uncommitted
candidate; otherwise reports contain HEAD. The report records whether the working tree is dirty.

Run baseline and candidate sequentially on the same powered device and viewport.
The benchmark uses real game simulation with assisted aiming, ammunition and
invulnerability. It reports browser frame intervals, not physical display delivery.
It is not a substitute for native Safari, an unassisted match or co-op play.
`SOAK=1` replenishes late-wave combat when fewer than five enemies remain and
there are no pending spawns. Minute checkpoints record graphics-resource counts,
shots, enemies and AUTO settings. This mode explicitly changes the test scenario,
not the game shipped to players.

Compare fixed HIGH separately from AUTO; AUTO gains can be improved quality rather
than more FPS. Never compare frame rates across changing power/display conditions.
`renderSubmit*` is outer renderer wall time, not GPU execution time. `callback*` is
individual RAF callback duration, not all CPU work per frame. GPU time is sampled
only when EXT_disjoint_timer_query_webgl2 is exposed; unavailable timing is null,
not zero. Samples surround outer rendering including nested reflection passes,
and disjoint samples are discarded. Preparation `ms` is
summed synchronous preparation work; `wallMs` includes asynchronous waiting and
`maxStepMs` is the longest preparation callback. `passes` contains draw-only times.
The old preparation log had only a single synchronous `ms` measurement.

## Acceptance gates

- Three 10-minute runs per map and native browser: p99 frame interval <=20 ms,
  no reproducible game-caused warmed hitch >50 ms. Keep failures and exclusions.
- Test AUTO with graphics and CPU pressure, recovery, hidden tabs and resize;
  fixed-quality and AUTO reports are not interchangeable.
- Cold controlled network load: <=5 seconds at 50 Mbps/40 ms excluding menu dwell;
  cached replay <=2 seconds. Report startup separately from warmed samples.
- 30-minute combat and 10 map switches: no crashes/context loss or ongoing resource
  growth. Compare repeated visits to the same map after preparation.
- Co-op host/guest start, pause/resume, restart and reconnect; native keyboard,
  mouse, first effects, interiors and weather; physical input latency remains a
  hardware check. An unmet native gate is not an automated pass.

The preparation state is local: cancelled map generations cannot unlock a new map.
Context restoration repeats preparation; failure keeps controls blocked with a reload
message. Existing co-op messages and host authority are unchanged. The co-op test uses
keyboard fallback and accelerated final-wave damage. A pre-existing victory-state
overwrite (WAVE 13/12) is guarded against until React commits the end-of-match state. No telemetry is sent.
