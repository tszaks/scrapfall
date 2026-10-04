# Organized HUD

Before captures are from public production at `15540cf9cd74356c2aeaf805691e54b4e32c8255`, after the fixed-ammo release. After captures use this branch's local production build. Screenshots show normal player-eye views, not scene renders arranged for presentation.

- `before-desktop.png` → `layouts/desktop-full-inventory.png`: bounded match, weapon, and vitals columns. The after case deliberately gives every weapon and selects Longshot to verify the selected card scrolls into view.
- `before-touch-568.png` → `layouts/touch-568.png`: grouped match/kit/sprint and compact health, with fixed ammo and touch controls remaining separate.
- `layouts/keyboard-568.png`, `layouts/controller-568.png`, and 844px cases cover compact non-touch screens and controller glyphs.
- `layouts/touch-568-stress-fixture.png` uses explicit DOM fixtures for Whiteout's long map label, empty kit, 999 health, and three downed teammate labels. It is not a four-player networking test.
- `coop/real-guest-844.png` is a real two-page host/guest room. The co-op compact boss captures use real host boss/status messages and snapshots, with explicit DOM fixtures for the longest boss name and three downed teammates. The frozen boss is positioned with the existing debug handle; boss mechanics are not under test.

The layout harness checks pairwise separation of persistent match/loadout/vitals/compass/ammo/minimap, active wave/boss panels, and touch buttons, plus complete visibility of the selected weapon. It writes measured rectangles and screenshots before asserting, preserving failure evidence. Compact boss status suppresses the duplicate wave announcement. The touch minimap is slightly smaller to clear the additional co-op action row.

Validation: 82 unit tests, typecheck, production build, repository-map check, eight map/time smoke cases with zero errors, seven layout cases, three co-op cases, and 17 ammo regressions. Logs and JSON results are included. The ammo suite covers look movement, reload, pause/resume, vehicles, scoped aim, downing, elevator visibility, input glyphs, and compact/portrait layouts.

Run the scripts against an isolated production server:

```sh
BASE=http://127.0.0.1:4188 OUT=/tmp/hud-layout node scripts/playtest-hud-layout.mjs
BASE=http://127.0.0.1:4188 OUT=/tmp/hud-coop node scripts/playtest-hud-coop.mjs
BASE=http://127.0.0.1:4188 OUT=/tmp/hud-ammo node scripts/playtest-ammo-hud.mjs
```

Controller input is simulated through the browser Gamepad API; no physical controller or phone was tested. CSS safe-area offsets were reviewed, not tested on a notched physical screen. No performance benchmark or performance claim is made. Existing transient pickup toasts can cross touch action buttons; this focused pass does not change their placement. Co-op captures wait for the loading veil and initial pickup toast to finish before measuring persistent regions. A separate existing-toast visibility fixture confirms every touch button remains reachable and real CDP touch input activates and clears aim; see `coop/toast-touch-input.png` and `toastInput` in the results. The first version of that check assumed hold aim; it was corrected to support the existing toggle-aim setting.

Shared `Game.tsx` edits are presentation-only. No revive, pause, vehicle, input, enemy, or network mechanics changed. Native Library upload was unavailable, so these committed images are the reviewable evidence.
