import type { BBld, BProp, PropKind, Rect } from "./beachLayout";

/** Four unobstructed crossings, between the existing park features and beach buildings. */
export const BEACH_MAT_Z = [-216, -136, 112, 272] as const;
export const BEACH_SAND_LANE: Rect = { x0: 46, x1: 50, z0: -400, z1: 400 };
export const BOARDWALK_LANE: Rect = { x0: 134, x1: 138, z0: -400, z1: 400 };
export type BeachCourt = { x: number; z: number; y: number; phase: number; active: boolean };
export type BeachPocket = Rect & {
  kind: "shade" | "picnic" | "surf" | "fire" | "volleyball" | "vendor";
};
export type BeachActivity = { courts: BeachCourt[]; pockets: BeachPocket[]; lanes: Rect[] };

export const overlaps = (a: Rect, b: Rect) =>
  a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
const expand = (a: Rect, m: number): Rect => ({
  x0: a.x0 - m,
  x1: a.x1 + m,
  z0: a.z0 - m,
  z1: a.z1 + m,
});
const box = (x: number, z: number, hx: number, hz: number): Rect => ({
  x0: x - hx,
  x1: x + hx,
  z0: z - hz,
  z1: z + hz,
});

/** Horizontal visible extents, including table canopies; poles only for palms/lights. */
export function beachPropBounds(p: BProp, margin = 0): Rect {
  const sizes: Partial<Record<PropKind, [number, number]>> = {
    umbrella: [1.3, 1.3],
    towel: [0.45, 0.9],
    board: [0.3, 0.25],
    cooler: [0.31, 0.21],
    firering: [0.95, 0.95],
    net: [4.7, 0.1],
    cart: [1.1, 0.7],
    table: [1.4, 1.4],
    bench: [1.1, 0.4],
    trash: [0.4, 0.4],
    shower: [0.7, 0.7],
    mat: [1.2, 2],
    bike: [0.9, 0.3],
    palm: [0.55, 0.55],
    lamp: [0.3, 0.3],
    flag: [1.8, 0.3],
  };
  const [hx, hz] = sizes[p.k] ?? [1.2, 1.2];
  const c = Math.abs(Math.cos(p.rot)),
    s = Math.abs(Math.sin(p.rot));
  return box(p.x, p.z, c * hx + s * hz + margin, s * hx + c * hz + margin);
}

