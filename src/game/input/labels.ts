import { controlSettings, type ControlAction, keyLabel } from "./remap";
import { inputDevice } from "./gamepad";
import { padLabel } from "./bindings";
export function actionLabel(a: ControlAction) {
  return controlSettings.mode === "pad" ||
    (controlSettings.mode === "auto" && inputDevice.kind === "pad")
    ? padLabel(a, inputDevice.padType)
    : keyLabel(a);
}
