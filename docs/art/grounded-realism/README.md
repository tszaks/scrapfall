# Grounded environment pass

Base: `5bc373dd147a6b4401c1131d77e9d5190621a770` (production, 4 October 2026).

This pass adds shallow lower-floor facade geometry, fuller branched broadleaf crowns,
round stair rails, separate poured-concrete floor and masonry wall finishes, upper
construction fascia and timber courses, and smaller Dry Gulch paint flakes. Dusk/night
interior-mapped rooms are dimmer. The four production maps and gameplay layouts remain.
Nuketown is excluded. This is a draft for visual and performance review, not a release.

No new downloaded assets or purchases. New geometry and procedural textures are authored
in this repository. Existing CC0 scans retain their provenance in
[material-sources.md](../material-sources.md).

Facade detail is merged into existing distance-culled chunks and removed on LOW without
changing collision. Decorative crowns remain non-solid and stay below 2,000 triangles per
tree at HIGH. Quality changes retain the same geometry and instance buffers. New trim
avoids real room cuts and starts above player height. Room namespace is bumped to v21.

Matched screenshot, sustained combat, shader-hitch, traversal and co-op evidence will be
recorded here before this draft is handed off. No claim of universal 60 fps or an objective
60/100 realism score is made.
