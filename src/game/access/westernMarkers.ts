// Dry Gulch builds its own ways up (the saloon's inside stair to its balcony, the church
// stair to the belfry): no elevators there, per Tyler. The access system only marks them,
// so they show on the minimap with the stairs badge and can be pinged.
import type { WesternLayout } from "../western/layout";
import { groundY } from "../terrain";
import type { AccessMarker } from "./world";

export function westernMarkers(w: WesternLayout): AccessMarker[] {
  const out: AccessMarker[] = [];
  // every way up the layout built: the saloon's inside stair, the church stair to the belfry
  for (const f of w.stairFeet) out.push({ x: f.x, z: f.z, y: groundY(f.x, f.z), kind: "stairs", label: f.label });
  return out;
}
