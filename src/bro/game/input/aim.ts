import { controlSettings } from "./remap";
export const aimState = { on: false, blend: 0, scoped: false };
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
export function stepAim(dt: number, preventAim: boolean) {
  blocked = preventAim;
  if (blocked) {
    aimState.on = false;
    for (const source of held) suppressed.add(source);
  }
  aimState.blend += ((aimState.on ? 1 : 0) - aimState.blend) * (1 - Math.exp(-dt * 16));
}
export const aimSensitivity = () => 1 - 0.45 * aimState.blend;
