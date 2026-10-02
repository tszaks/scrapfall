// Plug-and-play controller (Xbox / PlayStation standard mapping). Polled each frame and
// written into the shared touchInput, so the game reads one input path for all devices.
import { touchInput } from "./touch";
import { padOpts } from "./binds";

export const pad = { active: false, scope: false, ping: false, use: false, pause: false };
const prev: boolean[] = [];
let owned = false;
const DZ = 0.18;
const dz = (v: number) => (Math.abs(v) < DZ ? 0 : (v - Math.sign(v) * DZ) / (1 - DZ));

export function pollPad(dt: number) {
  pad.ping = pad.use = pad.pause = false;
  if (typeof navigator === "undefined" || !navigator.getGamepads) return;
  const gp = [...navigator.getGamepads()].find((g) => g && g.connected);
  if (!gp) {
    if (owned) { touchInput.moveX = touchInput.moveZ = 0; touchInput.fire = touchInput.jump = touchInput.run = false; owned = false; }
    pad.active = false;
    return;
  }
  const b = (i: number) => !!gp.buttons[i]?.pressed;
  const edge = (i: number) => b(i) && !prev[i];
  const mx = dz(gp.axes[0] ?? 0), mz = dz(gp.axes[1] ?? 0), lx = dz(gp.axes[2] ?? 0), ly = dz(gp.axes[3] ?? 0);
  const any = mx || mz || lx || ly || gp.buttons.some((x) => x.pressed);
  if (any) pad.active = true;
  if (pad.active) {
    owned = true;
    touchInput.moveX = mx;
    touchInput.moveZ = -mz;
    const s = 720 * padOpts.sens * dt;
    touchInput.lookX += lx * Math.abs(lx) * s;
    touchInput.lookY += ly * Math.abs(ly) * s * 0.75;
    touchInput.fire = b(7);
    touchInput.jump = b(0);
    touchInput.run = b(10) || b(1);
    pad.scope = b(6);
    if (edge(3)) touchInput.ability = true;
    if (edge(4)) touchInput.swap = -1;
    if (edge(5)) touchInput.swap = 1;
    pad.ping = edge(12);
    pad.use = edge(2);
    pad.pause = edge(9);
  }
  gp.buttons.forEach((x, i) => (prev[i] = x.pressed));
}
