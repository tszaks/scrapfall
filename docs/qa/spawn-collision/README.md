# Shorter enemy approaches and solid stopped traffic

Tyler requested halving the existing long-distance spawn policy after live play on 2026-10-04. The shared `spot()` street ring now uses `min(400, PLAY_HALF) / 2` for its inner radius and 1.5 times that radius for its outer radius.

| Map / mode | Previous requested ring | New requested ring |
| --- | --- | --- |
| Vice Heights / Dry Gulch solo | 280–420 m | 140–210 m |
| Vice Heights / Dry Gulch co-op | 400–600 m | 200–300 m |
| Pacific Pier / Whiteout Pass solo and co-op | 400–600 m | 200–300 m |

Pier and Whiteout use PLAY_HALF=400 in both modes; their generators enforce their own solo seals. The isolated summit and explicit roof-zone ring stay 18–27 m; direct roof placement, roof capacity, doorstep overflow, train boss placement, small arenas and short pickup placements retain their existing behavior.

Initial enemies, reinforcements and stuck/distant-enemy recovery already call the same `spot()` policy. All those street arrivals therefore use the halved ring. `spawnNear()` is unchanged: hidden placement may try an outer radius 1.6 times larger (solo Vice/Gulch336 m; other street cases480 m), with its existing LOS preference, all-player exclusion, terrain/nav constraints and cramped-area fallbacks. Requested ring values are not a guarantee of every observed distance: reachable space and those fallbacks still apply. Recovery's far-enemy trigger remains max(500, PLAY_HALF*1.5), avoiding respawn churn for an enemy already approaching.

Stopped traffic had no player movement collision; its speed-dependent contact code only applied a weak intermittent sideways impulse. Player walking now uses the existing enemy traffic hull collision, shared from `trafficCore.ts`. A zero-speed car remains solid, long moves are swept, roof clearance is height-aware, and an already-overlapped body can move toward shallower overlap or slide along an existing overlap toward an open end. Each hull is checked separately so escape cannot enter a second car. Enemy separation uses the same guard. Vehicle exit candidates reject other traffic hulls. No vehicle art, ambient driving, damage rules or driver visibility changes.

Validation status and browser evidence are recorded below before review. Unit coverage includes rotated fronts/sides, clear sliding, roof clearance, overlap escape, long-step tunneling, obstacle relocation and existing enemy collisions. A physical controller is not part of this scoped change.
