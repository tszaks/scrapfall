# Host-controlled live pause

Runtime candidate: `7854519f5b4f400f6b1c215dafbe88d5d66e58c4`.
Includes released PR47/49 and the reviewed PR50 recovery dependency.

## Behavior

An explicit host keyboard, controller Start, or touch pause holds the room. Guests see **Paused by host** and cannot resume it. Their own menu stays local. Co-op focus/pointer-lock loss only opens a local menu; solo keeps its menu pause behavior.

The shared simulation clock and frame guard hold enemies, damage, projectiles, map drivers, wave/bleed/revive timers, reloads, regeneration and gameplay cooldowns. The first resumed callback receives zero delta. Rendering and connection heartbeats continue. Paused guest gameplay messages are discarded, and guest-origin host-authority messages are rejected.

A fresh join receives the cached held world after mounting. Same-wave reconnect preserves recovery state and position. Host migration retains the pause so the successor can resume deliberately. Status replay suppresses wave banners; PR50's synthetic-initialization flag, seed guard and monotonic recovery ledger stay intact.

## Verification

- Independent static review: three rounds, final runtime candidate clean. Earlier findings concerning map drivers, wall-clock deadlines and remote presentation were fixed.
- Unit coverage: `scripts/simulation-pause.test.mjs` checks the held clock, repeated transitions, per-callback resumed delta and skier recovery. `scripts/room-recovery.test.mjs` checks spoofed authority, paused input rejection, live heartbeats, joining and host migration.
- Browser reproduction: `BASE=http://127.0.0.1:4186 node scripts/playtest-pause.mjs` uses two actual PeerJS pages and an RTC closure. `scripts/playtest-pause-maps.mjs` checks pause/settings/resume on all four offered maps.
- Final Node 22 `npm run check`: **PASS**, 89/89 tests, typecheck, production build and 8/8 night/sunset smoke cases; zero errors. Repo-map coverage and diff whitespace checks passed.
- Final solo browser check: **PASS** on Vice, Gulch, Pier and Whiteout, including settings and resume without catch-up; zero page errors. See `maps.json`.
- Earlier two-page actual PeerJS acceptance: **PASS**, ten checkpoints covering local guest menus, spoofed authority, 8.5-second freeze with live heartbeat, RTC reconnect, no timer catch-up, regeneration, repeated pause, focus loss, fresh joining and host transfer. The final integrated-head repeat is pending the parent’s functional window; no final-head co-op claim is made yet.

The browser harness uses keyboard/menu input and diagnostic setup for wound/downed state, active projectiles, regeneration and reloads. It does not establish physical controller/device acceptance. No quantitative performance benchmark is claimed; the parent owns the shared machine's benchmark allocation.
