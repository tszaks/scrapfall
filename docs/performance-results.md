# Local performance validation — 2026-09-30

Baseline: `8decaa5`. Candidate: `codex/scrapfall-adaptive-performance`.
Reference machine: Mac16,6, 36 GiB memory, macOS 26.5.1, AC power.
These results describe the original local candidate a3cf0a3 against 8decaa5, before integration with current main. They are historical measurements, not measurements of the integrated release.

## Integration with current production

Current main (984ff06) introduced sliced world construction, sixteen shader warm batches, new menus, postprocessing and an endgame victory latch. Those implementations are preserved. The original async whole-scene preparation and disabled-entry gate are superseded by main's batched preparation and queued entry. The release retains AUTO recovery, the desktop DPR ceiling, nested render timing that includes the final postprocessing pass, and reflection/prewarm state restoration. The historical compile-failure/context-recovery assertions below do not describe the retained upstream preparation implementation. Release validation is recorded separately in the live deployment report.

## Verified changes

- Desktop AUTO can reach HIGH / DPR 2 and targets 60 FPS. Synthetic 28 ms CPU
  pressure reduced quality; removing pressure restored HIGH / DPR 2. Manual HIGH
  remained selected under pressure. Recovery is intentionally gradual.
- Preparation compiles and draws variants in separate steps, avoids redundant live
  mirror rendering, restores temporary state, and gates controls until ready.
- A failed compile blocks entry; switching maps recovers. A lost/restored WebGL
  context repeats preparation. Ten map selections and keyboard controls passed.
- Co-op start, synchronized pause/resume, new arena, and reconnect passed. A baseline
  victory overwrite was reproduced and fixed: another frame could replace the
  completed-wave result with a non-winning wave 13 status before React committed it.

## Fixed HIGH comparison

Vice, seed 11, rain, late-wave assisted combat; 1280×800 at DPR 2. Sequential
baseline/candidate/candidate/baseline; 20 measured seconds per run.

| Build     | Callback FPS | Frame p99 (ms) | Frames >50 ms | Preparation work (ms) | Longest preparation step (ms) |
| --------- | -----------: | -------------: | ------------: | --------------------: | ----------------------------: |
| Baseline  |        113.5 |           17.1 |             7 |                   940 |                           940 |
| Candidate |        116.4 |           17.3 |             3 |                   417 |                           105 |
| Candidate |        117.6 |           16.6 |             1 |                   447 |                           110 |
| Baseline  |        119.0 |           15.7 |             3 |                   816 |                           816 |

Preparation has less synchronous work and smaller blocking steps. Total elapsed
preparation still includes asynchronous waiting; these values do not establish a
faster overall load. Steady FPS is similar, with varying combat paths/enemy counts.
A TypeScript check overlapped the first candidate startup. This is a diagnostic
comparison, not an isolated laboratory estimate of percentage improvement.

GPU queries were exposed in Chromium (18–19 samples per short run). Sampled p95
varied from 5.1 to 13.6 ms across the four runs, so no GPU speedup is claimed.

## Broader checks

- Candidate Chromium AUTO: five 30-second late-wave routes, approximately 115–120
  callback FPS; p99 10.2–17.2 ms. Four maps had occasional >50 ms frames.
- Candidate WebKit AUTO: five 20-second late-wave routes, about 60 FPS on Vice/Pier/
  Nuketown, 30 on Whiteout, 44 on Gulch. These are headless WebKit timings, not native
  Safari results. GPU timing was unavailable. The full 60 FPS gate is not met.
- Cold navigation to first successful shot: 3.95, 3.68, 3.69 seconds. Empty browser
  cache, 50 Mbps throughput, 40 ms added latency, scripted menu actions; 2.88 MB
  transferred. This meets the proposed five-second target in this local setup.
  The earlier first-enemy metric included an intentional wave-start countdown and
  is not a control-readiness measurement.
- Ten map switches took 0.56–5.44 seconds. The two-second transition goal is not
  consistently met. Procedural seeds differ; two visits do not prove leak freedom.
- Native Chrome Guest visibly rendered the full Vice scene at HIGH / DPR 2 and
  accepted pause. Pointer-capture computer-control calls repeatedly failed with
  `noWindowsAvailable`, so native movement/shooting and sustained acceptance are
  unverified. Safari reported hidden and remains unverified.
- A 60-second candidate CPU-profile run recorded 65 callback FPS and 24 >50 ms
  frames amid substantial concurrent Mac activity. Renderer preparation/submission,
  traffic, navigation and garbage collection appeared in the sampling profile;
  it does not isolate a causal source for individual hitches. It is not directly
  comparable with the short earlier runs.

## Remaining acceptance gates

Thirty minutes of assisted late-wave combat completed with 6,347 shots, a peak of
39 enemies, and no JavaScript/console errors. Shader programs stabilized at 262.
Geometry count changed from 2,213 to 2,266 and textures from 165 to 167; small
continuing geometry growth means leak freedom is not established. Process RSS
fluctuated and is not a JS-heap measurement. Frame p99 was 34.2 ms, with 134 frames
over 50 ms and a worst frame of 476.3 ms amid changing cadence/system load. This is
not a smoothness acceptance pass.
It exposed brief repeated DPR reductions after cadence-neutral upgrades. The final
controller retains a verified upgrade while conditions are similar, rechecks after
five minutes, and invalidates protection on pressure/loading/visibility/resize.
This controller-only correction passes dedicated regression tests and a final-build
pressure/recovery/manual-HIGH integration check. That synthetic integration check
uses uncapped headless Chromium to isolate controller behavior. The completed
endurance build predates this correction.
Three ten-minute native repetitions per map/browser, physical input latency,
consistent sub-two-second transitions, and reproducible warmed hitch elimination
remain unverified or unmet. Do not describe this work as a 100/100 certification.

Raw reports and screenshots are retained in the local live report's `evidence/`
directory. Reproduction commands and metric definitions are in `performance.md`.

## Final code checks

TypeScript, production build, all 12 unit tests, and changed-production-file lint
checks pass. ESLint reports one existing missing `equip` effect-dependency warning
in Game.tsx and no errors. The main checkout remains unchanged.
