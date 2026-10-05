# Context notices and compact shop

The production baseline is `bacff4378b011ca0348db8cb10b900212361f979` (PR54). Its 568×320 touch shop measures zero pixels wide and extends above the screen: see `before-touch-568-shop.png` and `before-shop.json`. The baseline toast screenshot comes from PR54's committed real co-op touch-input fixture; it shows feedback crossing the touch-action region.

The after captures use this branch's local production build. Context messages occupy a bounded lane. Held vehicle-entry progress takes priority over toast feedback, then crate/pickup confirmations, the shop, and routine travel help. Existing messages, timers, purchases and input actions are preserved. Compact shop content scrolls between the HUD and touch controls, with horizontal action/offer rows on touch devices; controller focus scrolls each selected button into view. Suppressed shop buttons leave controller traversal. Ammo and map presentation are hidden while the compact shop needs that space, then restored on closing.

Before/after and stress captures:
- `before-touch-568-shop.png` → `after-touch-568-shop.png`, `after-touch-568-offers.png`: real intermission shop, funded through existing debug enemy rewards, with an actual touch purchase.
- `before-toast-touch.png` → `after-toast-touch.png`: real host/guest room with an explicit cloned toast fixture; actual CDP touch input still activates and clears aim.
- `context-safe-insets.png`: recovery-message fixture at 568×320 with CDP-emulated left/right 47px and bottom 21px safe insets.
- `controller-hold.png`: actual controller hold-to-enter progress over a feedback fixture; releasing the input restores feedback priority.
- `controller-long-offer-safe-insets.png`: deliberately cloned long-offer text fixture, navigated through the Gamepad API with emulated safe insets. This is a layout fixture, not an offer that was purchased.
- `desktop-shop.png`: desktop intermission shop.

Functional coverage includes 10 context cases; 15 shop cases (real horizontal/vertical touch swipes over both horizontal rows, touch purchase, controller focus/purchase, hidden-shop exclusion, mid-reload opening, countdown, repeated pause/resume, and two wave/shop cycles); three real co-op cases; seven HUD layouts; and 17 ammo regressions. JSON reports record zero browser errors. The final local gates also include all 98 unit tests, typecheck, production build, repository-map validation, and eight map/time smoke entries. Logs are included.

Run each browser script serially against an isolated production server:

```sh
BASE=http://127.0.0.1:5450 OUT=/tmp/hud-context node scripts/playtest-hud-context.mjs
BASE=http://127.0.0.1:5450 OUT=/tmp/hud-shop node scripts/playtest-hud-shop.mjs
BASE=http://127.0.0.1:5450 OUT=/tmp/hud-coop node scripts/playtest-hud-coop.mjs
BASE=http://127.0.0.1:5450 OUT=/tmp/hud-layout node scripts/playtest-hud-layout.mjs
BASE=http://127.0.0.1:5450 OUT=/tmp/hud-ammo node scripts/playtest-ammo-hud.mjs
```

Controllers use the browser Gamepad API; touch gestures use CDP. No physical controller, phone, or notched screen was tested. There is no quantitative performance benchmark or performance claim. Shared Game/Squad/TravelView changes are presentation-only and retain the released pause/input/recovery behavior. Native Library upload was unavailable, so the screenshots are committed here.
