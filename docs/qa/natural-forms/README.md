# Natural forms: bounded geometry refinement

Seed 7, sunset, HIGH, 1280×800. Paired screenshots use identical saved player-height camera poses from the four-map audit; camera warps are capture setup, not movement test evidence. Baseline is the existing review-fixes checkout build, candidate is this branch. Full three-view sets are retained at `/tmp/natural-forms-visual`; committed pairs show the altered assets most clearly.

- Whiteout: fuller sloped snow-bearing boughs, broader near crowns, and closer near/far crown radii. No added spruce vertices or draw calls; trunk geometry unchanged. The result remains visibly stylized.
- Gulch: five opaque stem/leaf clusters replace five smooth icosahedron blobs. Both HIGH models use 100 triangles. New LOW uses 80 triangles. Collision exclusion remains the entire shrub. Template random consumption stays unchanged so later generated prop templates retain their variation.
- No new assets, textures, transparent materials, or per-frame work.

Checks: typecheck and production build passed; 5 focused environment/natural-form tests passed. Both maps loaded and all six poses captured without page errors. These captures do not establish sustained combat, native input, co-op, mobile performance or frame-time acceptance; the combined release must run those checks separately. Raw final-pass render counters were deliberately omitted because they measure the postprocessing pass rather than complete frame work.

| Map | Before | After |
| --- | --- | --- |
| Whiteout | [Before](whiteout-before.png) | [After](whiteout-after.png) |
| Gulch | [Before](gulch-before.png) | [After](gulch-after.png) |
