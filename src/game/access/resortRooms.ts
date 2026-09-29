// Extra resort-room furniture is installed before rendering/nav, into the original room
// plans. The renderer, feet and shots therefore consume exactly the same closed volumes.
import {
  circleTouches,
  type Rect,
  type Structure,
  type Surface,
  type Volume,
} from "../structures/plan";
import { installStructures, structureList } from "../structures/world";
import type { AccessBuilding } from "./layout";

type Theme = "pier" | "alpine";
type Fixture = { name: string; floor: number; solids: Volume[] };
type Part = [number, number, number, number, number, number, string];
const installed = new WeakMap<Structure, Fixture[]>();
/** Diagnostic metadata refers to the exact volumes appended to the physical plan. */
export const resortRoomFixtures = (p: Structure): readonly Fixture[] => installed.get(p) ?? [];
const overlaps = (a: Rect, b: Rect, gap = 0) =>
  a.x1 > b.x0 - gap && a.x0 < b.x1 + gap && a.z1 > b.z0 - gap && a.z0 < b.z1 + gap;
const WOOD = "#986b45",
  DARK = "#574333",
  CREAM = "#ddcbae";

function shelf(colors: string[], width = 1.6): Part[] {
  const a = width / 2,
    parts: Part[] = [
      [-a, a, 0, 0.12, -0.3, 0.3, DARK],
      [-a, -a + 0.07, 0.12, 1.92, -0.3, 0.3, WOOD],
      [a - 0.07, a, 0.12, 1.92, -0.3, 0.3, WOOD],
      [-a, a, 0.12, 1.92, 0.24, 0.3, WOOD],
    ];
  for (const y of [0.16, 0.7, 1.24]) {
    parts.push([-a + 0.07, a - 0.07, y, y + 0.06, -0.3, 0.24, CREAM]);
    for (let i = 0; i < 4; i++) {
      const x = -a + 0.15 + (i * (width - 0.25)) / 4;
      parts.push([
        x,
        x + (width - 0.45) / 4,
        y + 0.06,
        y + 0.35,
        -0.22,
        0.2,
        colors[i % colors.length]!,
      ]);
    }
  }
  return parts;
}
function island(): Part[] {
  const p: Part[] = [
    [-0.66, 0.66, 0, 0.72, -0.4, 0.4, WOOD],
    [-0.73, 0.73, 0.72, 0.8, -0.47, 0.47, CREAM],
  ];
  for (const [x, color] of [
    [-0.36, "#708c9b"],
    [0.32, "#d28670"],
  ] as const)
    for (let i = 0; i < 3; i++)
      p.push([x - 0.23, x + 0.23, 0.8 + i * 0.065, 0.865 + i * 0.065, -0.25, 0.25, color]);
  return p;
}
function boards(): Part[] {
  const p: Part[] = [
    [-0.92, 0.92, 0, 0.12, -0.32, 0.32, DARK],
    [-0.92, -0.83, 0.12, 1.38, 0.2, 0.3, WOOD],
    [0.83, 0.92, 0.12, 1.38, 0.2, 0.3, WOOD],
    [-0.92, 0.92, 1.26, 1.38, 0.16, 0.3, WOOD],
  ];
  for (let i = 0; i < 4; i++) {
    const x = -0.69 + i * 0.46,
      c = ["#598f9c", "#e7bd62", "#ce7258", "#73947d"][i]!;
    p.push(
      [x - 0.17, x + 0.17, 0.12, 1.74, -0.07, 0.04, c],
      [x - 0.11, x + 0.11, 1.74, 1.94, -0.07, 0.04, c],
    );
    p.push([x - 0.025, x + 0.025, 0.24, 1.68, -0.085, -0.07, CREAM]);
  }
  return p;
}
function arcade(): Part[] {
  return [
    [-0.46, 0.46, 0, 0.86, -0.44, 0.44, "#463b69"],
    [-0.46, 0.46, 0.86, 1.9, -0.1, 0.44, "#655184"],
    [-0.5, 0.5, 0.86, 0.96, -0.58, 0.02, "#242d39"],
    [-0.37, 0.37, 1.12, 1.68, -0.13, -0.1, "#78bdba"],
    [-0.41, 0.41, 1.76, 1.88, -0.14, -0.1, "#e0b466"],
    [-0.08, 0.08, 0.2, 0.36, -0.46, -0.44, "#202936"],
    [-0.25, -0.2, 0.96, 1.09, -0.41, -0.36, "#e2c88b"],
    [0.14, 0.23, 0.96, 1.0, -0.43, -0.34, "#df806f"],
    [-0.25, 0.02, 1.25, 1.29, -0.145, -0.13, "#e9d995"],
    [0.07, 0.26, 1.4, 1.44, -0.145, -0.13, "#fff2ba"],
  ];
}
function service(): Part[] {
  const p: Part[] = [
    [-0.9, 0.9, 0, 0.88, -0.36, 0.36, WOOD],
    [-0.95, 0.95, 0.88, 0.96, -0.41, 0.41, "#d7cebb"],
    [-0.7, -0.18, 0.96, 1.33, -0.21, 0.21, "#596364"],
    [-0.63, -0.25, 1.12, 1.26, -0.24, -0.21, "#282f30"],
    [-0.67, -0.22, 0.96, 0.995, -0.31, -0.2, "#c3b78e"],
  ];
  for (let i = 0; i < 3; i++)
    p.push([0.09 + i * 0.2, 0.22 + i * 0.2, 0.96, 1.14, -0.1, 0.04, CREAM]);
  return p;
}
function reception(): Part[] {
  return [
    ...service().slice(0, 2),
    [-0.45, 0.08, 0.96, 1.0, -0.24, 0.19, CREAM],
    [0.42, 0.61, 0.96, 1.0, -0.12, 0.07, "#b49358"],
    [0.48, 0.55, 1.0, 1.11, -0.06, 0.01, "#b49358"],
  ];
}
function bench(): Part[] {
  return [
    [-0.8, -0.65, 0, 0.41, -0.29, 0.29, DARK],
    [0.65, 0.8, 0, 0.41, -0.29, 0.29, DARK],
    [-0.86, 0.86, 0.38, 0.52, -0.36, 0.36, "#82614a"],
    [-0.86, 0.86, 0.52, 0.87, 0.25, 0.36, "#967456"],
    [-0.76, -0.27, 0.52, 0.59, -0.27, 0.23, "#687b6a"],
    [-0.2, 0.27, 0.52, 0.59, -0.27, 0.23, "#687b6a"],
    [0.34, 0.76, 0.52, 0.59, -0.27, 0.23, "#687b6a"],
  ];
}
function trunk(): Part[] {
  return [
    [-0.7, 0.7, 0, 0.12, -0.33, 0.33, DARK],
    [-0.75, 0.75, 0.12, 0.64, -0.38, 0.38, WOOD],
    [-0.77, 0.77, 0.64, 0.71, -0.4, 0.4, "#b18860"],
    [-0.07, 0.07, 0.43, 0.6, -0.405, -0.38, "#b69861"],
    [-0.54, 0.32, 0.71, 0.79, -0.29, 0.29, "#7e8b73"],
    [-0.5, 0.35, 0.79, 0.86, -0.27, 0.28, "#bfa37c"],
  ];
}

