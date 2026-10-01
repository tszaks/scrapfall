import { controlSettings } from "./remap";
export const aimState = { on: false, blend: 0, scoped: false, zoom: 1 };
const held = new Set<string>();
const suppressed = new Set<string>();
let blocked = false;
export function aimInput(source: string, down: boolean, repeat = false) {
  if (repeat) return;
  const wasDown = held.has(source);
  if (down) held.add(source);
  else {
    held.delete(source);
    suppressed.delete(source);
  }
  if (blocked && down) suppressed.add(source);
  if (blocked || suppressed.has(source)) return;
  if (controlSettings.aimMode === "toggle") {
    if (down && !wasDown) aimState.on = !aimState.on;
  } else aimState.on = [...held].some((source) => !suppressed.has(source));
}
export function clearAim() {
  held.clear();
  aimState.on = false;
}
export function stepAim(dt: number, preventAim: boolean, rate = 16) {
  blocked = preventAim;
  if (blocked) {
    aimState.on = false;
    for (const source of held) suppressed.add(source);
  }
  const target = aimState.on ? 1 : 0;
  aimState.blend += (target - aimState.blend) * (1 - Math.exp(-dt * rate));
  if (Math.abs(aimState.blend - target) < 0.004) aimState.blend = target;
}
// sensitivity tracks the zoom ratio: screen-space aim speed stays constant at any fov
export const aimSensitivity = () => 1 - (1 - (aimState.zoom || 1)) * aimState.blend;
