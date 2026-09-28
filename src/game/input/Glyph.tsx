// On-screen control hints that follow the device you used last: keyboard keys, or the
// connected controller's own glyphs (Xbox letters, PlayStation shapes, Switch letters).
import { KEY_LABEL, padLabel, type Action } from "./bindings";
import { useInputDevice } from "./useInputDevice";

/** the key / button for one action, e.g. <KeyHint action="ability" /> -> "F" or "B" or "○" */
export function KeyHint({ action }: { action: Action }) {
  const d = useInputDevice();
  return <>{d.kind === "pad" ? padLabel(action, d.padType) : KEY_LABEL[action]}</>;
}

/** the full controls line for the start / pause menu */
export function ControlsHelp({ touch }: { touch: boolean }) {
  const d = useInputDevice();
  if (d.kind === "pad") {
    const g = (a: Action) => padLabel(a, d.padType);
    return (
      <>
        {`${g("move")} to move · ${g("look")} to look · ${g("fire")} to shoot · ${g("jump")} to jump · click ${g("sprint")} to sprint (twice for a tactical sprint) · ${g("ability")} for your ability · ${g("prevGun")} ${g("nextGun")} or D-PAD ▲▼ swap guns · ${g("use")} in an elevator car for the floor button · ${g("ping")} to ping · ${g("revive")} to revive a teammate · D-PAD ◀▶ then ${g("shopBuy")} in the shop · ${g("map")} big map · ${g("pause")} to pause`}
      </>
    );
  }
  if (touch) {
    return (
      <>
        Left thumb: drag to move · right thumb: drag to aim · hold FIRE to shoot · JUMP · SPRINT
        (tap twice for a tactical sprint) · ABILITY button · USE for elevators · PING · hold REVIVE
        by a downed teammate · tap a gun to swap · pause button up top
      </>
    );
  }
  return (
    <>
      WASD to move · mouse or arrow keys to look · hold left click to shoot · Space to jump · hold
      Shift to sprint (double-tap for a tactical sprint) · F for your ability · 1-0 / Q E swap guns
      · E in an elevator car for the floor button · middle mouse or G to ping · hold R to revive a
      teammate · M big map · N locks night/sunset · P to pause · a controller works too
    </>
  );
}
