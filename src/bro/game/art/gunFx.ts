// First-person gun fire / reload signals: Game.tsx calls gunKick on every trigger pull that
// fires and gunReload when the pistol's magazine refills; GunView reads them each frame.
import { gunBuild } from "./guns";

export const gunFx = { shots: 0, last: -1e9, reload: -1e9, hold: null as number | null };
export function gunKick() {
  gunFx.shots++;
  gunFx.last = performance.now();
}
export function gunReload() {
  gunFx.reload = performance.now();
}
// test hook (like window.__rs): contact sheets can play the fire motion and inspect the models
(globalThis as { __artGuns?: unknown }).__artGuns = {
  kick: gunKick,
  reload: gunReload,
  build: gunBuild,
  fx: gunFx,
};
