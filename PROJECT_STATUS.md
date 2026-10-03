# Project Status

Outcome: Implement both October 3 Scrapfall feedback transcripts. Vero is explicitly excluded.
State: In progress. Implementation is present; final verification and review remain.

## Verified evidence
- Isolated worktree from origin/main ae2f7c5, branch codex/oct3-playtest-fixes.
- Money-drop regression failed before and passed after retaining corpse coordinates.
- Focused tests pass for magazines/reload, shared money deduplication, uninterrupted two-second revive, and host recovery.
- scripts/playtest-ui.mjs passes: both rink gates; seven tower laps up/down, max floor step 0.011m; recovery; retained weapon and 42-round refill; both ski routes without body collisions; shared lift seats.
- /tmp/scrapfall-features-check.json verifies ping removal and snowmobile entry/24m driving/exit.
- /tmp/scrapfall-coop-check.json verifies two real browser clients, host transfer with three live enemies and their health and wave retained. Abrupt close plus a new join is the next check.
- Earlier npm run check passed all maps at night/sunset. Final source changed since, so rerun before push.

## Decisions and boundaries
- Preserve current basic player/enemy speed, Whiteout atmosphere, and weapon identity.
- Full Scrapfall scope authorized. Main is production; prepare a draft PR, no merge/deploy.
- Spawn target 400m on large maps, scaled on compact maps and summit. A visible/near enemy must not be recycled.
- Reload R, melee B, ammo purchase K; controller actions contextual. Touch actions added.
- Combat ammo: retained guns, 35% wave supply, 50% purchasable supply, matching pickups. Death still resets guns.
- Shop breaks 30s, including overtime; tactical sprint 3.6s; boss base HP 900; reduced pistol upgrade scaling.
- Subway entrances transfer to the next station; no full underground train scene.
- Work is in broad gameplay areas. Login PR #34 and Nuketown PR #23 are untouched.

## Remaining work
- Complete abrupt-host-close/rejoin, city vehicles, combat/overtime, and performance checks; fix failures.
- Review changes, run final npm run check and repository-map validation; prepare draft PR.
- Live page: http://127.0.0.1:18963/ . Detailed local evidence and task state under /tmp/scrapfall-*.
