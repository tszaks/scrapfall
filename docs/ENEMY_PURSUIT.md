# Enemy pursuit routing draft

Base: `15540cf9` (includes the half-distance approach and stopped-car fix).

## Problem and change

Enemies were updated every simulation frame, including far from the player. The main failures were route validity rather than a distant-AI update throttle:

- The 4 m navigation grid accepted partly open cells and only checked structure walls between cells. Thin block fences and collision posts could cut an otherwise accepted edge.
- Steering chose paths using reduced grid clearance, while movement correctly rejected a full body hitting rendered geometry or traffic. Classic enemies alternated sidestep directions; newer walkers had no local route recovery.
- A rendered obstacle could occupy the next coarse waypoint. A local search aimed at that exact point could never finish.
- Ranged enemies held their preferred distance behind cover. A player standing tightly against a wall could also be unreachable as an exact full-body endpoint.

The draft stores clearance-checked coarse edges, follows the target field across those edges, and validates local routes with the existing full-body sweep. A persistent bounded A* detour keeps its chosen side of an obstacle. Blocked coarse endpoints advance along the same descending field to a clear endpoint. Player endpoints allow a collision-free approach within 1 m. Ranged hold decisions use cached shot visibility including rendered geometry.

Steering still uses the existing staggered memo. The local planner shares a 512-node search budget per simulation frame, a 24 m search radius, a 2 m lattice, and a 0.5 s failed-search backoff. Physical movement remains authoritative and checks every step. Obstacle stalls retry in place; they no longer teleport enemies to hidden spawn points. Existing explicit zone/range relocation rules are outside this change.

Enemy speeds, spawn-ring distances, traffic damage rules, stopped-car collision, player controls, pause/network protocol, and HUD behavior are unchanged.

## Reproduction and evidence

Run `node --test scripts/enemy-navigation.test.mjs` for deterministic simulation checks. They include a block fence, collision posts, moving targets, rendered mesh detours with normal/elite/large radii, occupied coarse/fine waypoints, wall-adjacent targets, ranged cover, memo retargeting, and failed-search backoff.

At an unchanged 1.3 m/s in the synthetic fence case, the old route failed within 90 s and remained stationary for 67.5 s. The corrected route arrived in 27.3 s with no stationary interval. The moving-target case arrived in 15.1 s and the picket case in 22.9 s.

For actual gameplay, `scripts/check-enemy-pursuit.mjs` runs headless Dry Gulch seed 7. The fixed fence fixture starts the enemy at `(-56.4,159.05)` and the player at `(-66.4,159.05)`. Unchanged main remained about 7 m away after 65 s; the draft reached the player after 35 s. Sampled full-body positions stayed valid, no enemy reposition occurred, and browser errors were empty. The player-view screenshot and JSON traces are retained under `output/enemy-pursuit*` in the task workspace.

The natural-spawn variant uses the actual queued spawn, never moves the enemy, then relocates the player after 45 s. It exposed the occupied-waypoint failure at `(58,-150)` before that fix was added. After the blocked-waypoint fix, it reached the relocated player in 187 s from an initial 201.9 m distance, with no teleport and no browser errors. All sampled positions passed full-body collision checks. The greatest stuck counter was 4 s; the longest sampled one-second displacement was under 2 m. This is arrival evidence at unchanged speed, not a frame-performance claim.

`scripts/check-pursuit-coop.mjs` uses genuine host and guest peers. The host-authoritative enemy followed the nearer guest from z=14 to z=16.72; after the guest moved away it followed the host to z=7.20. The guest's mirrored enemy was within 0.15 m, all sampled body positions were clear, and there were no page errors.

## Boundaries and release holds

- A physically sealed gate cannot be solved by navigation. `western/town.ts`'s `corral()` omits visible fence segments at the gate but marks the whole z1 side solid. This authored collision correction is separate and needs the coordinated world/protocol revision.
- Routes requiring a local excursion beyond 24 m, narrow corridors missed by the 2 m lattice, or disconnected destinations can fail conservatively. The draft does not hide such failures with obstacle-stall teleports.
- This is not a multi-level navigation redesign. Existing roof/access/ride zone rules remain, and the fine-field behavior on stacked maps needs broader gameplay coverage than map-entry smoke tests.
- Spawn spacing was not halved again. Further spacing tuning should use arrival behavior after pursuit is reliable.
- Concurrent Mac sessions invalidate quantitative performance conclusions. Local bounds are explicit, but native/4x frame-headroom profiling still requires a coordinated quiet window.
- No main-branch changes, merge, deployment, backend, or login work is included.
