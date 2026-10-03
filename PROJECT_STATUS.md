# Project Status

Outcome: Implement both October 3 Scrapfall playtest feedback lists. Vero is excluded.
State: Local implementation and verification complete. Draft PR prepared for owner review.

## Verified evidence
- Draft PR: https://github.com/tszaks/scrapfall/pull/36
- Branch: codex/oct3-playtest-fixes, based on origin/main ae2f7c5. Existing checkouts preserved.
- npm run check passed: 49 tests, typecheck, static build, all five maps at night/sunset with zero console errors. Repository-map validation passed.
- npm run test:playtest passed against the local static build: both rink gates, seven tower stair laps up/down, recovery, retained/refilled weapons, both ski routes, shared lift seats, reload, ammo purchase, melee, city driving/destruction, subway destination, and overtime shop.
- npm run test:coop passed with actual browser clients: close the host tab at wave 5; survivor retains three live enemies and HP [2,2,1]; a new guest rejoins the same room at wave 5. Zero page errors.
- Money-coordinate regression failed before the fix and passed after it. Shared loot claims are deduplicated on the host.
- Controlled Chromium/Metal Whiteout combat with 12 robots and 54 shots: programs compiled during play 1 -> 0; longest frame 122 ms -> 37 ms; frames over 50 ms 1 -> 0. Typical timing varies; this proves the first-shot improvement, not all-device FPS.
- Current GitHub CI and preview status: use the PR checks, not this snapshot.

## Decisions and boundaries
- Production is unchanged. Main deploys automatically; no merge or production deployment was authorized.
- Preserve basic player/enemy speed, Whiteout atmosphere, weapon identity, and shared rewards.
- Collected guns remain when empty; death still resets them. Magazines reload with R. Wave supplies refill the pistol and add 35% to other guns. Ammo purchases cost 8 scrap for 50% supply. B uses unlimited melee; K buys ammo. Touch and contextual controller controls are present.
- Large maps target 400-600m spawn distance where possible. Compact arenas and the summit use shorter ranges. Nearby or visible enemies are not recycled.
- Shop breaks are 30s and continue in overtime. Tactical sprint lasts 3.6s. Revive takes 2s and ordinary damage does not reset it. Pistol damage-upgrade growth is reduced; boss base health is 900 and grows in overtime.
- Subway entrances transfer to the next station. There is no underground train scene. Moving traffic and snowmobiles can be driven; parked scenery cars are not converted into drivable vehicles.
- No physical PS4 controller, physical phone, separate-home TURN test, or full manual playthrough is claimed.
- Login PR #34 and Nuketown PR #23 are untouched. This change spans combat/HUD, co-op, Whiteout/access, city traffic, and prewarm.

## Handoff
- Review PR #36 and its current checks before deciding to merge.
- Local results: http://127.0.0.1:18963/
- Local playable build: http://127.0.0.1:5185/game/?map=whiteout
- Worktree: /Users/tyler/Projects/Worktrees/Scrapfall/oct3-playtest
- Detailed local evidence and task tracker: /tmp/scrapfall-*.