/** Preserve every baseline walking component, using a modest one-time 0.4m grid. */
function circulation(p: Structure, floor: Surface, solids: Volume[]) {
  const r = floor,
    step = 0.4,
    nx = Math.ceil((r.x1 - r.x0) / step),
    nz = Math.ceil((r.z1 - r.z0) / step);
  const mask = new Int32Array(nx * nz);
  const walls = solids.filter((v) => v.y1 > floor.y + 0.2 && v.y0 < floor.y + 1.8);
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const x = r.x0 + (i + 0.5) * step,
        z = r.z0 + (j + 0.5) * step;
      if (
        x < r.x0 + 0.62 ||
        x > r.x1 - 0.62 ||
        z < r.z0 + 0.62 ||
        z > r.z1 - 0.62 ||
        floor.holes.some((h) => circleTouches(h, x, z, 0.4)) ||
        walls.some((v) => circleTouches(v, x, z, 0.4))
      )
        continue;
      mask[i * nz + j] = -1;
    }
  return labelPaths(mask, nx, nz);
}
function labelPaths(mask: Int32Array, nx: number, nz: number) {
  let label = 0;
  for (let k = 0; k < mask.length; k++) {
    if (mask[k] !== -1) continue;
    const queue = [k];
    mask[k] = ++label;
    for (let h = 0; h < queue.length; h++) {
      const i = Math.floor(queue[h]! / nz),
        j = queue[h]! % nz;
      for (const [a, b] of [
        [i - 1, j],
        [i + 1, j],
        [i, j - 1],
        [i, j + 1],
      ]) {
        if (a! < 0 || a! >= nx || b! < 0 || b! >= nz) continue;
        const n = a! * nz + b!;
        if (mask[n] === -1) {
          mask[n] = label;
          queue.push(n);
        }
      }
    }
  }
  return mask;
}
/** Existing occupancy never changes: test only the candidate's bounded cells. */
function withFixture(before: Int32Array, floor: Surface, solids: Volume[]) {
  const step = 0.4;
  const nx = Math.ceil((floor.x1 - floor.x0) / step);
  const nz = Math.ceil((floor.z1 - floor.z0) / step);
  const mask = before.map((label) => (label > 0 ? -1 : 0));
  for (const v of solids) {
    if (v.y1 <= floor.y + 0.2 || v.y0 >= floor.y + 1.8) continue;
    const i0 = Math.max(0, Math.floor((v.x0 - 0.4 - floor.x0) / step - 0.5));
    const i1 = Math.min(nx - 1, Math.ceil((v.x1 + 0.4 - floor.x0) / step - 0.5));
    const j0 = Math.max(0, Math.floor((v.z0 - 0.4 - floor.z0) / step - 0.5));
    const j1 = Math.min(nz - 1, Math.ceil((v.z1 + 0.4 - floor.z0) / step - 0.5));
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = i * nz + j;
        if (
          mask[k] &&
          circleTouches(v, floor.x0 + (i + 0.5) * step, floor.z0 + (j + 0.5) * step, 0.4)
        )
          mask[k] = 0;
      }
  }
  return labelPaths(mask, nx, nz);
}
function staysConnected(before: Int32Array, after: Int32Array) {
  const labels = new Map<number, number>();
  for (let i = 0; i < before.length; i++) {
    const a = before[i]!,
      b = after[i]!;
    if (a <= 0 || b <= 0) continue;
    const previous = labels.get(a);
    if (previous !== undefined && previous !== b) return false;
    labels.set(a, b);
  }
  return true;
}

