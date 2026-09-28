// Dry Gulch's street plan, the one table every system shares: the layout stamps these
// carriageways as ground, earth.ts keeps them graded, riderSim drives its riders along the
// same centre lines, and the ground shader lays wheel ruts down them. A real 1880s
// boomtown grid: one wide main street, narrower parallel business streets, and cross
// streets about 60-90 m apart with alleys splitting the deep blocks.
//
//   x -> east     z -> south     Main Street runs east-west on z = 0
import type { Edge, Net, Node } from "./riderSim";

/** An east-west street: carriageway |z - cz| < hw for x in [x0, x1]. */
export type EW = { z: number; hw: number; x0: number; x1: number; name: string };
/** A north-south street: carriageway |x - cx| < hw for z in [z0, z1]. */
export type NS = { x: number; hw: number; z0: number; z1: number; name: string };

export const EW_ST: EW[] = [
  // Second Street: the north residential street under the mining hillside
  { z: -124, hw: 5, x0: -196, x1: 118, name: "SECOND" },
  // North Street: the second business row
  { z: -64, hw: 6, x0: -236, x1: 140, name: "NORTH" },
  // Main Street (the church closes its west end, the depot its east)
  { z: 0, hw: 12, x0: -128, x1: 146, name: "MAIN" },
  // South Street: the southern business row
  { z: 78, hw: 6, x0: -196, x1: 140, name: "SOUTH" },
  // Front Street on the levee: the river bends north across the west side, so this only
  // runs the east half; a levee trail follows the bank on the west
  { z: 138, hw: 5, x0: -40, x1: 140, name: "FRONT" },
];

export const NS_ST: NS[] = [
  // Hill lane: the far west cross street, Boot Hill trail off its north end
  { x: -186, hw: 5, z0: -64, z1: 134, name: "HILL" },
  // the west cross street
  { x: -108, hw: 5, z0: -156, z1: 138, name: "WEST" },
  // the main cross street (the wide one it started with)
  { x: -22, hw: 8, z0: -190, z1: 140, name: "CENTER" },
  // Laundry Row: through Chinatown, out over the bridge to the south bank
  { x: 54, hw: 5, z0: -190, z1: 148, name: "LAUNDRY" },
  // the station road, into the freight approach
  { x: 118, hw: 5, z0: -190, z1: 138, name: "STATION" },
];

/** Mid-block alleys: narrow lanes (walked, fought in, no buildings fronting them). */
export const ALLEYS: { x: number; z: number; hw: number; axis: "x" | "z"; len: number }[] = [
  { x: -80, z: -46, hw: 2.2, axis: "x", len: 190 }, // behind Main's north row, -175..15
  { x: -98, z: 47, hw: 2.2, axis: "x", len: 160 }, // behind Main's south row, -178..-18
  { x: 48, z: -96, hw: 2, axis: "x", len: 132 }, // Second/North block alley, -18..114
  { x: 24, z: 108, hw: 2, axis: "x", len: 140 }, // Chinatown service lane, -46..94
  { x: -152, z: -30, hw: 2, axis: "z", len: 120 }, // -90..30 mid-west
  { x: -65, z: -98, hw: 2, axis: "z", len: 62 }, // -129..-67
  { x: 16, z: 32, hw: 2, axis: "z", len: 92 }, // -14..78
  { x: 86, z: -18, hw: 2, axis: "z", len: 104 }, // -70..34
  { x: -152, z: 98, hw: 2, axis: "z", len: 76 }, // 60..136
  { x: -66, z: 28, hw: 2, axis: "z", len: 104 }, // -24..80 (skips the plaza block south)
];

export const inEW = (x: number, z: number) =>
  EW_ST.some((s) => Math.abs(z - s.z) < s.hw && x > s.x0 && x < s.x1);
export const inNS = (x: number, z: number) =>
  NS_ST.some((s) => Math.abs(x - s.x) < s.hw && z > s.z0 && z < s.z1);
export const inStreet = (x: number, z: number) => inEW(x, z) || inNS(x, z);
export const inAlley = (x: number, z: number) =>
  ALLEYS.some((a) =>
    a.axis === "x"
      ? Math.abs(z - a.z) < a.hw && Math.abs(x - a.x) < a.len / 2
      : Math.abs(x - a.x) < a.hw && Math.abs(z - a.z) < a.len / 2,
  );

