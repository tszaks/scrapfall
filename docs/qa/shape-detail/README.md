# Public map shape and construction detail

The follow-up to PR40 adds construction trim to shared usable buildings, fuller Whiteout boughs and rooted Gulch shrubs. See [natural-form pairs](../natural-forms/README.md) and [Pier before](pier-before.png) / [after](pier-after.png). These are player-height screenshots; camera placement for comparison is not traversal evidence. Pier images precede the final 6 mm reduction in trim projection.

Construction detail follows exterior solid wall fragments and remains within their opening boundaries. It adds no draw batches, excludes all new vertices from collision, and hides its indexed suffix on LOW. Added whole-map triangles: Pier 5,712, Vice 2,676, Whiteout 3,360; Gulch has no shared structures. Spruce and shrub HIGH triangle budgets stay unchanged. Gulch LOW drops from 100 to 80 triangles per shrub. Live quality changes preserve geometry and instance buffers. Room namespaces advance to v20 under the repository's generated-world rule.

## Verification

- 59 unit tests, typecheck, production build and repo-map check passed.
- [Live HIGH/LOW/HIGH and AUTO transitions](quality-transitions.json) passed on all four public maps, including new Gulch shrub ranges and construction detail. World and geometry identities remained stable; no browser errors.
- Native-input traversal, Vice seed7 on the PR40 base: [spawn to Grand West stairs and return](traversal-native.json); [four-storey roof round trip](traversal-access.json); [offset walk](traversal-offset-corrected.json); [offset forward sprint](traversal-arrow-sprint.json). No jumping, no position assignment during routes, no stuck detections in the final sprint. Only the Grand West route begins from actual spawn; corner-building routes use an exterior setup position. Native arrows supply aiming in the sprint route.
- Production smoke entered all eight public map/time combinations with zero errors. [Co-op](coop.json) passed host transfer and fresh guest joining at wave 5.
- No movement/collision change was justified by the tested routes. Other seeds, maps, spiral stairs and co-op traversal remain unverified.

Sustained performance results will be recorded separately. These screenshots do not establish photorealism, native Safari performance, physical input latency or the full long-duration performance acceptance gates. Nuketown remains excluded.
