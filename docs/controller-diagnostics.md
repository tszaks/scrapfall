# Physical controller diagnosis

Run `node scripts/controller-diagnostic.mjs` and open its loopback URL in the same browser used for Scrapfall. This does not open a browser or move focus automatically. Use the same controller and USB/Bluetooth connection as the failing game session.

1. Select the connection and controller, tap and release a button so the browser exposes it, then click **Start guided check**.
2. Release everything for the neutral sample. Follow the named controls one at a time, releasing each before the next. Pull triggers slowly through their travel.
3. Click **Download report**. A partial report can be downloaded after **Stop**. Reports stay in the browser until downloaded; the server receives no controller data.

The report contains browser version, connection selected by the player, gamepad identifier/mapping, neutral values, and labeled raw button/axis samples. It does not read the game's saved bindings, inspect OS controller settings, or prove that the game's action routing is correct. Do not commit personal reports automatically. Use a reviewed, minimal fixture if a report establishes a mapping defect.

The trigger fixtures in `scripts/gamepad.test.mjs` are synthetic API-contract tests, **not physical DualSense captures**. The trigger regression reproduces main `01f723efd9a18272e3a657869fe3ef54a34f395e`: `{ value: 0.2, pressed: true }` became `0.9`. The fix preserves the reported analog value. A browser's `pressed` threshold does not describe analog travel.

The separately labeled `scripts/fixtures/dualsense-edge-safari26.5-bluetooth.json` is a minimal reduction of the player's October 4 physical capture: DualSense Edge Wireless Controller Extended Gamepad, Bluetooth, Safari 26.5, standard mapping, 17 buttons and four axes. Face buttons, shoulders, triggers, stick clicks, D-pad and axes match standard indices. The player confirmed mixing up the Options/Create guided steps; the fixture corrects those two labels and preserves their original `reportedLabel`. No center-button swap is applied. All captured trigger values are 1, which does not demonstrate partial analog travel or the inflation bug on this hardware. The original capture predates the diagnostic's low-travel and release improvements. This fixture protects observed values without implying that all gameplay actions or saved bindings were verified.

Before changing raw indices, distinguish these cases:

- `mapping: "standard"`: the browser supplies positional indices. Do not rearrange face buttons based only on a Sony ID or USB/Bluetooth transport.
- Empty mapping: the existing fallback is heuristic. Establish the actual face/shoulder/trigger/stick/d-pad indices from labeled samples before adding a device profile.
- Correct raw inputs but wrong action: inspect saved game bindings and context conflicts. A local diagnostic has a different origin and cannot inspect production localStorage.
- Wrong prompts only: compare the detected controller family and action labels to the raw input; coordinate glyph changes with the HUD owner.
- A game URL containing `padshim` activates the synthetic controller and replaces real `navigator.getGamepads()` output. Remove that test parameter for physical playtesting.

Current default PS actions at that baseline: Cross jump, Circle ability, Square reload/interact (hold near a vehicle), Triangle ping, L1/R1 previous/next weapon, L2 aim, R2 fire/throttle, L3 sprint, R3 melee/hold revive, Options pause, Create map. Aim defaults to toggle. These are the game's defaults, not a claim about the player's saved settings or preferred layout.

References: [Gamepad API remapping](https://www.w3.org/TR/gamepad/#remapping), [WebKit GameController mapping](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/gamepad/cocoa/GameControllerGamepad.mm). Current upstream source does not establish the exact Safari/OS version or device state of a live user session.
