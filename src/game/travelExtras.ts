import { liveCars, type CarBox } from "./trafficCore";
import { boundaryBlocked, type Block } from "./level";
import { groundY } from "./terrain";
import { staticBody } from "./staticCollision";
import type { CityLayout } from "./cityLayout";
export const meleeGear = { name: "WRENCH", damage: 3, swing: 0 };
export function subwayNear(city: CityLayout | null, x: number, z: number) {
  return city?.props.find((p) => p.k === "subway" && Math.hypot(p.x - x, p.z - z) < 6);
}
export function subwayExit(city: CityLayout, x: number, z: number, blocks: Block[]) {
  const stations = city.props.filter((p) => p.k === "subway");
  const i = stations.findIndex((p) => Math.hypot(p.x - x, p.z - z) < 6);
  if (i < 0 || stations.length < 2) return null;
  const target = stations[(i + 1) % stations.length]!;
  for (let r = 3; r < 10; r++)
    for (let n = 0; n < 12; n++) {
      const a = (n * Math.PI) / 6,
        px = target.x + Math.cos(a) * r,
        pz = target.z + Math.sin(a) * r,
        y = groundY(px, pz);
      if (!boundaryBlocked(blocks, px, pz, 0.4) && !staticBody(px, pz, 0.4, y, 1.8, 0.2))
        return { x: px, y, z: pz };
    }
  return null;
}
const onRoof = (c: CarBox, x: number, z: number) => {
  const dx = x - c.x,
    dz = z - c.z;
  return (
    Math.abs(dx * c.sin + dz * c.cos) < c.hl - 0.2 && Math.abs(dx * c.cos - dz * c.sin) < c.hw - 0.1
  );
};
export function trafficRoof(x: number, z: number, feet: number) {
  let y = -Infinity;
  for (const c of liveCars)
    if (c.h <= feet + 0.22 && c.h >= feet - 1 && onRoof(c, x, z)) y = Math.max(y, c.h);
  return y;
}
const roofRide = { car: null as CarBox | null, along: 0, lateral: 0 };
export function carryOnCar(pos: { x: number; z: number }, feet: number, airborne: boolean) {
  const prev = roofRide.car;
  if (prev && !airborne && Math.abs(prev.h - feet) < 0.3) {
    pos.x = prev.x + prev.sin * roofRide.along + prev.cos * roofRide.lateral;
    pos.z = prev.z + prev.cos * roofRide.along - prev.sin * roofRide.lateral;
  }
  roofRide.car = null;
  if (!airborne)
    for (const c of liveCars)
      if (Math.abs(c.h - feet) < 0.3 && onRoof(c, pos.x, pos.z)) {
        roofRide.car = c;
        const dx = pos.x - c.x,
          dz = pos.z - c.z;
        roofRide.along = dx * c.sin + dz * c.cos;
        roofRide.lateral = dx * c.cos - dz * c.sin;
        break;
      }
}
