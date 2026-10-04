# Fixed ammo / reload HUD

The user-provided `before-user.png` shows the projected ammo label overlapping the elevator floor button. `desktop.png` and `desktop-look.png` show the fixed HUD at the same viewport rectangle after yaw/pitch input. `reload.png` shows progress in that slot. `desktop-ads.png` confirms the panel remains visible above the Longshot scope mask.

`controller.png` shows the Switch reload glyph after Xbox and PlayStation checks. `controller-844.png`, `controller-568.png`, and `keyboard-568.png` cover short non-touch screens: ammo, sprint, the longest ability name (KINETIC BARRIER), self-revive status, and minimap stay separate. Sprint and ability flow together beside ammo so wrapped text cannot overlap.

`touch-landscape.png`, `touch-667.png`, and `touch-568.png` cover 844×390, 667×375, and 568×320. Ammo clears the minimap, SELF REVIVE chip and action buttons. `touch-portrait.png` confirms the existing rotate-device screen at 390×844. `downed.png` confirms ammo is absent during the self-revive prompt. The elevator root-state assertion verifies ammo hides while the floor controls are active.

Run `BASE=http://127.0.0.1:4187 node scripts/playtest-ammo-hud.mjs` against the isolated dev server, or set BASE to a production server. It writes screenshots and `results.json`. The final production-build capture recorded 17 functional assertions with zero page errors. Controller input is simulated through the browser Gamepad API; no physical controller or phone was tested. Vehicle visibility uses the existing debug handle. No performance benchmark was run: this adds no scene rendering or per-frame React updates.

Shared Game.tsx changes are presentation-only: the AmmoHud import/mount, stable input-mode marker, and a status wrapper for compact layout. TravelView preserves controller entry progress, driving glyphs, travel positioning, and world signs; only the ammo fallback is removed. No revive, vehicle, or movement logic changed.
