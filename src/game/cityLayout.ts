// Deterministic street-grid city for the "city" map. Pure data: no three.js here,
// so it runs identically for every co-op client from the shared seed.
//
// Grid rules (per axis, period P cells): 2 road cells, 1 sidewalk, lots, 1 sidewalk.
// A cell is road if either axis says road, a lot if it touches the arena edge,
// a sidewalk if either axis says sidewalk, otherwise a building lot.
import type { Block } from "./level";
import { makeVehicle, vehicleHeight, type Vehicle } from "./vehicles";

export const K_ROAD = 0;
export const K_WALK = 1;
export const K_LOT = 2;
export const K_PARK = 3;

export type BuildingStyle = "glass" | "office" | "brick" | "deco" | "shop";
export type Building = {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  style: BuildingStyle;
  /** 0..1, picks a colour from the style palette */
  tone: number;
  /** 0..1, per-building variety roll for roof dressing */
  roll: number;
  helipad?: boolean;
  billboard?: boolean;
  /** outside the arena: skyline only, no collision, simpler dressing */
  backdrop?: boolean;
};
export type Spot = { x: number; z: number; rot: number };
export type ParkedCar = Spot & { v: Vehicle };

export type CityLayout = {
  cells: number;
  half: number;
  /** cell kind, index i * cells + j (i along x, j along z) */
  kind: Uint8Array;
  /** world x of the centre of every north-south road inside the arena */
  roadX: number[];
  /** world z of the centre of every east-west road inside the arena */
  roadZ: number[];
  /** road centre lines for the whole visible city, including the backdrop */
  farRoads: number[];
  buildings: Building[];
  parked: ParkedCar[];
  streetlights: Spot[];
  palms: (Spot & { h: number })[];
  hydrants: Spot[];
  benches: Spot[];
  /** sidewalk slabs (cell centres), arena + a band of the backdrop */
  walks: { x: number; z: number }[];
  parking: { x: number; z: number }[];
  /** how far the backdrop reaches from the centre */
  extent: number;
};

const P = 8;
const A_ROAD = 0;
const A_WALK = 1;
const A_LOT = 2;
const A_EDGE = 3;
/** cells of backdrop drawn beyond the arena wall */
const BACKDROP_CELLS = 34;

