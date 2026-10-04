# Ambient traffic no longer clears waves

On production f4945961044c64d5f2ffe94f912c297d15d3f8d2, an untouched solo Vice seed11 run reached wave2 with4 credited kills about209s after navigation. The player never moved or attacked and still had full health. Ambient car collisions flowed through the player damage/reward path; the director correctly advanced after all robots died. [Live reproduction](live-before.json), [before HUD](live-before.png).

The fix preserves the intentional long-distance spawn policy. Ambient cars brake for all ground robots and resume when their lane clears. Unavoidable contact retains knockback but deals0 damage. Inactive gameplay disables contacts. Player-controlled cars remain outside this simulation; the separate Gulch train callback is unchanged.

## Verification

Implementation:2f87e42e5b753b504ee6a1899de17768348c5024. MacBook Pro/M4 Max, Chromium151 with Metal,1280×800 viewport.

- `npm run check`:65 tests, typecheck, production build and8 map/time smoke cases passed,0 console errors. Repo-map validation passed.
- Independent exact-head review found no blocking findings; reviewer independently passed all4 new simulation tests.
- [Four-minute natural solo run and controlled fixtures](after.json): all4 first-wave robots retained2HP, zero player shots/kills and no wave advance. No forced spawning/warps/damage during this phase. [After HUD](after-four-minutes.png).
- Subsequent deliberate car/enemy overlap invoked the actual contact callback:0 damage, unchanged2HP and1.6m physical shove. Paused overlap caused no hit or movement. These are controlled fixtures, not natural driving encounters.
- Subsequent controlled player damage defeated all4 enemies; the unchanged intermission advanced to wave2 and credited4 kills.
- [Co-op host loss and same-code rejoin](coop.json) preserved3 enemies with HP5,8,5 at wave5,0 errors.
- Simulation tests cover braking/restart at1/60s and4/60s distant-car steps, flyer/dead-enemy exclusions and player-controlled vehicle exclusion.

This fixes ambient-car wave clearing, not every navigation issue. The intentionally long approach and existing stuck-enemy relocation can still delay arrival. The natural run's nearest enemy reached roughly70m at211s. No claim that all maps/devices sustain60fps or every traffic congestion case is resolved.
