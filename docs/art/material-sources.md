# Environment surface scans

Bundled under `public/materials/`. Downloaded at 1K resolution, unchanged, from Poly Haven on 2026-10-03. The game serves these files itself; it does not call an asset API during play.

All four scans use [CC0 1.0](https://polyhaven.com/license). Source URLs and file hashes are in `public/materials/sources.json`.

- [Concrete Floor 02](https://polyhaven.com/a/concrete_floor_02): building surface grain.
- [Wood Planks](https://polyhaven.com/a/wood_planks): timber in Dry Gulch and Whiteout.
- [Sand 01](https://polyhaven.com/a/sand_01): Pacific Pier ground.
- [Snow 02](https://polyhaven.com/a/snow_02): Whiteout snow.

Asset import powered by the [Poly Haven public API](https://github.com/Poly-Haven/Public-API). No live API dependency is shipped.

The source scans total 2.20 MB. Only scans needed for the selected map load. High and medium quality add shallow surface relief; low quality retains the scanned color grain. Foliage is original procedural geometry, merged into existing draw batches.
