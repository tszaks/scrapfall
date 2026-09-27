// Dry Gulch builds its own ways up (the saloon's outside stair to its balcony, the church
// stair to the belfry): no elevators there, per Tyler. The access system only marks them,
// so they show on the minimap with the stairs badge and can be pinged.
import type { WesternLayout } from "../western/layout";
import { groundY } from "../terrain";
import type { AccessMarker } from "./world";

export function westernMarkers(w: WesternLayout): AccessMarker[] {
  const out: AccessMarker[] = [];
  const st = w.saloonStairs;
  if (st) {
    const x = (st.x0 + st.x1) / 2;
    out.push({ x, z: st.zBottom, y: groundY(x, st.zBottom), kind: "stairs", label: "STAIRS · BALCONY" });
  }
  // the church stair's foot (western/layout.ts: it climbs east along z -8..-6.3 from x -151)
  out.push({ x: -150, z: -7.15, y: groundY(-150, -7.15), kind: "stairs", label: "STAIRS · BELFRY" });
  return out;
}
