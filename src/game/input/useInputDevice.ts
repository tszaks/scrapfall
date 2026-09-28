import { useSyncExternalStore } from "react";
import { deviceSnapshot, inputDevice, subscribeDevice } from "./gamepad";

/** re-render when the input device (keyboard / controller / touch, pad family) changes */
export function useInputDevice() {
  useSyncExternalStore(subscribeDevice, deviceSnapshot, () => 0);
  return inputDevice;
}