/** Authored groups reserve their complete footprints before any loose dressing is placed. */
export function planBeachActivity(input: {
  half: number;
  random: () => number;
  height: (x: number, z: number) => number;
  free: (x0: number, z0: number, x1: number, z1: number) => boolean;
  buildings: BBld[];
  regions: Rect[];
  features: Rect[];
  towers: { x: number; z: number }[];
  existing: BProp[];
}) {
  const { half, random: r, height, free } = input;
  const props: BProp[] = [],
    fires: { x: number; z: number }[] = [];
  const activity: BeachActivity = {
    courts: [],
    pockets: [],
    lanes: [
      { ...BEACH_SAND_LANE, z0: -half, z1: half },
      { ...BOARDWALK_LANE, z0: -half, z1: half },
      ...BEACH_MAT_Z.map((z) => ({ x0: -70, x1: 148, z0: z - 2, z1: z + 2 })),
    ],
  };
  const reserved: Rect[] = [
    ...activity.lanes,
    // This includes all four stair approaches and the landward pier ramp.
    ...input.regions.map((p) => expand(p, 4)),
    ...input.features.map((p) => expand(p, 3)),
    ...input.buildings.map((p) => expand(p, 4)),
    ...input.towers.map((p) => box(p.x + 0.8, p.z, 6, 6)),
    // Keep the shore-front open for walking and views along the water.
    { x0: -70, x1: -34, z0: -half, z1: half },
  ];
  const occupied = input.existing.filter((p) => p.k !== "mat").map((p) => beachPropBounds(p, 0.8));
  const add = (k: PropKind, x: number, z: number, rot = 0, c = 0) =>
    props.push({ k, x, z, rot, c, y: height(x, z) });
  const reserve = (rc: Rect, kind: BeachPocket["kind"]) => {
    if (
      rc.z0 < -half + 12 ||
      rc.z1 > half - 12 ||
      reserved.some((p) => overlaps(rc, p)) ||
      occupied.some((p) => overlaps(rc, p)) ||
      !free(rc.x0, rc.z0, rc.x1, rc.z1)
    )
      return false;
    reserved.push(expand(rc, 2));
    activity.pockets.push({ ...rc, kind });
    return true;
  };

  // Full courts with sideline seats and equipment, rather than isolated nets in towel scatter.
  for (const z of [-300, -236, -168, -88, 64, 152, 220, 308]) {
    const x = 18 + Math.floor(r() * 4) * 2;
    if (!reserve(box(x, z, 9, 12), "volleyball")) continue;
    add("net", x, z);
    add("bench", x + 7.3, z - 4, -Math.PI / 2);
    add("bench", x + 7.3, z + 4, -Math.PI / 2);
    add("cooler", x + 7.3, z, 0, 2);
    activity.courts.push({
      x,
      z,
      y: height(x, z),
      phase: r() * Math.PI * 2,
      active: [-236, -88, 152].includes(z),
    });
  }

  // A loose rhythm with clear paths between groups. The east sand now has picnic, surf-rental
  // and fire-circle destinations, while the west remains towel/shade space beside the shore.
  for (let z = -half + 28, row = 0; z < half - 20; z += 28, row++) {
    for (const [column, x0] of [-22, 1, 30, 65, 83].entries()) {
      const x = x0 + (r() - 0.5) * 3,
        zz = z + (r() - 0.5) * 6;
      const c = (row + column * 2) % 8;
      const kind: BeachPocket["kind"] =
        column < 3
          ? "shade"
          : (row + column) % 4 === 0
            ? "surf"
            : (row + column) % 4 === 1
              ? "fire"
              : "picnic";
      if (!reserve(box(x, zz, kind === "shade" ? 4 : 5.4, kind === "shade" ? 4 : 5.4), kind))
        continue;
      if (kind === "shade") {
        add("umbrella", x, zz, 0, c);
        add("towel", x - 1.8, zz + 0.6, 0.12, c);
        add("towel", x + 1.7, zz + 0.5, -0.16, c + 2);
        add("cooler", x, zz - 2.1, 0, c);
      } else if (kind === "picnic") {
        add("table", x - 2.4, zz, 0, c);
        add("table", x + 2.4, zz, 0, c + 2);
        add("cooler", x, zz - 3.3, 0, c);
        add("trash", x + 3.8, zz + 3.7);
      } else if (kind === "surf") {
        add("cart", x, zz + 2.8, Math.PI, c);
        for (let k = 0; k < 4; k++) add("board", x - 2.4 + k * 1.6, zz - 2.6, 0, c + k);
        add("bench", x - 3.8, zz + 0.2, Math.PI / 2);
        add("cooler", x + 3.7, zz + 2.8, 0, c);
      } else {
        add("firering", x, zz);
        for (const [dx, dz, rot] of [
          [0, -3.5, 0],
          [0, 3.5, Math.PI],
          [-3.5, 0, Math.PI / 2],
        ])
          add("bench", x + dx!, zz + dz!, rot);
        add("cooler", x + 3.4, zz - 2, 0, c);
        fires.push({ x, z: zz });
      }
    }
  }
  return { props, fires, activity };
}

/** Four players stay inside the court; a fixed shared clock makes the vignette client-stable. */
export function volleyballPose(court: BeachCourt, player: number, time: number) {
  const side = player < 2 ? -1 : 1;
  const x = court.x + (player % 2 ? 2.2 : -2.2);
  const z = court.z + side * 4.4;
  const beat = (((time * 0.38 + court.phase) % 4) + 4) % 4;
  const order = [0, 3, 1, 2];
  const distance = Math.min(
    Math.abs(beat - order.indexOf(player)),
    4 - Math.abs(beat - order.indexOf(player)),
  );
  return { x, z, yaw: side < 0 ? 0 : Math.PI, lift: Math.max(0, 1 - distance * 3) };
}

export function volleyballBall(court: BeachCourt, time: number) {
  const beat = (((time * 0.38 + court.phase) % 4) + 4) % 4;
  const order = [0, 3, 1, 2];
  const leg = Math.floor(beat),
    t = beat - leg;
  const a = volleyballPose(court, order[leg]!, time);
  const b = volleyballPose(court, order[(leg + 1) % 4]!, time);
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t + Math.cos(a.yaw) * 0.5 * (1 - 2 * t),
    y: court.y + 1.28 + Math.sin(t * Math.PI) * 2.4,
  };
}
