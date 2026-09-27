// Whiteout Pass adapter (Tyler's rule: 4 storeys or fewer = stairs, 5+ = elevator). The
// alpine map's buildings are built by alpine/build.ts, which this adapter never touches: every
// roof there is pitched, so the ways up end in enclosed lookouts the access system builds
// inside the host's (one-sided) walls, and the doorways are opened with a depth punch.
//   - the church clock tower: stairs up the tower to a belfry lookout (open arches, the bell)
//   - one or two chalets: stairs from a side door up to the first-floor room and out onto its
//     balcony (the balcony becomes part of the roof zone; the ground under it is walled off)
//   - the grand hotel (5 storeys): an elevator from its entrance to a top-floor lounge
// In solo only buildings inside the sealed square are used.
import type { Block } from "../level";
import type { ABld, AlpineLayout } from "../alpine/layout";
import { groundY } from "../terrain";
import { layoutAccess, type AccessBuilding } from "./layout";
import type { AccessSpec, Facing, Rect } from "./types";

const FH = 2.8; // alpine storey (alpine/build.ts)

export type AlpineAccess = { list: AccessBuilding[]; blocks: Block[] };

export function alpineAccess(city: AlpineLayout, solo: boolean): AccessBuilding[] {
  return alpineAccessFull(city, solo).list;
}