export function generateCity(rand: () => number, cells: number, half: number) {
  const cc = (i: number) => -half + 1 + i * 2;
  const c0 = Math.floor(cells / 2) - 1;
  const mod = (i: number) => (((i - c0) % P) + P) % P;
  const axisRaw = (i: number) => {
    const m = mod(i);
    if (m <= 1) return A_ROAD;
    if (m === 2 || m === P - 1) return A_WALK;
    return A_LOT;
  };
  const axis = (i: number) => {
    if (i <= 0 || i >= cells - 1) return A_EDGE;
    const r = axisRaw(i);
    if (r === A_ROAD) {
      const other = mod(i) === 0 ? i + 1 : i - 1;
      if (other <= 0 || other >= cells - 1) return A_LOT;
    }
    return r;
  };
  const kindOf = (ai: number, aj: number) => {
    if (ai === A_ROAD || aj === A_ROAD) return K_ROAD;
    if (ai === A_EDGE || aj === A_EDGE) return K_LOT;
    if (ai === A_WALK || aj === A_WALK) return K_WALK;
    return K_LOT;
  };

  const N = cells * cells;
  const kind = new Uint8Array(N);
  for (let i = 0; i < cells; i++)
    for (let j = 0; j < cells; j++) kind[i * cells + j] = kindOf(axis(i), axis(j));

  const roadIdx: number[] = [];
  for (let i = 1; i < cells - 2; i++)
    if (axis(i) === A_ROAD && mod(i) === 0 && axis(i + 1) === A_ROAD) roadIdx.push(i);
  const roadX = roadIdx.map((i) => cc(i) + 1);
  const roadZ = roadX.slice();

  // ---- parking lots: a couple of interior lot blocks stay open asphalt ----
  const comp = new Int32Array(N).fill(-1);
  const comps: number[][] = [];
  for (let s = 0; s < N; s++) {
    if (kind[s] !== K_LOT || comp[s]! >= 0) continue;
    const list = [s];
    comp[s] = comps.length;
    for (let h = 0; h < list.length; h++) {
      const c = list[h]!;
      const ci = Math.floor(c / cells);
      const cj = c % cells;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= cells || nj >= cells) continue;
        const n = ni * cells + nj;
        if (kind[n] === K_LOT && comp[n]! < 0) {
          comp[n] = comps.length;
          list.push(n);
        }
      }
    }
    comps.push(list);
  }
  const touchesEdge = (list: number[]) =>
    list.some((c) => {
      const i = Math.floor(c / cells);
      const j = c % cells;
      return i === 0 || j === 0 || i === cells - 1 || j === cells - 1;
    });
  const interior = comps.filter((l) => l.length >= 12 && !touchesEdge(l));
  const lots = cells > 26 ? 2 : 1;
  const parkingComps: number[][] = [];
  for (let n = 0; n < lots && interior.length > 0; n++) {
    const pick = interior.splice(Math.floor(rand() * interior.length), 1)[0]!;
    parkingComps.push(pick);
    for (const c of pick) kind[c] = K_PARK;
  }

  // ---- buildings: greedy random rectangles over the lot cells ----
  const owner = new Int32Array(N).fill(-1);
  const buildings: Building[] = [];
  const bComp: number[] = [];
  const blocks: Block[] = [];
  const free = (i: number, j: number) =>
    i >= 0 &&
    j >= 0 &&
    i < cells &&
    j < cells &&
    kind[i * cells + j] === K_LOT &&
    owner[i * cells + j]! < 0;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      if (!free(i, j)) continue;
      const big = rand() < 0.3;
      const tw = 1 + Math.floor(rand() * (big ? 4 : 3));
      const td = 1 + Math.floor(rand() * (big ? 4 : 3));
      let w = 1;
      while (w < tw && free(i + w, j)) w++;
      let d = 1;
      const rowFree = (jj: number) => {
        for (let k = 0; k < w; k++) if (!free(i + k, jj)) return false;
        return true;
      };
      while (d < td && rowFree(j + d)) d++;
      const id = buildings.length;
      for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) owner[(i + a) * cells + j + b] = id;
      const x = (cc(i) + cc(i + w - 1)) / 2;
      const z = (cc(j) + cc(j + d - 1)) / 2;
      const edge = i === 0 || j === 0 || i + w === cells || j + d === cells;
      const b = shapeBuilding(rand, x, z, w, d, half, edge);
      buildings.push(b);
      bComp.push(comp[i * cells + j]!);
    }
  }
  // every interior block gets at least one real tower, so small arenas still have a skyline
  for (let ci = 0; ci < comps.length; ci++) {
    const mine = buildings.filter((_, k) => bComp[k] === ci);
    if (mine.length === 0 || touchesEdge(comps[ci]!) || mine.some((b) => b.h >= 24)) continue;
    const big = mine.reduce((a, b) => (b.w * b.d > a.w * a.d ? b : a));
    if (Math.min(big.w, big.d) < 3.5) continue;
    big.style = rand() < 0.5 ? "glass" : "office";
    big.h = 28 + rand() * 30;
  }
  for (let k = 0; k < buildings.length; k++) {
    const b = buildings[k]!;
    const i0 = Math.round((b.x - (b.w + 0.3) / 2 + half) / 2);
    const j0 = Math.round((b.z - (b.d + 0.3) / 2 + half) / 2);
    const w = Math.round((b.w + 0.3) / 2);
    const d = Math.round((b.d + 0.3) / 2);
    for (let a = 0; a < w; a++)
      for (let q = 0; q < d; q++)
        blocks.push({ x: cc(i0 + a), z: cc(j0 + q), h: b.h, tone: b.tone });
  }
  // the tallest tower near the middle gets the helipad; a few mid-rises carry billboards
  let tallest = buildings[0];
  for (const b of buildings) if (!tallest || b.h > tallest.h) tallest = b;
  if (tallest) {
    tallest.helipad = true;
    if (tallest.style !== "glass") tallest.style = "office";
  }
  const boards = buildings.filter((b) => b.h > 7 && b.h < 22 && b.style !== "glass");
  for (let n = 0; n < Math.min(boards.length, cells > 26 ? 8 : 5); n++) {
    boards.splice(Math.floor(rand() * boards.length), 1)[0]!.billboard = true;
  }

  // ---- connectivity: every walkable cell must be reachable from the centre ----
  const solid = new Uint8Array(N);
  for (let s = 0; s < N; s++) if (owner[s]! >= 0) solid[s] = 1;
  const ring = (i: number, j: number) => i === 0 || j === 0 || i === cells - 1 || j === cells - 1;
  const centre = Math.floor(half / 2) * cells + Math.floor(half / 2); // toCell(0) on both axes
  const reachable = () => {
    const seen = new Uint8Array(N);
    const q = [centre];
    seen[centre] = 1;
    let count = 1;
    for (let h = 0; h < q.length; h++) {
      const c = q[h]!;
      const ci = Math.floor(c / cells);
      const cj = c % cells;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= cells || nj >= cells || ring(ni, nj)) continue;
        const n = ni * cells + nj;
        if (solid[n] || seen[n]) continue;
        seen[n] = 1;
        count++;
        q.push(n);
      }
    }
    return { seen, count };
  };
  const walkableCount = () => {
    let n = 0;
    for (let i = 1; i < cells - 1; i++)
      for (let j = 1; j < cells - 1; j++) if (!solid[i * cells + j]) n++;
    return n;
  };

  // ---- parked cars: parking lots and the dead-end road stubs by the wall ----
  const parked: ParkedCar[] = [];
  const tryPark = (ci: number[], alongZ: boolean, maxLen: number, onlySmall: boolean) => {
    const v = makeVehicle(rand, maxLen, onlySmall ? ["compact", "sports", "sedan"] : undefined);
    if (!v) return false;
    const need = Math.max(1, Math.round(v.len / 2));
    const use = ci.slice(0, need);
    if (use.length < need) return false;
    if (use.some((c) => solid[c])) return false;
    for (const c of use) solid[c] = 1;
    const before = walkableCount();
    if (reachable().count !== before) {
      for (const c of use) solid[c] = 0;
      return false;
    }
    const xs = use.map((c) => cc(Math.floor(c / cells)));
    const zs = use.map((c) => cc(c % cells));
    const x = (Math.min(...xs) + Math.max(...xs)) / 2;
    const z = (Math.min(...zs) + Math.max(...zs)) / 2;
    const rot = (alongZ ? 0 : Math.PI / 2) + (rand() < 0.5 ? Math.PI : 0);
    parked.push({ x, z, rot, v });
    const h = vehicleHeight(v);
    for (const c of use)
      blocks.push({ x: cc(Math.floor(c / cells)), z: cc(c % cells), h, tone: 0 });
    return need;
  };
  const parking: { x: number; z: number }[] = [];
  for (const list of parkingComps) {
    const is = list.map((c) => Math.floor(c / cells));
    const js = list.map((c) => c % cells);
    const i0 = Math.min(...is);
    const i1 = Math.max(...is);
    const j0 = Math.min(...js);
    const j1 = Math.max(...js);
    for (const c of list) parking.push({ x: cc(Math.floor(c / cells)), z: cc(c % cells) });
    const alongZ = rand() < 0.5;
    // rows of cars with one open aisle through the lot
    const aisle = 2;
    const cols = alongZ ? [i0, i1] : [j0, j1];
    for (let col = cols[0]!; col <= cols[1]!; col++) {
      if (col - cols[0]! === aisle) continue;
      const lo = alongZ ? j0 : i0;
      const hi = alongZ ? j1 : i1;
      let at = lo;
      while (at <= hi) {
        if (rand() < 0.2) {
          at++;
          continue;
        }
        const run: number[] = [];
        for (let k = at; k <= hi; k++) run.push(alongZ ? col * cells + k : k * cells + col);
        const got = tryPark(run, alongZ, (hi - at + 1) * 2 - 0.3, false);
        at += got || 1;
      }
    }
  }
  // stubs: road cells between the outermost road and the wall
  if (roadIdx.length > 0) {
    const first = roadIdx[0]!;
    const last = roadIdx[roadIdx.length - 1]! + 1;
    for (const ri of roadIdx) {
      for (const lane of [ri, ri + 1]) {
        for (const [from, dir] of [
          [0, 1],
          [cells - 1, -1],
        ] as const) {
          if (rand() > 0.6) continue;
          const run: number[] = [];
          for (let k = from; dir > 0 ? k < first : k > last; k += dir) run.push(lane * cells + k);
          const runT: number[] = [];
          for (let k = from; dir > 0 ? k < first : k > last; k += dir) runT.push(k * cells + lane);
          const alongZ = rand() < 0.5;
          const use = alongZ ? run : runT;
          tryPark(use, alongZ, use.length * 2 - 0.4, use.length < 3);
        }
      }
    }
  }
  // fallback: anything walkable that still can't be reached becomes a kiosk
  const { seen } = reachable();
  for (let i = 1; i < cells - 1; i++) {
    for (let j = 1; j < cells - 1; j++) {
      const s = i * cells + j;
      if (solid[s] || seen[s]) continue;
      solid[s] = 1;
      buildings.push({
        x: cc(i),
        z: cc(j),
        w: 2,
        d: 2,
        h: 3,
        style: "shop",
        tone: rand(),
        roll: rand(),
      });
      blocks.push({ x: cc(i), z: cc(j), h: 3, tone: 0 });
    }
  }

  // ---- street furniture along the kerbs ----
  const streetlights: Spot[] = [];
  const palms: (Spot & { h: number })[] = [];
  const hydrants: Spot[] = [];
  const benches: Spot[] = [];
  const walks: { x: number; z: number }[] = [];
  const isRoad = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < cells && j < cells && kind[i * cells + j] === K_ROAD;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      if (kind[i * cells + j] !== K_WALK) continue;
      walks.push({ x: cc(i), z: cc(j) });
      const sides = (
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const
      ).filter(([di, dj]) => isRoad(i + di, j + dj));
      if (sides.length !== 1) continue;
      const [di, dj] = sides[0]!;
      const rot = Math.atan2(di, dj); // faces the road
      const x = cc(i);
      const z = cc(j);
      const slot = (i + j) % 3;
      if (slot === 0) streetlights.push({ x: x + di * 0.72, z: z + dj * 0.72, rot });
      else if (slot === 1 && rand() < 0.75)
        palms.push({
          x: x + di * 0.55 + dj * 0.3,
          z: z + dj * 0.55 + di * 0.3,
          rot: rand() * 6.28,
          h: 5 + rand() * 3.5,
        });
      else if (slot === 2) {
        const r = rand();
        if (r < 0.14)
          hydrants.push({ x: x + di * 0.7 + dj * 0.5, z: z + dj * 0.7 + di * 0.5, rot });
        else if (r < 0.3) benches.push({ x: x - di * 0.45, z: z - dj * 0.45, rot });
      }
    }
  }

  // ---- backdrop: the street grid keeps going past the wall, as skyline only ----
  const lo = -BACKDROP_CELLS;
  const hi = cells - 1 + BACKDROP_CELLS;
  const span = hi - lo + 1;
  const bkKind = (i: number, j: number) => {
    const ai = axisRaw(i);
    const aj = axisRaw(j);
    if (ai === A_ROAD || aj === A_ROAD) return K_ROAD;
    if (ai === A_WALK || aj === A_WALK) return K_WALK;
    return K_LOT;
  };
  const taken = new Uint8Array(span * span);
  const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < cells && j < cells;
  const bfree = (i: number, j: number) =>
    i >= lo &&
    j >= lo &&
    i <= hi &&
    j <= hi &&
    !inside(i, j) &&
    bkKind(i, j) === K_LOT &&
    !taken[(i - lo) * span + (j - lo)];
  for (let i = lo; i <= hi; i++) {
    for (let j = lo; j <= hi; j++) {
      if (inside(i, j)) continue;
      const k = bkKind(i, j);
      const dist = Math.max(Math.abs(cc(i)), Math.abs(cc(j))) - half;
      if (k === K_WALK && dist < 26) walks.push({ x: cc(i), z: cc(j) });
      if (!bfree(i, j)) continue;
      const tw = 1 + Math.floor(rand() * 4);
      const td = 1 + Math.floor(rand() * 4);
      let w = 1;
      while (w < tw && bfree(i + w, j)) w++;
      let d = 1;
      const rowFree = (jj: number) => {
        for (let q = 0; q < w; q++) if (!bfree(i + q, jj)) return false;
        return true;
      };
      while (d < td && rowFree(j + d)) d++;
      for (let a = 0; a < w; a++)
        for (let b = 0; b < d; b++) taken[(i + a - lo) * span + (j + b - lo)] = 1;
      const x = (cc(i) + cc(i + w - 1)) / 2;
      const z = (cc(j) + cc(j + d - 1)) / 2;
      const near = dist < 12;
      const tower = Math.min(w, d) >= 2 && rand() < (near ? 0.35 : 0.6);
      const h = tower ? 26 + rand() * 48 : near ? 7 + rand() * 16 : 10 + rand() * 24;
      const styles: BuildingStyle[] = tower
        ? ["glass", "office", "glass"]
        : ["brick", "office", "deco", "brick"];
      buildings.push({
        x,
        z,
        w: w * 2 - 0.3,
        d: d * 2 - 0.3,
        h,
        style: styles[Math.floor(rand() * styles.length)]!,
        tone: rand(),
        roll: rand(),
        backdrop: true,
      });
    }
  }
  const farRoads: number[] = [];
  for (let i = lo; i <= hi; i++)
    if (axisRaw(i) === A_ROAD && mod(i) === 0) farRoads.push(cc(i) + 1);

  const layout: CityLayout = {
    cells,
    half,
    kind,
    roadX,
    roadZ,
    farRoads,
    buildings,
    parked,
    streetlights,
    palms,
    hydrants,
    benches,
    walks,
    parking,
    extent: half + BACKDROP_CELLS * 2,
  };
  return { blocks, layout };
}

function shapeBuilding(
  rand: () => number,
  x: number,
  z: number,
  w: number,
  d: number,
  half: number,
  edge: boolean,
): Building {
  const r = Math.hypot(x, z) / half;
  const c = Math.max(0, 1 - r * 0.85); // 1 at the middle, fades out
  const minS = Math.min(w, d);
  const roll = rand();
  let style: BuildingStyle;
  let h: number;
  if (!edge && minS >= 2 && roll < 0.3 + 0.55 * c) {
    style = rand() < 0.55 ? "glass" : "office";
    h = 24 + rand() * (16 + 26 * c);
  } else if (roll < 0.78 || edge) {
    const mids: BuildingStyle[] = ["brick", "deco", "office", "brick", "deco"];
    style = mids[Math.floor(rand() * mids.length)]!;
    h = edge ? 7 + rand() * 12 : 9 + rand() * (minS >= 2 ? 12 : 8);
  } else {
    style = rand() < 0.55 ? "shop" : "deco";
    h = 4.5 + rand() * 3.5;
  }
  return { x, z, w: w * 2 - 0.3, d: d * 2 - 0.3, h, style, tone: rand(), roll: rand() };
}
