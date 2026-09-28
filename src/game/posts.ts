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
    for (const p of western.props) {
      if (p.k === "streetlamp" || p.k === "pole" || p.k === "sign" || p.k === "cross")
        out.push({ x: p.x, z: p.z, r: 0.22 });
      else if (p.k === "bench") bar(out, p.x, p.z, p.rot, 0.6, 0.35);
    }
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

/** the prop list mapPosts reads for this map (its entries are moved in place) */
function sourceProps(city: CityLayout | null, western: WesternLayout | null): { x: number; z: number; k: string }[] {
  if (city && "alpine" in city) return (city as AlpineLayout).alpine.props;
  if (isBeach(city)) return city.beach.props;
  if (western) return western.props;
  return city ? city.props : [];
}

type Door = { x: number; z: number; facing: 0 | 1 | 2 | 3 };
const NRM = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;
/** a prop (collision up to ~0.65 m) in a door's approach: 1.3 m either side of its centre
 * line, from the wall out to 3.5 m */
function inDoorway(d: Door, x: number, z: number) {
  const [nx, nz] = NRM[d.facing];
  const out = (x - d.x) * nx + (z - d.z) * nz;
  const lat = (x - d.x) * nz - (z - d.z) * nx;
  return out > -1.2 && out < 4.2 && Math.abs(lat) < 1.95 ? lat : null;
}

/**
 * Building access doors win over thin props: a lamp post, bench or hydrant standing in a
 * door's approach is moved sideways along the facade (never made non-solid). Call before the
 * map's meshes are built and before setPosts(mapPosts(...)). `solid` = is that spot inside a
 * wall or building. Returns how many props moved (and how many had nowhere to go: removed).
 */
export function movePropsFromDoors(
  city: CityLayout | null,
  western: WesternLayout | null,
  doors: readonly Door[],
  solid: (x: number, z: number) => boolean,
) {
  if (!doors.length) return { moved: 0, removed: 0 };
  const props = sourceProps(city, western);
  const free = (x: number, z: number) => !solid(x, z) && doors.every((d) => inDoorway(d, x, z) === null);
  let moved = 0;
  const drop = new Set<object>();
  for (const p of props) {
    for (const d of doors) {
      const lat = inDoorway(d, p.x, p.z);
      if (lat === null) continue;
      const [nx, nz] = NRM[d.facing];
      const out = (p.x - d.x) * nx + (p.z - d.z) * nz;
      const s = lat >= 0 ? 1 : -1;
      let done = false;
      for (const l of [2.1 * s, -2.1 * s, 2.8 * s, -2.8 * s, 3.6 * s, -3.6 * s]) {
        const x = d.x + nx * out + nz * l;
        const z = d.z + nz * out - nx * l;
        if (!free(x, z)) continue;
        p.x = x;
        p.z = z;
        done = true;
        break;
      }
      if (done) moved++;
      else drop.add(p);
      break;
    }
  }
  if (drop.size) {
    const keep = props.filter((p) => !drop.has(p));
    props.length = 0;
    props.push(...keep);
  }
  return { moved, removed: drop.size };
}
