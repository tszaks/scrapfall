# Fixed ammo / reload HUD

The user-provided `before-user.png` shows the world-projected ammo label overlapping the elevator floor button. `desktop.png` and `desktop-look.png` show the fixed HUD at the same viewport rectangle after yaw/pitch input. `reload.png` shows the progress indicator in that same slot.

`touch-landscape.png`, `touch-667.png`, and `touch-568.png` cover 844×390, 667×375, and 568×320. The ammo panel clears the minimap, SELF REVIVE chip and action buttons. `touch-portrait.png` confirms the existing rotate-device screen at 390×844.

Run `BASE=http://127.0.0.1:4187 node scripts/playtest-ammo-hud.mjs` against the isolated dev server, or set BASE to a local production server. It writes screenshots and `results.json`, asserts a stable rectangle after look inputs, validates reload progress/counts, pause/resume, driving visibility, controller-family glyphs, touch overlap and downing visibility. Controller input is simulated through the browser Gamepad API; no physical controller or physical phone was tested. Vehicle visibility uses the existing debug handle. No performance benchmark was run: this change adds no scene rendering or per-frame React updates.

`controller.png` shows the Switch reload glyph after Xbox and PlayStation checks. `downed.png` confirms ammo is absent during the self-revive prompt. The production-build run recorded 13 passing functional assertions with zero page errors. All 69 unit tests on the combined revive + ammo tree, typecheck, production build, and repository-map coverage passed.

Shared Game.tsx integration is limited to the AmmoHud import and its conditional mount before ScopeOverlay. No revive, vehicle, or movement logic changed.

The smallest landscape view also checks the existing elevator HUD state: ammo hides alongside the weapon strip while the floor button prompt is active. A final layout fixture caught and fixed an 8.6px overlap before release.
