# Held brake into reverse

L2/S brakes forward motion to zero, then a continued hold eases into reverse. R2/W first stops reverse motion before accelerating forward. Reverse acceleration is 3.5 m/s², capped at the smaller of 8 m/s or 35% of top speed. Both forward and brake pedals held together stop the car. Stale or released ownership input only brakes and cannot start reversing.

This increment preserves the released camera, renderer, vehicle art and controller mapping. It changes no protocol fields. The wider chase camera remains held in PR #52 on the performance guard.

Source-only independent review found no blocking findings at `232f9eedacbf4cd20076c983cb8fa77a6fd56e8d` against released main `15540cf9`. Eleven focused tests cover analog pressure, keyboard parity, stale input, and direction changes at 30/60/120 Hz. The full suite has 86 passing tests; typecheck, production build and repo-map checks pass. Eight Metal smoke cases (all four offered maps at night and sunset) pass with zero errors. The isolated build on port 5310 passes 31 fresh input checkpoints; eight fresh two-client checks pass with zero errors, covering host-authoritative reverse, both-pedal braking, hull damage, host transfer, exit, rejoin and wreck ejection. See [input.json](input.json) and [coop.json](coop.json).

The scripted controller uses the built-in DualSense shim. This is not physical controller or Safari validation. No FPS improvement is claimed.