// -------------------------------------------------------------------------------------
// Districts (ground + building fill all read the same rectangles)
// -------------------------------------------------------------------------------------
/** the Mexican quarter's plaza (the mission church closes its east edge) */
export const PLAZA = { x0: -104, z0: 88, x1: -48, z1: 124 };
/** Chinatown's blocks (laundry row): south of South Street, along the Laundry street */
export const CHINATOWN = { x0: 60, z0: 84, x1: 112, z1: 132 };
/** the freight yard east of the line (pens, shed, sidings, the engine shed) */
export const YARD = { x0: 152, z0: -118, x1: 250, z1: 132 };
/** the mining district: terraced benches up the north hillside to the portal */
export const MINING = { x0: -8, z0: -196, x1: 140, z1: -130 };
/** Boot Hill, on the rise north-west of town */
export const BOOTHILL = { x0: -260, z0: -132, x1: -214, z1: -72 };
/** the tent-city edge on the south bank of the dry river */
export const TENTS = { x0: 26, z0: 196, x1: 96, z1: 240 };

// -------------------------------------------------------------------------------------
// The road network the riders drive: centre lines of every street, joined at the
// intersections, plus the out-of-town legs (the east road to the ring pass, the stage
// road around the church). Every end sits inside the solo square.
// -------------------------------------------------------------------------------------
export function streetNet(): Net {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const N = (x: number, z: number) => nodes.push({ x, z, e: [] }) - 1;
  const E = (a: number, b: number, lane: number) => {
    const na = nodes[a]!;
    const nb = nodes[b]!;
    const i = edges.push({ a, b, len: Math.hypot(nb.x - na.x, nb.z - na.z), lane }) - 1;
    na.e.push(i);
    nb.e.push(i);
  };
  const key = new Map<string, number>();
  const J = (x: number, z: number) => {
    const k = `${x},${z}`;
    let n = key.get(k);
    if (n === undefined) {
      n = N(x, z);
      key.set(k, n);
    }
    return n;
  };
  // intersections of every NS street with every EW street it crosses, and its own ends
  for (const ns of NS_ST) {
    const pts: { z: number; id: number }[] = [];
    for (const ew of EW_ST)
      if (ns.x > ew.x0 && ns.x < ew.x1 && ew.z > ns.z0 && ew.z < ns.z1)
        pts.push({ z: ew.z, id: J(ns.x, ew.z) });
    pts.push({ z: ns.z0, id: J(ns.x, ns.z0) });
    pts.push({ z: ns.z1, id: J(ns.x, ns.z1) });
    pts.sort((a, b) => a.z - b.z);
    for (let i = 1; i < pts.length; i++) E(pts[i - 1]!.id, pts[i]!.id, 1.6);
  }
  for (const ew of EW_ST) {
    const pts: { x: number; id: number }[] = [];
    for (const ns of NS_ST)
      if (ew.z > ns.z0 && ew.z < ns.z1 && ns.x > ew.x0 && ns.x < ew.x1)
        pts.push({ x: ns.x, id: J(ns.x, ew.z) });
    pts.push({ x: ew.x0, id: J(ew.x0, ew.z) });
    pts.push({ x: ew.x1, id: J(ew.x1, ew.z) });
    pts.sort((a, b) => a.x - b.x);
    for (let i = 1; i < pts.length; i++) E(pts[i - 1]!.id, pts[i]!.id, ew.name === "MAIN" ? 2.6 : 1.6);
  }
  // the east road out to the ring pass
  const eastRd = N(206, 1);
  const eastEnd = N(258, 2);
  E(J(146, 0), eastRd, 1.8);
  E(eastRd, eastEnd, 1.8);
  // the stage road west: off North Street's end, around the church, to the ring pass
  const stage1 = N(-248, -30);
  const stage2 = N(-252, -14);
  const stage3 = N(-252, 30);
  E(J(-236, -64), stage1, 1.6);
  E(stage1, stage2, 1.6);
  E(stage2, stage3, 1.6);
  return { nodes, edges };
}

/** the street axes for the ground shader's wheel ruts */
export const STREET_SHADER = {
  ew: EW_ST.map((s) => [s.z, s.hw, s.x0, s.x1] as const),
  ns: NS_ST.map((s) => [s.x, s.hw, s.z0, s.z1] as const),
};
