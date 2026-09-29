import { wheelRailPosts } from "./beach/wheelRide";
// Thin solid props for every big map: lamp posts, sign poles, benches, hydrants, bins. The
// 2 m block grid can't hold them (a whole cell per lamp post is far too fat), so each map's
// props become small collision circles (level.ts setPosts). Trees and palms keep whatever
// each map already does with them.
import { K_OPEN, K_PARK, type CityLayout } from "./cityLayout";
import { isBeach } from "./beach/beachLayout";
import type { AlpineLayout } from "./alpine/layout";
import type { WesternLayout } from "./western/layout";
import type { Post } from "./level";

/** a bench-like prop: two circles along its long axis (local x at yaw `rot`) */
function bar(out: Post[], x: number, z: number, rot: number, half: number, r: number, h?: number) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (const t of [-half, 0, half]) out.push(h === undefined ? { x: x + c * t, z: z - s * t, r } : { x: x + c * t, z: z - s * t, r, h });
}

// Low props a jump clears (input/movement.ts: ~1.1 m apex): the height the feet must be above,
// a little under the drawn top. Anything not listed blocks at every height (lamp posts, signs,
// railings, blockades, bikes, surfboards, heaters).
const LOW_BENCH = 0.55;
const LOW_HYDRANT = 0.75;
const LOW_TRASH = 0.85;
const LOW_FIRERING = 0.45;

export function mapPosts(city: CityLayout | null, western: WesternLayout | null): Post[] {
  const out: Post[] = [];
  if (city && "alpine" in city) {
    const a = (city as AlpineLayout).alpine;
    for (const p of a.props) {
      if (p.k === "lamp" || p.k === "flag" || p.k === "marker")
        out.push({ x: p.x, z: p.z, r: 0.2 });
      else if (p.k === "signpost") out.push({ x: p.x, z: p.z, r: 0.25 });
      else if (p.k === "heater") out.push({ x: p.x, z: p.z, r: 0.3 });
      else if (p.k === "trash") out.push({ x: p.x, z: p.z, r: 0.3, h: LOW_TRASH });
      else if (p.k === "bench") bar(out, p.x, p.z, p.rot, 0.65, 0.35, LOW_BENCH);
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
    out.push(...wheelRailPosts(city.beach.wheel));
    for (const p of city.beach.props) {
      // posts at every height: the ground under the pier deck is part of the deck (you can't
      // stand beneath it), so a post up there only ever blocks the deck, and the clifftop's
      // props at 16 m block the clifftop
      if (p.k === "palm") out.push({ x: p.x, z: p.z, r: 0.45 });
      else if (p.k === "tree") out.push({ x: p.x, z: p.z, r: 0.35 * (p.s ?? 1) });
      else if (p.k === "umbrella") out.push({ x: p.x, z: p.z, r: 0.12 });
      else if (p.k === "firering") out.push({ x: p.x, z: p.z, r: 0.95, h: LOW_FIRERING });
      else if (p.k === "bike") bar(out, p.x, p.z, p.rot, 0.5, 0.25);
      else if (p.k === "board") out.push({ x: p.x, z: p.z, r: 0.25 });
      else if (p.k === "scope") out.push({ x: p.x, z: p.z, r: 0.25 });
      else if (
        p.k === "lamp" ||
        p.k === "streetlight" ||
        p.k === "globe" ||
        p.k === "flag" ||
        p.k === "sign66"
      )
        out.push({ x: p.x, z: p.z, r: 0.22 });
      else if (p.k === "hydrant") out.push({ x: p.x, z: p.z, r: 0.3, h: LOW_HYDRANT });
      else if (p.k === "trash") out.push({ x: p.x, z: p.z, r: 0.3, h: LOW_TRASH });
      else if (p.k === "bench") bar(out, p.x, p.z, p.rot, 0.6, 0.35, LOW_BENCH);
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
      else if (p.k === "news") out.push({ x: p.x, z: p.z, r: 0.3 });
      else if (p.k === "hydrant") out.push({ x: p.x, z: p.z, r: 0.3, h: LOW_HYDRANT });
      else if (p.k === "trash") out.push({ x: p.x, z: p.z, r: 0.3, h: LOW_TRASH });
      else if (p.k === "bench") out.push({ x: p.x, z: p.z, r: 0.55, h: LOW_BENCH });
      else if (p.k === "palm") out.push({ x: p.x, z: p.z, r: 0.32 });
      else if (p.k === "tree") out.push({ x: p.x, z: p.z, r: 0.28 * (p.s ?? 1) });

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

/** collision radius of a city prop (mapPosts' circles; 0 = not solid) */
function cityPropR(p: { k: string; s?: number }) {
  if (p.k === "light" || p.k === "lightLED" || p.k === "meter" || p.k === "bollard") return 0.2;
  if (p.k === "hydrant" || p.k === "trash" || p.k === "news") return 0.3;
  if (p.k === "bench") return 0.55;
  if (p.k === "palm") return 0.32;
  if (p.k === "tree") return 0.28 * (p.s ?? 1);
  return 0;
}

/** Close body-narrow gaps only around plaza/park masonry. Kerbs, medians, parking
 * lanes and buildings keep their authored positions. The raw map grid is independent of
 * the player's current roof/interior collision override. Returns an auditable move list. */
export function snugPlazaProps(city: CityLayout, doors: readonly Door[]) {
  const { cells, half, kind, solid } = city;
  const cell = (v: number) => Math.floor((v + half) / 2);
  const index = (x: number, z: number) => cell(x) * cells + cell(z);
  const plaza = (k: number) => kind[k] === K_OPEN || kind[k] === K_PARK;
  const isSolid = (x: number, z: number) => solid[index(x, z)] === 1;
  const changes: { k: string; from: [number, number]; to: [number, number] }[] = [];
  for (const p of city.props) {
    const r = cityPropR(p);
    if (!r || !plaza(index(p.x, p.z))) continue;
    const candidates: { gap: number; x: number; z: number }[] = [];
    for (let i = cell(p.x) - 1; i <= cell(p.x) + 1; i++)
      for (let j = cell(p.z) - 1; j <= cell(p.z) + 1; j++) {
        const k = i * cells + j;
        if (!solid[k] || !plaza(k)) continue;
        const cx = i * 2 - half + 1, cz = j * 2 - half + 1;
        const nx = Math.max(cx - 1, Math.min(cx + 1, p.x));
        const nz = Math.max(cz - 1, Math.min(cz + 1, p.z));
        const d = Math.hypot(nx - p.x, nz - p.z), gap = d - r;
        if (gap > 0.03 && gap < 0.9)
          candidates.push({ gap, x: p.x + (nx - p.x) / d * (gap - 0.02), z: p.z + (nz - p.z) / d * (gap - 0.02) });
      }
    candidates.sort((a, b) => a.gap - b.gap);
    for (const q of candidates) {
      if (doors.some(d => inDoorway(d, q.x, q.z) !== null)) continue;
      if (city.props.some(o => o !== p && cityPropR(o) > 0 && Math.hypot(o.x - q.x, o.z - q.z) < cityPropR(o) + r + 0.15)) continue;
      let clear = !isSolid(q.x, q.z);
      for (let a = 0; a < 16; a++)
        if (isSolid(q.x + Math.cos(a * Math.PI / 8) * r, q.z + Math.sin(a * Math.PI / 8) * r)) clear = false;
      if (!clear) continue;
      changes.push({ k: p.k, from: [p.x, p.z], to: [q.x, q.z] });
      p.x = q.x; p.z = q.z;
      break;
    }
  }
  return changes;
}
