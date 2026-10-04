# Independent review

Read-only independent reviewer: `review_realism`, separate from implementation.

Resolved findings:

- Restored access helpers accidentally removed during an early rail edit.
- Closed the underside of elevated facade trim.
- Prevented duplicate sill/header triangles where room cuts split vertical spans;
  added a regression assertion for duplicate triangles and clear cutouts.
- Guarded room exposure's environment-map uniform for Pier ride materials that
  do not have an environment map; verified the no-env shader branch separately
  in code review and through all-map browser smoke checks.

The reviewer verified the final facade-culling wiring, quality updates, disposal,
collision exclusion, leaf winding/UVs, atlas layer expansion, matching visible/shadow
coverage and fine-scale surface-relief parameters. No outstanding actionable code
findings were reported at implementation head `f9584d7`.

Visual assessment: the structural bays, larger usable entrance and small leaf sprays
are a stronger improvement than the initial narrow-trim pass. The game remains
visibly stylized; this is not a verified 30-to-60 score change.

Review limitations: the independent reviewer did not run the browser. Runtime,
visual and performance evidence was produced by the implementation owner. The
90 m culling radius applies to 150 m chunk bounds, and alpha-tested foliage trades
vertex count for fill/shadow cost; both were included in runtime verification.
