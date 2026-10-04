import { vehicleSpeed, vehicleTurn } from "./vehicleControls";
import { boundaryBlocked, type Block } from "./level";
import { staticBody } from "./staticCollision";
import { baseGroundY as groundY, terrainStep } from "./terrain";
import { liveCars, trafficDepth, type CarBox } from "./trafficCore";
export type DriveCar = {
  box?: CarBox;
  id: string;
  x: number;
  z: number;
  yaw: number;
  half: number;
  width: number;
  height: number;
  topSpeed: number;
  hp: number;
  maxHp: number;
  owner: string;
  claimed: boolean;
  speed: number;
  gas: number;
  brake: number;
  steer: number;
  inputAt: number;
};
export const driveCars = new Map<string, DriveCar>();
export const driving = {
  self: "host",
  use: false,
  hint: "",
  inputGas: 0,
  inputSteer: 0,
  inputBrake: 0,
};
export function registerDriveCar(
  id: string,
  half: number,
  width: number,
  height: number,
  topSpeed = 22,
  hp = 100,
) {
  const c: DriveCar = {
    id,
    x: 0,
    z: 0,
    yaw: 0,
    half,
    width,
    height,
    topSpeed,
    hp,
    maxHp: hp,
    owner: "",
    claimed: false,
    speed: 0,
    gas: 0,
    brake: 0,
    steer: 0,
    inputAt: 0,
  };
  driveCars.set(id, c);
  return c;
}
export function myVehicle(id = driving.self) {
  for (const c of driveCars.values()) if (c.owner === id) return c;
  return null;
}
export function nearbyVehicle(x: number, z: number, y: number) {
  let best: DriveCar | null = null,
    dist = Infinity;
  for (const c of driveCars.values()) {
    const d = Math.hypot(c.x - x, c.z - z);
    if (
      c.hp > 0 &&
      !c.owner &&
      d < c.half + 2.5 &&
      d < dist &&
      Math.abs(y - groundY(c.x, c.z)) < 3
    ) {
      best = c;
      dist = d;
    }
  }
  return best;
}
export function claimVehicle(id: string, owner: string, x: number, z: number) {
  const c = driveCars.get(id);
  if (!c || c.hp <= 0 || c.owner || myVehicle(owner) || Math.hypot(c.x - x, c.z - z) > c.half + 3)
    return false;
  c.claimed = true;
  c.owner = owner;
  c.speed = 0;
  c.gas = c.brake = 0;
  c.steer = 0;
  c.inputAt = performance.now();
  return true;
}
export function releaseVehicle(owner: string) {
  const c = myVehicle(owner);
  if (c) {
    c.owner = "";
    c.speed = 0;
    c.gas = c.brake = 0;
    c.steer = 0;
  }
}
export function driveInput(owner: string, gas: number, steer: number, brake = 0) {
  const c = myVehicle(owner);
  if (!c) return;
  c.gas = Number.isFinite(gas) ? Math.max(-1, Math.min(1, gas)) : 0;
  c.brake = Number.isFinite(brake) ? Math.max(0, Math.min(1, brake)) : 0;
  c.steer = Number.isFinite(steer) ? Math.max(-1, Math.min(1, steer)) : 0;
  c.inputAt = performance.now();
}
function clear(c: DriveCar, x: number, z: number, yaw: number, blocks: Block[]) {
  const y = groundY(x, z),
    sn = Math.sin(yaw),
    cs = Math.cos(yaw);
  if (!terrainStep(c.x, c.z, x, z, groundY(c.x, c.z))) return false;
  for (let ai = -1; ai <= 1; ai++)
    for (let bi = -1; bi <= 1; bi++) {
      const a = ai * c.half,
        b = bi * c.width;
      const px = x + sn * a + cs * b,
        pz = z + cs * a - sn * b;
      if (boundaryBlocked(blocks, px, pz, 0.2) || staticBody(px, pz, 0.2, y, c.height, 0.2))
        return false;
    }
  for (const o of liveCars) {
    if (o.driveId === c.id) continue; // this vehicle's own published body
    const dx = x - o.x,
      dz = z - o.z;
    if (
      Math.abs(dx * o.sin + dz * o.cos) < o.hl + c.width &&
      Math.abs(dx * o.cos - dz * o.sin) < o.hw + c.width
    )
      return false;
  }
  return true;
}
export function stepDriving(dt: number, blocks: Block[]) {
  for (const c of driveCars.values()) {
    if (!c.claimed || c.hp <= 0) continue;
    const live = !!c.owner && performance.now() - c.inputAt < 500;
    c.speed = vehicleSpeed(c.speed, live ? c.gas : 0, live ? c.brake : 1, c.topSpeed, dt);
    const count = Math.max(1, Math.ceil((Math.abs(c.speed) * dt) / 0.2));
    for (let i = 0; i < count; i++) {
      const yaw = vehicleTurn(c.yaw, live ? c.steer : 0, c.speed, dt / count);
      const x = c.x + (Math.sin(yaw) * c.speed * dt) / count,
        z = c.z + (Math.cos(yaw) * c.speed * dt) / count;
      if (clear(c, x, z, yaw, blocks)) {
        c.x = x;
        c.z = z;
        c.yaw = yaw;
      } else {
        c.speed = 0;
        break;
      }
    }
  }
}
export function vehicleExit(c: DriveCar, blocks: Block[]) {
  for (const side of [-1, 1])
    for (const along of [0, -c.half - 1, c.half + 1]) {
      const x = c.x + Math.cos(c.yaw) * (c.width + 1) * side + Math.sin(c.yaw) * along;
      const z = c.z - Math.sin(c.yaw) * (c.width + 1) * side + Math.cos(c.yaw) * along;
      const y = groundY(x, z);
      if (
        !boundaryBlocked(blocks, x, z, 0.4) &&
        !staticBody(x, z, 0.4, y, 1.8, 0.2) &&
        trafficDepth(x, z, 0.4, y, 1.8) === 0
      )
        return { x, y, z };
    }
  return null;
}
export function encodeDriving() {
  return [...driveCars.values()]
    .filter((c) => c.claimed || c.hp < c.maxHp)
    .map((c) => [c.id, c.owner, c.x, c.z, c.yaw, c.speed, c.hp, c.claimed ? 1 : 0]);
}
export function decodeDriving(rows: unknown) {
  if (!Array.isArray(rows)) return;
  for (const r of rows) {
    if (!Array.isArray(r) || r.length !== 8) continue;
    const c = driveCars.get(r[0]);
    if (!c || typeof r[1] !== "string" || !r.slice(2).every(Number.isFinite)) continue;
    Object.assign(c, {
      claimed: r[7] === 1,
      owner: r[1],
      x: r[2],
      z: r[3],
      yaw: r[4],
      speed: r[5],
      hp: r[6],
    });
  }
}

/** Intersect a shot with a vehicle hull. A wreck stays in the world and stays solid. */
export function damageVehicle(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  damage: number,
  limit = 1,
) {
  let best: DriveCar | null = null,
    distance = limit;
  for (const car of driveCars.values()) {
    if (car.hp <= 0) continue;
    const t = car.box?.rayContact?.(a, b);
    if (t !== undefined && t <= distance) {
      distance = t;
      best = car;
    }
  }
  if (!best) return null;
  best.hp = Math.max(0, best.hp - Math.max(0, Math.min(100, damage)));
  if (best.hp === 0) {
    best.claimed = true;
    best.owner = "";
    best.speed = 0;
  }
  return best;
}
