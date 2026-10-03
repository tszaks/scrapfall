import { staticBody } from "../staticCollision";
import { makeRoute, routePose, type Route } from "../life/routes";
import type { AlpineData } from "./layout";
import { terrainY } from "../terrain";
export const ski = {
  active: false,
  route: null as Route | null,
  distance: 0,
  lateral: 0,
  speed: 0,
  yaw: 0,
  x: 0,
  y: 0,
  z: 0,
  name: "",
  hint: "",
};
const pose = { x: 0, z: 0, yaw: 0 };
export function startSki(a: AlpineData, x: number, z: number) {
  const p = a.paths.find(
    (p) =>
      p.kind === "piste" &&
      (p.name === "blue" || p.name === "red") &&
      Math.hypot(p.pts[0]![0] - x, p.pts[0]![1] - z) < 8,
  );
  if (!p) return false;
  ski.route = makeRoute(p.pts);
  routePose(ski.route, 0, pose);
  ski.yaw = pose.yaw;
  ski.active = true;
  ski.distance = 0;
  ski.lateral = 0;
  ski.speed = 2;
  ski.name = p.name ?? "ski";
  return true;
}
export function resetSki() {
  ski.active = false;
  ski.route = null;
  ski.speed = 0;
  ski.hint = "";
}
/** Keep skis inside the marked run. S/back brakes; forward gains speed. */
export function stepSki(dt: number, forward: number, steer: number) {
  if (!ski.active || !ski.route) return false;
  ski.speed = Math.max(0, Math.min(20, ski.speed + (forward < -0.1 ? -18 : 4 + forward * 5) * dt));
  const previousDistance = ski.distance;
  ski.distance = Math.min(ski.route.length, ski.distance + ski.speed * dt);
  ski.lateral = Math.max(-4, Math.min(4, ski.lateral + steer * dt * 5));
  routePose(ski.route, ski.distance, pose);
  ski.x = pose.x + Math.cos(pose.yaw) * ski.lateral;
  ski.z = pose.z - Math.sin(pose.yaw) * ski.lateral;
  ski.y = terrainY(ski.x, ski.z);
  ski.yaw = pose.yaw;
  if (staticBody(ski.x, ski.z, 0.3, ski.y, 1.8, 0.15)) {
    let clear = false;
    for (let offset = -4; offset <= 4; offset += 0.5) {
      const x = pose.x + Math.cos(pose.yaw) * offset,
        z = pose.z - Math.sin(pose.yaw) * offset,
        y = terrainY(x, z);
      if (!staticBody(x, z, 0.3, y, 1.8, 0.15)) {
        ski.x = x;
        ski.z = z;
        ski.y = y;
        ski.lateral = offset;
        clear = true;
        break;
      }
    }
    if (!clear) {
      ski.distance = previousDistance;
      ski.speed = 0;
      routePose(ski.route, ski.distance, pose);
      ski.x = pose.x + Math.cos(pose.yaw) * ski.lateral;
      ski.z = pose.z - Math.sin(pose.yaw) * ski.lateral;
      ski.y = terrainY(ski.x, ski.z);
    }
  }
  if (ski.distance >= ski.route.length) {
    ski.active = false;
    ski.speed = 0;
  }
  return true;
}
