import { subscribeControls, controlSnapshot, controlSettings, loadControls } from "./remap";
import { useSyncExternalStore } from "react";
import { deviceSnapshot, inputDevice, subscribeDevice } from "./gamepad";

/** re-render when the input device (keyboard / controller / touch, pad family) changes */
export function useInputDevice() {
  useSyncExternalStore(subscribeDevice, deviceSnapshot, () => 0);
  loadControls();
  useSyncExternalStore(subscribeControls, controlSnapshot, () => 0);
  return controlSettings.mode === "auto"
    ? inputDevice
    : { ...inputDevice, kind: controlSettings.mode };
}