function dress(p: Structure, theme: Theme) {
  const door = p.doors[0];
  if (!door) return;
  const front = door.facing,
    alongX = front === 0 || front === 2;
  const w = alongX ? p.bounds.x1 - p.bounds.x0 : p.bounds.z1 - p.bounds.z0;
  const d = alongX ? p.bounds.z1 - p.bounds.z0 : p.bounds.x1 - p.bounds.x0;
  const point = (u: number, v: number) =>
    front === 0
      ? [p.bounds.x0 + u, p.bounds.z0 + v]
      : front === 1
        ? [p.bounds.x1 - v, p.bounds.z0 + u]
        : front === 2
          ? [p.bounds.x1 - u, p.bounds.z1 - v]
          : [p.bounds.x0 + v, p.bounds.z1 - u];
  const rect = (u0: number, u1: number, v0: number, v1: number): Rect => {
    const a = point(u0, v0),
      b = point(u1, v1);
    return {
      x0: Math.min(a[0]!, b[0]!),
      x1: Math.max(a[0]!, b[0]!),
      z0: Math.min(a[1]!, b[1]!),
      z1: Math.max(a[1]!, b[1]!),
    };
  };
  const records: Fixture[] = [];
  installed.set(p, records);
  // Full slabs only: a grand stair's half-height landing is circulation, not a room.
  const floors = p.floors.filter(
    (f) =>
      Math.abs(f.x0 - p.bounds.x0) < 0.01 &&
      Math.abs(f.x1 - p.bounds.x1) < 0.01 &&
      Math.abs(f.z0 - p.bounds.z0) < 0.01 &&
      Math.abs(f.z1 - p.bounds.z1) < 0.01,
  );
  for (const floor of floors) {
    const ceiling = Math.min(p.top, ...floors.filter((f) => f.y > floor.y + 0.1).map((f) => f.y));
    let paths = circulation(p, floor, p.solids);
    const add = (name: string, parts: Part[], u: number, v: number, turn = 0) => {
      const rotate = (x: number, z: number) =>
        turn === 1 ? [-z, x] : turn === 2 ? [-x, -z] : turn === 3 ? [z, -x] : [x, z];
      const volumes = parts.map(([x0, x1, y0, y1, z0, z1, color]) => {
        const a = rotate(x0, z0),
          b = rotate(x1, z1);
        return {
          ...rect(
            u + Math.min(a[0]!, b[0]!),
            u + Math.max(a[0]!, b[0]!),
            v + Math.min(a[1]!, b[1]!),
            v + Math.max(a[1]!, b[1]!),
          ),
          y0: floor.y + y0,
          y1: floor.y + y1,
          color,
        };
      });
      const bounds = {
        x0: Math.min(...volumes.map((v) => v.x0)),
        x1: Math.max(...volumes.map((v) => v.x1)),
        z0: Math.min(...volumes.map((v) => v.z0)),
        z1: Math.max(...volumes.map((v) => v.z1)),
      };
      if (
        bounds.x0 < floor.x0 + 0.55 ||
        bounds.x1 > floor.x1 - 0.55 ||
        bounds.z0 < floor.z0 + 0.55 ||
        bounds.z1 > floor.z1 - 0.55 ||
        volumes.some((v) => v.y1 > ceiling - 0.35)
      )
        return false;
      const aisle = rect(w / 2 - 1.15, w / 2 + 1.15, 0, d);
      if (
        overlaps(bounds, aisle) ||
        overlaps(bounds, rect(0, w, 0, 1.35)) ||
        floor.holes.some((h) => overlaps(bounds, h, 0.7)) ||
        p.stairs.some((s) => s.y1 > floor.y - 0.05 && s.y0 < ceiling && overlaps(bounds, s, 0.85))
      )
        return false;
      if (
        p.solids.some(
          (q) => q.y1 > floor.y + 0.2 && q.y0 < ceiling - 0.35 && overlaps(bounds, q, 0.48),
        )
      )
        return false;
      const next = withFixture(paths, floor, volumes);
      if (!staysConnected(paths, next)) return false;
      paths = next;
      p.solids.push(...volumes);
      records.push({ name, floor: floor.y, solids: volumes });
      return true;
    };
    const wallPlaces = [
      [1.15, d - 1.75, 1],
      [w - 1.15, d - 1.75, 3],
      [2.2, d - 1.2, 0],
      [w - 2.2, d - 1.2, 0],
      [1.15, d * 0.52, 1],
      [w - 1.15, d * 0.52, 3],
      [1.15, 2.8, 1],
      [w - 1.15, 2.8, 3],
    ];
    const islandPlaces = [
      [w * 0.25, d * 0.4, 0],
      [w * 0.74, d * 0.4, 0],
      [w * 0.25, d * 0.65, 0],
      [w * 0.74, d * 0.65, 0],
      [w * 0.25, d * 0.82, 0],
      [w * 0.74, d * 0.82, 0],
    ];
    const place = (name: string, parts: Part[], choices = wallPlaces) => {
      for (const [u, v, turn] of choices) if (add(name, parts, u!, v!, turn!)) return;
    };
    if (p.kind === "shop") {
      const surf = p.id.startsWith("pier-surf-");
      place(
        surf ? "surfboard-rental-rack" : "stocked-retail-display",
        surf ? boards() : shelf(["#cb9670", "#6f8c9c", "#b2aa71"]),
      );
      place(surf ? "rental-towel-island" : "folded-apparel-island", island(), islandPlaces);
      place(
        surf ? "surf-supply-shelves" : "accessory-display",
        shelf(["#b39e67", "#708f86", "#b47667"], 1.25),
        [...wallPlaces].reverse(),
      );
    } else if (p.kind === "arcade") {
      place("arcade-game-cabinet", arcade());
      place("arcade-prize-display", shelf(["#ce7f99", "#8badb8", "#ddbd65"], 1.8));
      place("arcade-waiting-bench", bench(), islandPlaces);
    } else if (p.kind === "cafe") {
      place("coffee-service-counter", service());
      place(
        "cup-and-pantry-hutch",
        shelf([CREAM, "#ad785b", "#879475"], 1.35),
        [...wallPlaces].reverse(),
      );
    } else if (p.kind === "hotel") {
      place(
        floor.y === p.base ? "hotel-reception-counter" : "hotel-tea-counter",
        floor.y === p.base ? reception() : service(),
        [[w - 1.15, 3.1, 3], [1.15, 3.1, 1], ...wallPlaces],
      );
      place("hotel-reading-cabinet", shelf(["#887856", "#6a8076", "#a26b60"], 1.4));
    } else {
      place(
        p.kind === "chalet" ? "chalet-blanket-chest" : "lodge-boot-bench",
        p.kind === "chalet" ? trunk() : bench(),
      );
      place(
        "alpine-reading-cabinet",
        shelf(["#667b68", "#ae885f", "#93765e"], 1.35),
        [...wallPlaces].reverse(),
      );
    }
    // A shallow frieze is fixed into the existing opaque rear wall, above head height.
    // Front glazing and every physical opening remain exactly as authored by roomPlan.
    const strip = {
      ...rect(0.25, w - 0.25, d - 0.25, d - 0.205),
      y0: ceiling - 0.53,
      y1: ceiling - 0.42,
      color: theme === "pier" ? "#538a94" : "#70513a",
    };
    p.solids.push(strip);
    records.push({ name: "rear-wall-frieze", floor: floor.y, solids: [strip] });
  }
}

/** Called only at the final access install; a null reset or unrelated map is a no-op. */
export function dressResortRooms(list: readonly AccessBuilding[] | null) {
  if (!list?.length) return;
  const pier = list.some((b) => b.spec.furnishings?.lobby === "pier-reception");
  const alpine = list.some(
    (b) => b.spec.furnishings?.room === "hotel-lounge" || b.spec.furnishings?.room === "belfry",
  );
  if (!pier && !alpine) return;
  let changed = false;
  const plans = structureList();
  for (const p of plans) {
    if (installed.has(p)) continue;
    const theme =
      pier && /^pier-(shop|surf|arcade|cafe)-/.test(p.id)
        ? "pier"
        : alpine &&
            (/^alpine-(cafe|lodge|chalet)-/.test(p.id) || p.id === "alpine-grand-west-lobby")
          ? "alpine"
          : null;
    if (!theme) continue;
    dress(p, theme);
    changed = true;
  }
  if (changed) installStructures(plans);
}
