// Thin solid props for every big map: lamp posts, sign poles, benches, hydrants, bins. The
// 2 m block grid can't hold them (a whole cell per lamp post is far too fat), so each map's
// props become small collision circles (level.ts setPosts). Trees and palms keep whatever
// each map already does with them.
import type { CityLayout } from "./cityLayout";
import { isBeach } from "./beach/beachLayout";
import type { AlpineLayout } from "./alpine/layout";
import type { WesternLayout } from "./western/layout";
import type { Post } from "./level";

/** a bench-like prop: two circles along its long axis (local x at yaw `rot`) */
function bar(out: Post[], x: number, z: number, rot: number, half: number, r: number) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (const t of [-half, 0, half]) out.push({ x: x + c * t, z: z - s * t, r });
}

export function mapPosts(city: CityLayout | null, western: WesternLayout | null): Post[] {
  const out: Post[] = [];
  if (city && "alpine" in city) {
    const a = (city as AlpineLayout).alpine;
    for (const p of a.props) {
      if (p.k === "lamp" || p.k === "flag" || p.k === "marker")
        out.push({ x: p.x, z: p.z, r: 0.2 });
      else if (p.k === "signpost") out.push({ x: p.x, z: p.z, r: 0.25 });
      else if (p.k === "heater" || p.k === "trash") out.push({ x: p.x, z: p.z, r: 0.3 });
      else if (p.k === "bench") bar(out, p.x, p.z, p.rot, 0.65, 0.35);
      else if (p.k === "skirack") bar(out, p.x, p.z, p.rot, 1.3, 0.35);
      else if (p.k === "xmas") out.push({ x: p.x, z: p.z, r: 3.4 * p.s });
    }
    // turnstile rails at the base terminal
    const t = a.terminals[0]!;
    const bx = a.ride.boardUp[0];
    for (const lx of [bx - 3, bx - 1, bx + 1, bx + 3])
      for (let z = t.z1 + 0.5; z <= t.z1 + 5.01; z += 0.5) out.push({ x: lx, z, r: 0.12 });
    return out;
  }
  if (isBeach(city)) {
    for (const p of city.beach.props) {
      // posts up on the pier deck would also block the sand beneath it, so keep to the ground
      if (p.y > 1) continue;
      if (
        p.k === "lamp" ||
        p.k === "streetlight" ||
        p.k === "globe" ||
        p.k === "flag" ||
        p.k === "sign66"
      )
        out.push({ x: p.x, z: p.z, r: 0.22 });
      else if (p.k === "hydrant" || p.k === "trash") out.push({ x: p.x, z: p.z, r: 0.3 });
      else if (p.k === "bench") bar(out, p.x, p.z, p.rot, 0.6, 0.35);
    }
    return out;
  }
  if (western) {
    // Dry Gulch builds its own list: porch posts, cactus, barrels, crosses, poles, benches...
    out.push(...western.posts);
    return out;
  }
  if (city) {
    for (const p of city.props) {
      if (p.k === "light" || p.k === "lightLED" || p.k === "meter" || p.k === "bollard")
        out.push({ x: p.x, z: p.z, r: 0.2 });
      else if (p.k === "hydrant" || p.k === "trash" || p.k === "news")
        out.push({ x: p.x, z: p.z, r: 0.3 });
      else if (p.k === "bench") out.push({ x: p.x, z: p.z, r: 0.55 });
    }
  }
  return out;
}
