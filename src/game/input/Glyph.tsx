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
        {`${g("move")} to move · ${g("look")} to look · ${g("fire")} to shoot · ${g("jump")} to jump · click ${g("sprint")} to sprint (twice for a tactical sprint) · ${g("ability")} for your ability · ${g("prevGun")} ${g("nextGun")} swap guns · ${g("use")} in an elevator car for the floor button · ${g("ping")} to ping · ${g("revive")} to revive a teammate · ${g("shopPick")} in the shop · ${g("map")} big map · ${g("pause")} to pause · ${g("camera")} camera`}
      </>
    );
  }
  if (touch) {
    return (
      <>
        Left thumb: drag to move · right thumb: drag to aim · hold FIRE to shoot · JUMP · SPRINT
        (tap twice for a tactical sprint) · ABILITY button · USE for elevators · PING · hold REVIVE
        by a downed teammate · tap a gun to swap · pause button up top · Camera in Settings
      </>
    );
  }
  const g=(a:Action)=>KEY_LABEL[a];
  return <>{`${g("move")} to move · mouse or ${g("lookLeft")} ${g("lookRight")} ${g("lookUp")} ${g("lookDown")} to look · ${g("fire")} to shoot · ${g("jump")} to jump · ${g("sprint")} to sprint (double-tap tactical) · ${g("ability")} ability · ${g("prevGun")} / ${g("nextGun")} swap guns · ${g("use")} elevator · ${g("ping")} ping · hold ${g("revive")} revive · ${g("camera")} camera · ${g("shopHeal")} shop dressing · ${g("map")} map · ${g("time")} night/sunset · ${g("pause")} pause. Remap in Settings.`}</>;
}
