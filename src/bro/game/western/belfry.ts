import { layoutAccess } from "../access/layout";
import type { AccessSpec } from "../access/types";

export const BELFRY_Y = 9.5;
export const BELFRY_FOOT = { x0: -134, x1: -124, z0: -4, z1: 4 };
export function westernBelfry() {
  const f = BELFRY_FOOT;
  const spec: AccessSpec = {
    kind: "stairs",
    stairStyle: "spiral",
    footprint: f,
    roof: { x0: f.x0 + 0.35, x1: f.x1 - 0.35, z0: f.z0 + 0.35, z1: f.z1 - 0.35 },
    roofY: BELFRY_Y - 0.02,
    groundY: 0,
    floors: 3,
    floorHeight: BELFRY_Y / 3,
    door: { x: f.x1, z: -0.7, facing: 1 },
    parapet: 1.05,
    roofKind: "room",
    roomH: 3.6,
    windows: "belfry",
    doorStyle: "wood",
    doorH: 2.9,
    hostObstacles: [
      { x0: f.x0, x1: f.x0 + 0.5, z0: f.z0, z1: f.z0 + 0.5 },
      { x0: f.x1 - 0.5, x1: f.x1, z0: f.z0, z1: f.z0 + 0.5 },
      { x0: f.x0, x1: f.x0 + 0.5, z0: f.z1 - 0.5, z1: f.z1 },
      { x0: f.x1 - 0.5, x1: f.x1, z0: f.z1 - 0.5, z1: f.z1 },
    ],
    dressing: false,
    name: "dry-gulch-belfry",
    seed: 9001,
  };
  const b = layoutAccess(spec, 0);
  if (!b) throw new Error("Belfry spiral does not fit its tower");
  return [b];
}