/** the access buildings, and the extra collision the chalet balconies need */
export function alpineAccessFull(city: AlpineLayout, solo: boolean): AlpineAccess {
  const a = city.alpine;
  const half = city.half;
  const sq = solo ? (a.soloHalf ?? half) : half;
  const within = (b: Rect, m: number) => Math.max(Math.abs(b.x0), Math.abs(b.x1), Math.abs(b.z0), Math.abs(b.z1)) < sq - m;
  const { cells, solid } = city;
  const open = (x: number, z: number) => {
    const i = Math.floor((x + half) / 2);
    const j = Math.floor((z + half) / 2);
    return i >= 0 && j >= 0 && i < cells && j < cells && !solid[i * cells + j];
  };
  const nrm: Record<Facing, [number, number]> = { 0: [0, -1], 1: [1, 0], 2: [0, 1], 3: [-1, 0] };
  const faceMid = (b: ABld, f: Facing) =>
    f === 0 ? { x: (b.x0 + b.x1) / 2, z: b.z0 } : f === 1 ? { x: b.x1, z: (b.z0 + b.z1) / 2 } : f === 2 ? { x: (b.x0 + b.x1) / 2, z: b.z1 } : { x: b.x0, z: (b.z0 + b.z1) / 2 };
  const clearAt = (x: number, z: number, f: Facing) => {
    const [nx, nz] = nrm[f];
    const alongX = f === 0 || f === 2;
    for (const d of [1, 3])
      for (const lat of [-1, 0, 1]) if (!open(x + nx * d + (alongX ? lat : 0), z + nz * d + (alongX ? 0 : lat))) return false;
    return true;
  };
  const inset = (b: Rect, m: number): Rect => ({ x0: b.x0 + m, z0: b.z0 + m, x1: b.x1 - m, z1: b.z1 - m });
  const out: AccessSpec[] = [];
  const blocks: Block[] = [];

  // ---- the church clock tower: 26 m shaft, belfry arches 5.4 .. 1.2 m under its cornice ----
  const tower = a.buildings.find((b) => b.t === "church" && b.style === 9);
  if (tower && within(tower, 4)) {
    const f = tower.front as Facing;
    const m = faceMid(tower, f);
    const floorY = tower.y + 26 - 5.6;
    const spec: AccessSpec = {
      kind: "stairs",
      footprint: tower,
      roof: inset(tower, 0.4),
      roofY: floorY - 0.02,
      groundY: tower.y,
      floors: 7,
      floorHeight: FH,
      door: { x: m.x, z: m.z, facing: f },
      parapet: 1.05,
      roofKind: "room",
      roomH: 4.6,
      windows: "belfry",
      punch: true,
      plinth: 0.17, // the stone plinth stands 0.15 m proud; the painted door 0.08
      doorH: 3.1,
      doorStyle: "wood",
      dressing: false,
      name: "church-tower",
      seed: 9001,
    };
    if (layoutAccess(spec, 0)) out.push(spec);
  }

  // ---- the grand hotel: 5 storeys, an elevator to a lounge on the top floor ----
  const hotel = a.buildings.find((b) => b.t === "hotel");
  if (hotel && within(hotel, 4) && hotel.floors >= 5) {
    const f = hotel.front as Facing;
    const m = faceMid(hotel, f);
    const storey = 3.2; // the hotel's own storey (alpine/build.ts hotel())
    const floorY = hotel.y + (hotel.floors - 1) * storey;
    // the lounge: the middle of the front facade, 14 m wide and 10 m deep
    const [nx, nz] = nrm[f];
    const alongX = f === 0 || f === 2;
    const cx = m.x;
    const cz = m.z;
    const depth = 10.4;
    const room: Rect = alongX
      ? { x0: cx - 7, x1: cx + 7, z0: nz < 0 ? hotel.z0 + 0.4 : hotel.z1 - depth, z1: nz < 0 ? hotel.z0 + depth : hotel.z1 - 0.4 }
      : { z0: cz - 7, z1: cz + 7, x0: nx < 0 ? hotel.x0 + 0.4 : hotel.x1 - depth, x1: nx < 0 ? hotel.x0 + depth : hotel.x1 - 0.4 };
    const spec: AccessSpec = {
      kind: "elevator",
      footprint: hotel,
      roof: room,
      roofY: floorY - 0.02,
      groundY: hotel.y,
      floors: hotel.floors,
      floorHeight: storey,
      door: { x: cx, z: cz, facing: f },
      parapet: 1.05,
      roofKind: "room",
      roomH: storey - 0.15,
      windows: "tall",
      punch: true,
      plinth: 0.08, // the painted grand door sits 6 cm proud
      doorH: 2.8,
      doorStyle: "wood",
      dressing: false,
      name: "grand-hotel",
      seed: 9002,
    };
    if (layoutAccess(spec, 0)) out.push(spec);
  }

  // ---- chalets: stairs from a side door to the first-floor room and its balcony ----
  const chalets = a.buildings
    .filter((b) => b.t === "chalet" && b.floors >= 2 && !b.coop && within(b, 10) && (b.front === 0 || b.front === 2))
    .sort((p, q) => Math.hypot((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2 - 30) - Math.hypot((q.x0 + q.x1) / 2, (q.z0 + q.z1) / 2 - 30));
  let nCh = 0;
  for (const c of chalets) {
    if (nCh >= 2) break;
    const floorY = c.y + FH; // the balcony floor (alpine/build.ts: balconies on floor 1)
    const frontZ = c.front === 2 ? c.z1 : c.z0;
    const s = c.front === 2 ? 1 : -1;
    const room: Rect = inset(c, 0.4);
    // the balcony: 1.35 m out along the front, clipped to the room's width
    const terr: Rect =
      s > 0
        ? { x0: room.x0, x1: room.x1, z0: frontZ + 0.05, z1: frontZ + 1.3 }
        : { x0: room.x0, x1: room.x1, z0: frontZ - 1.3, z1: frontZ - 0.05 };
    const roof: Rect = { x0: room.x0, x1: room.x1, z0: Math.min(room.z0, terr.z0), z1: Math.max(room.z1, terr.z1) };
    const wall: Rect = { x0: room.x0, x1: room.x1, z0: frontZ - 0.06, z1: frontZ + 0.06 };
    const mx = (c.x0 + c.x1) / 2;
    // the ground under the balcony must not be walkable (a roof zone sits over it): wall
    // off the 2 m cell row outside the front
    const rowZ = s > 0 ? frontZ + 1 : frontZ - 1;
    // the side door: either end wall, wherever the ground outside is clear
    let placed: AccessSpec | null = null;
    for (const f of [1, 3] as Facing[]) {
      const m = faceMid(c, f);
      for (const o of [0, -2, 2, -1, 1, -3, 3]) {
        const z = m.z + o;
        if (!clearAt(m.x, z, f)) continue;
        const spec: AccessSpec = {
          kind: "stairs",
          footprint: c,
          roof,
          roomRect: room,
          terrace: { rect: terr, wall, door: [mx - 0.65, mx + 0.65] },
          roofY: floorY - 0.02,
          groundY: groundY(m.x + nrm[f][0] * 0.6, z),
          floors: 1,
          floorHeight: FH,
          door: { x: m.x, z, facing: f },
          parapet: 1.05,
          roofKind: "room",
          roomH: FH - 0.12,
          windows: "square",
          punch: true,
          plinth: 0.3, // the stone plinth faces sit 8 cm out, window frames and shutters further
          doorStyle: "wood",
          dressing: false,
          name: `chalet-${Math.round(mx)}-${Math.round(frontZ)}`,
          seed: Math.floor(c.seed * 1e9),
        };
        if (layoutAccess(spec, 0)) {
          placed = spec;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) continue;
    out.push(placed);
    for (let x = Math.floor(c.x0 / 2) * 2 + 1; x < c.x1; x += 2) blocks.push({ x, z: rowZ, h: floorY + 1.1 - c.y, tone: 0 });
    nCh++;
  }
  return { list: out.map((s, id) => layoutAccess(s, id)!), blocks };
}
