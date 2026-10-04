# Driving camera and held-brake reverse

The vehicle presentation camera fits the hull size, uses an 83° view at the default 75° setting, follows position/heading smoothly, and preserves independent look. Seven body-offset world sweeps retract it at geometry. There is still one final scene render. The logical camera and the saved on-foot view/FOV are untouched; the standing local rig stays hidden in a car.

L2 or S first brakes forward movement to zero, then a continued hold eases into reverse (3.5 m/s², capped at min(8 m/s, 35% of vehicle top speed)). R2 or W brakes reverse movement before accelerating forward. Both triggers brake. Stale or released ownership input only stops; it cannot start reversing.

## Evidence

- Original user Library screenshot inspected at `/Users/tyler/Documents/Codex/2026-10-04/task-7/evidence/driving-before.png`, Library identity `libfile_2e3c1d99387481918343a97a6f527e11`. Kept local because it includes unrelated browser UI.
- `before.png`: released main `15540cf`, port 5309, Vice seed 11, same entry fixture and 1512×982 viewport as `after.png` from candidate port 5307. These are functional screenshots, not a rendering benchmark.
- `large-car.png`: actual 8.8 m vehicle, with the full hull visible and camera outside static collision.
- `camera.json`: eight functional checkpoints, including first-/third-person restoration, ownership loss, actual large vehicle and damage/ejection. Zero page errors.
- `input.json`: 31 simulated-controller/keyboard checkpoints. Uses release 47's actual ammo HUD selector for reload verification. This is not physical DualSense/Safari evidence.
- `coop.json`: eight two-client checkpoints, host-authoritative reverse, simultaneous-pedal stop, hull damage, transfer, rejoin and wreck ejection. Verified again after the 49/47 integration.
- Integrated full suite: 91 tests pass, typecheck and production build pass. Eight-map night/sunset smoke passes with zero errors.

## Performance and remaining validation

No performance improvement is claimed. The wider FOV and longer boom can expose more scene content, and seven world sweeps have a cost. Paired route sampling awaits the parent's quiet window. Existing driving physics performs nine static-body probes per 0.2 m movement substep, and guest snapshots update vehicle positions discretely; these are hypotheses, not measured causes. Physical-controller mapping belongs to the separate controller fix.

