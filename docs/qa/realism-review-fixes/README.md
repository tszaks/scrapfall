# Realism review corrections

Follow-up to PR #37's two P2 review findings. Baseline: production merge c9ea2fb304f4ef54f519d26ab4bd98502007873b.

- Pacific Pier tags only beach terrain for the sand scan. Skate concrete, parking asphalt and bluff terrain retain their own surfaces; boardwalk timber is unchanged.
- Surface relief follows the live quality tier through shared uniforms on all four maps, including AUTO changes. Materials and shader programs do not need to be reconstructed.
- Broadleaf crowns and near spruce keep stable vertices, colours and collision exclusions. Optional decorative triangles occupy the end of their index buffers; LOW reduces the draw range and higher tiers restore it. The existing geometry cache is safe to reuse across quality changes. Existing geometry disposal also releases the index buffers, with no persistent listeners or replacement instance buffers.

## Verification

- 57 unit tests pass, including three new tests for Pier flags, low-first cached broadleaf construction, and manual/AUTO spruce transitions. The full local suite took about 223 seconds; the unchanged baseline physics test also took about 234 seconds. Early interrupted attempts are not counted as failures or passes.
- Typecheck, production build and repo-map coverage pass.
- All four public maps enter at sunset and night with zero browser errors (eight smoke cases).
- Headless Chromium with Metal: manual HIGH → LOW → HIGH and AUTO LOW → HIGH pass on all four maps. Uniform values update; geometry, instance colours, instance matrices and world objects retain identity. No browser errors. [Results](quality-transitions.json).
- Low-first cached template rebuilds and disposal are covered by the unit tests. An actual network host rebuild and physical-phone endurance were not rerun for this follow-up.

Run `npm test` for the regressions. For interactive scene assertions, start the dev server, then run `BASE=http://127.0.0.1:5197 node scripts/realism-quality-browser.mjs`. This diagnostic uses dev-module imports to drive manual and AUTO changes; it does not alter production debugging APIs. Existing production smoke tests separately verify shader compilation and rendering.
