// Pacific Pier adapter (Tyler's rule: 4 storeys or fewer = stairs, 5+ = elevator):
//   - the beachfront condo tower (beachLayout builds one hotel 10 storeys tall): an elevator
//     from a lobby on the promenade to its roof
//   - two or three 2-3 storey shops on the promenade: a stairwell from the service alley
//     behind them up to a rooftop deck
//   - the seafood restaurant at the end of the pier: stairs up to its roof deck
//   - every lifeguard tower: a ladder up the back to the tower deck
// The beach renderer can't cut doorways, so the access system opens them with a depth punch.
// In solo only buildings inside the sealed square are used.
import type { BBld, BeachLayout } from "../beach/beachLayout";
import { soloHalf } from "../soloBounds";
import { groundY } from "../terrain";
import { doorwayClear, layoutAccess, type AccessBuilding } from "./layout";
import type { Post } from "../level";
import type { AccessKind, AccessSpec, Facing, Rect } from "./types";

const RIM = 0.35;

/** `posts`: the map's thin props (posts.ts), kept out of every door's approach */
export function beachAccess(city: BeachLayout, solo: boolean, posts: readonly Post[] = []): AccessBuilding[] {
  const { cells, half, solid } = city;
  const sq = solo ? (city.soloHalf ?? soloHalf(half)) : half;
  const within = (r: Rect, m: number) => Math.max(Math.abs(r.x0), Math.abs(r.x1), Math.abs(r.z0), Math.abs(r.z1)) < sq - m;
  const open = (x: number, z: number) => {
    const i = Math.floor((x + half) / 2);
    const j = Math.floor((z + half) / 2);
    return i >= 0 && j >= 0 && i < cells && j < cells && !solid[i * cells + j];
  };
  const out: AccessSpec[] = [];
  const nrm: Record<Facing, [number, number]> = { 0: [0, -1], 1: [1, 0], 2: [0, 1], 3: [-1, 0] };

  /** a spec for building b with its door on side `facing`, trying spots along that face */
  const place = (b: BBld, kind: AccessKind, facing: Facing, name: string, extra: Partial<AccessSpec> = {}) => {
    const plane = facing === 0 ? b.z0 : facing === 1 ? b.x1 : facing === 2 ? b.z1 : b.x0;
    const alongX = facing === 0 || facing === 2;
    const mid = alongX ? (b.x0 + b.x1) / 2 : (b.z0 + b.z1) / 2;
    const [nx, nz] = nrm[facing];
    const offs = kind === "elevator" ? [0, -1, 1, -2, 2] : [-2, 2, -3, 3, -4, 4, -1, 1, 0, -5, 5];
    for (const o of offs) {
      const t = mid + o;
      const dx = alongX ? t : plane;
      const dz = alongX ? plane : t;
      let clear = true;
      for (const d of [1, 3])
        for (const lat of [-1, 0, 1]) {
          const x = dx + nx * d + (alongX ? lat : 0);
          const z = dz + nz * d + (alongX ? 0 : lat);
          if (!open(x, z)) clear = false;
        }
      if (!clear || !doorwayClear(posts, dx, dz, facing)) continue;
      const spec: AccessSpec = {
        kind,
        footprint: { x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 },
        roof: { x0: b.x0 + RIM, z0: b.z0 + RIM, x1: b.x1 - RIM, z1: b.z1 - RIM },
        roofY: b.y0 + b.h,
        capY: b.y0 + b.h,
        groundY: b.y0,
        floors: b.floors,
        floorHeight: 3.3,
        door: { x: dx, z: dz, facing },
        parapet: 1.05,
        punch: true,
        rail: true,
        doorStyle: kind === "elevator" ? "steel" : "steel",
        name,
        seed: Math.floor(b.seed * 1e9),
        ...extra,
      };
      if (layoutAccess(spec, 0)) return spec;
    }
    return null;
  };

  const blds = city.beach.buildings.filter((b) => !b.backdrop && !b.interior);
  // the condo tower
  const condo = blds.find((b) => b.t === "hotel" && b.floors >= 8 && within(b, 6));
  if (condo) {
    const s = place(condo, "elevator", condo.front, "condo", {
      helipad: true,
      furnishings: { lobby: "pier-reception" },
    });
    if (s) {
      out.push(s);
      condo.access = true;
    }
  }
  // shops on the promenade: stairs from the alley behind (their back, +x) to the roof deck
  const shops = blds
    .filter((b) => (b.t === "shop" || b.t === "surf" || b.t === "cafe" || b.t === "arcade") && b.front === 3 && b.y0 === 0 && b.floors >= 2 && b.floors <= 4 && within(b, 12))
    .sort((a, b) => b.floors - a.floors || Math.abs(a.z0) - Math.abs(b.z0));
  let nShops = 0;
  for (const b of shops) {
    if (nShops >= 3) break;
    if (out.some((s) => Math.abs((s.footprint.z0 + s.footprint.z1) / 2 - (b.z0 + b.z1) / 2) < 45)) continue;
    // a two-storey shop carries a big sign on two posts along its front edge (beachMesh):
    // the posts stand on the roof
    const posts: Rect[] = [];
    if (b.sign >= 0) {
      const w = Math.min(((b.z1 - b.z0) / 2) * 1.8, 12);
      const cz = (b.z0 + b.z1) / 2;
      const px = b.x0 - 0.06 + 0.8;
      for (const zz of [cz - w / 3, cz + w / 3]) posts.push({ x0: px - 0.12, z0: zz - 0.12, x1: px + 0.12, z1: zz + 0.12 });
    }
    const s = place(b, "stairs", 1, `${b.t}-${Math.round(b.z0)}`, { hostObstacles: posts });
    if (s) {
      out.push(s);
      b.access = true;
      nShops++;
    }
  }
  // the pier restaurant: stairs from the deck on its north side up to its roof
  const rest = blds.find((b) => b.t === "restaurant" && within(b, 4));
  if (rest) {
    const s = place(rest, "stairs", 2, "restaurant") ?? place(rest, "stairs", 0, "restaurant");
    if (s) {
      out.push(s);
      rest.access = true;
    }
  }
  // lifeguard towers: a ladder up the back (+x) to the deck round the hut
  for (const t of city.beach.towers) {
    const fp = { x0: t.x - 2, z0: t.z - 2, x1: t.x + 2, z1: t.z + 2 };
    if (!within(fp, 8) || !doorwayClear(posts, t.x + 2, t.z, 1)) continue;
    const gy = groundY(t.x, t.z);
    const spec: AccessSpec = {
      kind: "ladder",
      footprint: fp,
      roof: { x0: t.x - 1.95, z0: t.z - 1.95, x1: t.x + 1.95, z1: t.z + 1.95 },
      roofY: gy + 2.48,
      groundY: groundY(t.x + 2.45, t.z),
      floors: 1,
      floorHeight: 2.5,
      door: { x: t.x + 2, z: t.z, facing: 1 },
      parapet: 1.05,
      hostObstacles: [
        { x0: t.x - 1.7, z0: t.z - 1.05, x1: t.x + 0.45, z1: t.z + 1.05 }, // the hut
        { x0: t.x - 1.92, z0: t.z + 1.68, x1: t.x - 1.68, z1: t.z + 1.92 }, // the flag pole
      ],
      drawLadder: false, // the tower model has its steel ladder
      dressing: false,
      name: `tower-${t.n}`,
      seed: t.n * 7919,
    };
    if (layoutAccess(spec, 0)) out.push(spec);
  }
  return out.map((s, id) => layoutAccess(s, id)!);
}
