import { wheelGround } from "./wheelRide";
// Runtime ground for Pacific Pier: walkable height, movement speed and projectile collision,
// all answered from the layout's cell grids plus a few analytic shapes (ramps, bowls).
// Cheap enough to call per enemy and per bullet every frame.
import type { Ground } from "../terrain";
import { SPEED } from "../input/movement";
import {
  K_SAND,
  K_SURF,
  K_WET,
  SEA,
  X,
  applyPads,
  baseProfile,
  modHeight,
  regionHeight,
  type BeachLayout,
} from "./beachLayout";

export function beachTerrain(city: BeachLayout): Ground {
  const { cells: n, half, kind, beach } = city;
  const { regionOf, regions, mods, pads, pBot, pTop, deep } = beach;
  // bowls only matter inside their own box: bucket them so plain sand skips the maths
  const modBox = mods.map((m) =>
    m.t === "ell"
      ? [m.x - m.rx, m.z - m.rz, m.x + m.rx, m.z + m.rz]
      : m.t === "cap"
        ? [
            Math.min(m.ax, m.bx) - m.r,
            Math.min(m.az, m.bz) - m.r,
            Math.max(m.ax, m.bx) + m.r,
            Math.max(m.az, m.bz) + m.r,
          ]
        : m.t === "qp"
          ? [m.x0, m.z0, m.x1, m.z1]
          : [m.x0 - m.ramp, m.z0 - m.ramp, m.x1 + m.ramp, m.z1 + m.ramp],
  );
  const cellOf = (x: number, z: number) => {
    const i = Math.floor((x + half) / 2);
    const j = Math.floor((z + half) / 2);
    if (i < 0 || j < 0 || i >= n || j >= n) return -1;
    return i * n + j;
  };
  const ground = (x: number, z: number) => {
    let h =
      x > X.dry && x < X.bike + 8 ? applyPads(pads, x, z, baseProfile(x, z)) : baseProfile(x, z);
    for (let k = 0; k < mods.length; k++) {
      const b = modBox[k]!;
      if (x < b[0]! || z < b[1]! || x > b[2]! || z > b[3]!) continue;
      h += modHeight(mods[k]!, x, z);
    }
    return h;
  };
  const height = (x: number, z: number) => {
    const platform = wheelGround(beach.wheel, x, z);
    if (platform !== null) return platform;
    const c = cellOf(x, z);
    if (c >= 0) {
      const rg = regionOf[c]!;
      if (rg >= 0) return regionHeight(regions[rg]!, x, z);
    }
    return ground(x, z);
  };
  return {
    height,
    strictNav: true,
    speed: (x, z) => {
      const c = cellOf(x, z);
      if (c < 0 || regionOf[c]! >= 0) return 1;
      const k = kind[c];
      // the drags live in the SPEED table (input/movement.ts) with every player speed
      return k === K_SAND ? SPEED.sand : k === K_WET ? SPEED.wetSand : k === K_SURF ? SPEED.surf : 1;
    },
    hits: (x, y, z) => {
      if (y < height(x, z)) return true;
      if (x < X.wet + 2 && y < SEA) {
        // the sea surface stops shots, except under the pier deck (the deck already did)
        const c = cellOf(x, z);
        if (c < 0 || regionOf[c]! < 0 || deep[c]) return true;
      }
      const c = cellOf(x, z);
      if (c < 0) return true;
      return y >= pBot[c]! && y < pTop[c]!;
    },
  };
}
