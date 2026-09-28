// The boomtown fill. layout.ts lays the streets and builds Main Street's anchors; this
// module fills the rest of the grid: the false-front rows on North and South streets,
// house lots on Second, Front and the cross streets, and the districts - the Mexican
// quarter's plaza and mission, Chinatown's laundry row, the freight yard, the mining
// hillside, Boot Hill and the tent city on the south bank. Everything goes through the
// same kit (bld/prop/markSolid/isFree...) so collision, ground and signs stay honest.
import {
  BOARD_D,
  DECK_Y,
  LEAN_D,
  WK,
  W,
  type WMat,
  type WBld,
  type WProp,
  type WPropKind,
} from "./layout";
import { roomPlan, toWorld } from "./rooms";
import { riverW, riverZ } from "./river";
import { BOOTHILL, CHINATOWN, EW_ST, MINING, NS_ST, PLAZA, TENTS, YARD } from "./streets";

export type Post = { x: number; z: number; r: number; shot?: boolean; h?: number };
/** a raised walkable deck (a bridge): layout's section 9 turns it into real terrain */
export type Deck = { x0: number; z0: number; x1: number; z1: number; y: number; axis: "x" | "z" };
export type Rect = { x0: number; x1: number; z0: number; z1: number };

export type Kit = {
  rand: () => number;
  bld: (b: Omit<WBld, "seed" | "tone"> & { tone?: number }) => WBld;
  prop: (k: WPropKind, x: number, z: number, rot?: number, s?: number, a?: number) => void;
  solidProp: (
    k: WPropKind,
    x: number,
    z: number,
    rot: number,
    w: number,
    d: number,
    h: number,
    s?: number,
  ) => void;
  setGround: (x0: number, z0: number, x1: number, z1: number, k: number) => void;
  markSolid: (x0: number, z0: number, x1: number, z1: number, h: number) => void;
  isFree: (x0: number, z0: number, x1: number, z1: number) => boolean;
  posts: Post[];
  boardY: Map<string, number>;
  buildings: WBld[];
  props: WProp[];
  decks: Deck[];
  sal: {
    stairs: {
      x0: number;
      x1: number;
      zBottom: number;
      zTop: number;
      zEdge: number;
    } | null;
    lot: { x0: number; x1: number; zf: number; north: boolean } | null;
  };
  pickMat: () => WMat;
  nextFiller: () => number;
  picket: (xa: number, za: number, xb: number, zb: number) => void;
  backYard: (bx: number, bz: number, ox: number, oz: number, w: number) => void;
  footprint: (
    k: WPropKind,
    x: number,
    z: number,
    rot: number,
    scale: number,
  ) => Rect | undefined;
  doorApproaches: () => readonly Rect[];
  overlaps: (a: Rect, b: Rect, gap?: number) => boolean;
};

export type RowPlan = {
  w: number;
  t: WBld["t"];
  sign: number;
  storeys: number;
  mat?: WMat;
  porch?: 0 | 1 | 2;
  ff?: 0 | 1 | 2 | 3;
  d?: number;
  walkIn?: boolean;
};

/** a row of false-front buildings along an east-west street. `north` = the row on the -z
 * side of the street (buildings face +z). The front line sits BOARD_D off the carriageway
 * edge, with a walkable boardwalk in between. */
export function townRow(
  K: Kit,
  north: boolean,
  zc: number,
  hw: number,
  x0: number,
  x1: number,
  fixed: RowPlan[],
  abut?: number,
  maxD = 22,
) {
  const { rand, bld, prop, solidProp, setGround, markSolid, isFree, posts, boardY, buildings } =
    K;
  const zf = north ? zc - hw - BOARD_D : zc + hw + BOARD_D; // building front line
  const edge = north ? zc - hw + 0.6 : zc + hw - 0.6; // hitching-rail line, on the street
  const front = north ? 2 : 0;
  let x = x0;
  const plans = [...fixed];
  let used = plans.reduce((s, p) => s + p.w + 2, 0);
  while (used < x1 - x0 - 10) {
    const w = 8 + Math.floor(rand() * 4) * 2;
    if (used + w > x1 - x0) break;
    const storeys = rand() < 0.45 ? 2 : 1;
    plans.push({ w, t: "store", sign: K.nextFiller(), storeys });
    used += w + 2;
  }
  const fillers = plans.slice(fixed.length);
  let order: RowPlan[] = [];
  const every = Math.max(1, Math.round(fillers.length / (fixed.length + 1)));
  let fi = 0;
  for (let li = 0; li < fixed.length; li++) {
    for (let n = 0; n < every && fi < fillers.length; n++) order.push(fillers[fi++]!);
    order.push(fixed[li]!);
  }
  while (fi < fillers.length) order.push(fillers[fi++]!);
  const gaps = order.map((p) => (p.t === "saloon" ? 6 : rand() < 0.3 ? 6 : 0));
  const need = () => order.reduce((sum, p, i) => sum + p.w + gaps[i]!, 0) - 2;
  while (need() > x1 - x0) {
    const k = order.map((p) => fixed.includes(p)).lastIndexOf(false);
    if (k < 0) break;
    order = order.filter((_, i) => i !== k);
    gaps.splice(k, 1);
  }
  if (abut !== undefined && order.length) {
    const end =
      x0 + order.reduce((sum, p, i) => sum + p.w + gaps[i]!, 0) - gaps[gaps.length - 1]!;
    const slack = abut - end;
    const last = order[order.length - 1]!;
    if (slack > 0 && slack < 6 && last.t !== "saloon" && last.t !== "opera" && !last.walkIn)
      order[order.length - 1] = { ...last, w: last.w + slack };
  }
  for (let oi = 0; oi < order.length; oi++) {
    const p = order[oi]!;
    const gap = gaps[oi]!;
    const d = Math.min(p.d ?? 14 + Math.floor(rand() * 4) * 2, maxD);
    const bz0 = north ? zf - d : zf;
    const bz1 = north ? zf : zf + d;
    const mat = p.mat ?? K.pickMat();
    const porch = p.porch ?? (p.storeys > 1 && rand() < 0.5 ? 2 : rand() < 0.8 ? 1 : 0);
    // an occupied lot stays open ground (a fenced vacant lot, not a ghost building)
    if (!isFree(x - 0.4, Math.min(bz0, bz1) - 0.4, x + p.w + 0.4, Math.max(bz0, bz1) + 0.4)) {
      if (gap === 0 && rand() < 0.4) {
        const fz = north ? zf + 0.4 : zf - 0.4;
        K.picket(x + 0.4, fz, x + p.w - 0.4, fz);
      }
      x += p.w + gap;
      continue;
    }
    bld({
      t: p.t,
      x0: x,
      z0: bz0,
      x1: x + p.w,
      z1: bz1,
      front,
      storeys: p.storeys,
      mat,
      sign: p.sign,
      porch,
      ff: p.ff ?? (mat === "adobe" ? 0 : ((1 + Math.floor(rand() * 3)) as 1 | 2 | 3)),
      roof: mat === "adobe" ? "flat" : rand() < 0.7 ? "gable" : "shed",
      ...(p.walkIn ? { walkIn: true } : {}),
    });
    {
      const made = buildings[buildings.length - 1]!;
      if (!p.walkIn && p.t !== "saloon" && p.t !== "stable" && p.w >= 10 && rand() < 0.5) {
        const lw = Math.min(p.w - 2, 4 + Math.round(rand() * 4));
        const lat = 0.2 + rand() * 0.6;
        made.lean = lw;
        made.leanAt = lat;
        const cxw = made.x0 + (made.x1 - made.x0) * lat;
        if (north) markSolid(cxw - lw / 2, made.z0 - LEAN_D, cxw + lw / 2, made.z0, 3);
        else markSolid(cxw - lw / 2, made.z1, cxw + lw / 2, made.z1 + LEAN_D, 3);
      }
    }
    const deck = p.t === "saloon" ? DECK_Y : 0.2 + Math.round(rand() * 5) * 0.05;
    buildings[buildings.length - 1]!.deck = deck;
    setGround(x, north ? zf : zf - BOARD_D, x + p.w, north ? zf + BOARD_D : zf, WK.BOARD);
    for (let bx = Math.ceil(x); bx <= Math.floor(x + p.w); bx++)
      for (
        let bzz = Math.ceil(north ? zf : zf - BOARD_D);
        bzz <= Math.floor(north ? zf + BOARD_D : zf);
        bzz++
      )
        boardY.set(`${bx},${bzz}`, deck);
    const postZ = north ? zf + BOARD_D - 0.15 : zf - BOARD_D + 0.15;
    const clutterZ = north ? zf + BOARD_D - 1 : zf - BOARD_D + 1;
    if (porch > 0) {
      const n0 = Math.max(2, Math.round(p.w / 3.2));
      const n = n0 % 2 === 0 ? n0 + 1 : n0;
      for (let i = 0; i <= n; i++)
        posts.push({
          x: x + 0.15 + ((p.w - 0.3) * i) / n,
          z: postZ,
          r: 0.14,
        });
    }
    if (p.t === "saloon") {
      K.sal.stairs = {
        x0: x + p.w,
        x1: x + p.w + 2,
        zBottom: north ? zf - 14 : zf + 14,
        zTop: zf,
        zEdge: north ? zf + BOARD_D : zf - BOARD_D,
      };
      K.sal.lot = { x0: x, x1: x + p.w, zf, north };
    }
    if (p.t !== "smithy" && rand() < 0.75) {
      let hx = x + p.w * (0.3 + rand() * 0.4);
      const building = buildings[buildings.length - 1]!;
      const entrances =
        roomPlan(building, deck, 3.5)
          ?.doors.filter((dd) => dd.wall === "front")
          .map((dd) => {
            const a = toWorld(building, dd.a, 0)[0],
              b = toWorld(building, dd.b, 0)[0];
            return [Math.min(a, b) - 0.6, Math.max(a, b) + 0.6] as const;
          }) ?? [[x + p.w / 2 - 1.2, x + p.w / 2 + 1.2] as const];
      let spans: [number, number][] = [[x + 0.35, x + p.w - 0.35]];
      for (const [lo, hi] of entrances)
        spans = spans.flatMap(([a, b]) =>
          hi <= a || lo >= b
            ? [[a, b]]
            : [
                ...(lo > a ? [[a, lo] as [number, number]] : []),
                ...(hi < b ? [[hi, b] as [number, number]] : []),
              ],
        );
      const preferredLength = Math.min(4, p.w * 0.4);
      spans.sort((a, b) => {
        const aFits = a[1] - a[0] >= preferredLength,
          bFits = b[1] - b[0] >= preferredLength;
        if (aFits !== bFits) return aFits ? -1 : 1;
        if (!aFits) return b[1] - b[0] - (a[1] - a[0]);
        return Math.abs((a[0] + a[1]) / 2 - hx) - Math.abs((b[0] + b[1]) / 2 - hx);
      });
      const span = spans[0];
      const length = span ? Math.min(preferredLength, span[1] - span[0]) : 0;
      if (span) hx = Math.max(span[0] + length / 2, Math.min(span[1] - length / 2, hx));
      if (length > 1) prop("hitch", hx, edge, 0, length);
      if (rand() < 0.62) {
        const nh = rand() < 0.4 ? 2 : 1;
        for (let hi = 0; hi < nh; hi++) {
          const horseX = hx + (hi - (nh - 1) / 2) * 1.5 + (rand() - 0.5) * 0.3;
          const horseZ = edge + (north ? 1.5 : -1.5);
          const horseRot = north ? Math.PI + (rand() - 0.5) * 0.25 : (rand() - 0.5) * 0.25;
          const horseScale = 0.95 + rand() * 0.1,
            coat = Math.floor(rand() * 6);
          const body = K.footprint("horse", horseX, horseZ, horseRot, horseScale);
          if (length > 1 && body && !K.doorApproaches().some((l) => K.overlaps(body, l)))
            prop("horse", horseX, horseZ, horseRot, horseScale, coat);
        }
      }
      if (rand() < 0.45)
        solidProp("trough", hx + 3.2, edge - (north ? -0.1 : 0.1), 0, 2.4, 0.8, 0.8);
    }
    const taken: [number, number][] = [];
    const doorLX = p.t === "saloon" ? p.w / 2 - 4.5 : 0;
    const doorWX = x + p.w / 2 + (north ? doorLX : -doorLX);
    const place = (k: WPropKind, w: number, want: number, rot: number, s = 1) => {
      for (let t = 0; t < 6; t++) {
        const cx = t === 0 ? want : x + w / 2 + 0.3 + rand() * (p.w - w - 0.6);
        if (cx - w / 2 < x + 0.3 || cx + w / 2 > x + p.w - 0.3) continue;
        if (Math.abs(cx - doorWX) < w / 2 + 1.4 || Math.abs(cx - (x + p.w / 2)) < w / 2 + 1.2)
          continue;
        if (taken.some(([a, b]) => cx + w / 2 + 0.3 > a && cx - w / 2 - 0.3 < b)) continue;
        taken.push([cx - w / 2, cx + w / 2]);
        prop(k, cx, clutterZ, rot, s);
        return;
      }
    };
    const clutter = p.t !== "saloon";
    if (clutter && rand() < 0.55)
      place("bench", 1.8, x + p.w / 2 + (rand() - 0.5) * 3, north ? Math.PI : 0);
    if (clutter && rand() < 0.5) {
      const sc = 0.8 + rand() * 0.4;
      place(
        rand() < 0.5 ? "barrels" : "crates",
        1.6 * sc,
        x + 1 + rand() * (p.w - 2),
        rand() * 6.28,
        sc,
      );
    }
    if (clutter && rand() < 0.3) place("sacks", 1.2, x + 1 + rand() * (p.w - 2), rand() * 6.28);
    if (porch > 0)
      prop("lantern", x + p.w / 2, north ? zf + BOARD_D - 0.2 : zf - BOARD_D + 0.2, 0, 1, 2.9);
    const backOff = buildings[buildings.length - 1]!.lean ? 4.4 : 3;
    const back = north ? bz0 - backOff : bz1 + backOff;
    if (rand() < 0.35)
      solidProp(
        "outhouse",
        x + 2 + rand() * (p.w - 4),
        back - (north ? 4 : -4),
        0,
        1.6,
        1.6,
        2.4,
      );
    else if (rand() < 0.4) prop("woodpile", x + p.w / 2, back, rand() * 0.3, 1);
    else if (rand() < 0.3) prop("barrels", x + p.w / 2, back, rand(), 1);
    {
      const wz = north ? bz0 - 0.9 : bz1 + 0.9;
      const bxw = x + (north ? p.w - 1.1 : 1.1);
      prop("barrel", bxw, wz, rand() * 6.28, 1);
      if (p.t === "store" && rand() < 0.6) {
        const cxw = x + p.w * (0.35 + rand() * 0.3);
        const czw = north
          ? bz0 - (buildings[buildings.length - 1]!.lean ? 3.6 : 1.1)
          : bz1 + (buildings[buildings.length - 1]!.lean ? 3.6 : 1.1);
        prop(rand() < 0.5 ? "crates" : "crate", cxw, czw, rand() * 0.6, 0.9);
      }
    }
    if (gap > 0) {
      const ax0 = x + p.w;
      const ax1 = ax0 + gap;
      const za = north ? zf - 3 : zf + 3;
      const zb = north ? zf - d + 2 : zf + d - 2;
      const junk: WPropKind[] = ["brokencrate", "barrels", "crate", "brokenbarrel", "crates"];
      const nj = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < nj; k++) {
        const side = rand() < 0.5;
        const jx = side ? ax0 + 0.8 : ax1 - 0.8;
        const jz = za + (zb - za) * rand();
        const kind = junk[Math.floor(rand() * junk.length)]!;
        if (K.props.some((q) => Math.hypot(q.x - jx, q.z - jz) < 1.4)) continue;
        prop(kind, jx, jz, rand() * 6.28, 0.9 + rand() * 0.2);
      }
    }
    x += p.w + gap;
  }
}

/** a row of house lots along an east-west street edge. side -1: the lots lie at smaller z
 * than the edge (their houses face +z, toward the street); +1: beyond it, facing -z */
export function lotsX(
  K: Kit,
  x0: number,
  x1: number,
  edgeZ: number,
  side: -1 | 1,
  mats: WMat[],
) {
  const { rand, bld, setGround } = K;
  for (let x = x0; x < x1 - 11; ) {
    const lw = 12 + Math.floor(rand() * 4) * 1.5;
    const w = Math.round(6.5 + rand() * 3.5);
    const d = Math.round(6 + rand() * 3);
    const yard = 3.2 + rand() * 1.2;
    const hx0 = Math.round((x + (lw - w) / 2 + (rand() - 0.5) * 1.5) * 2) / 2;
    const zNear = edgeZ + side * yard;
    const zFar = zNear + side * d;
    const lotFar = zFar + side * 10;
    const zA = Math.min(edgeZ, lotFar);
    const zB = Math.max(edgeZ, lotFar);
    if (!K.isFree(x, zA, x + lw, zB)) {
      x += 4;
      continue;
    }
    const mat = mats[Math.floor(rand() * mats.length)]!;
    const small = rand() < 0.22;
    const porch = !small && rand() < 0.75 ? 1 : 0;
    const hb = bld({
      t: small ? "shack" : "house",
      x0: hx0,
      z0: Math.min(zNear, zFar),
      x1: hx0 + (small ? Math.max(5, w - 2) : w),
      z1: Math.max(zNear, zFar),
      front: side < 0 ? 2 : 0,
      storeys: 1,
      mat,
      sign: -1,
      porch,
      ff: 0,
      roof: rand() < 0.72 ? "gable" : "shed",
    });
    const cx = (hb.x0 + hb.x1) / 2;
    const fz = edgeZ + side * 0.4;
    if (rand() < 0.85) {
      K.picket(x + 0.3, fz, cx - 0.8, fz);
      K.picket(cx + 0.8, fz, x + lw - 0.3, fz);
    }
    setGround(cx - 0.6, Math.min(fz, zNear), cx + 0.6, Math.max(fz, zNear), WK.TRAIL);
    K.backYard(cx, zFar, 0, side, hb.x1 - hb.x0);
    x += lw + (rand() < 0.2 ? 3 : 0);
  }
}

/** a row of house lots along a north-south street edge. side -1: the lots lie at smaller x
 * than the edge (houses face +x, toward the street); +1: beyond it, facing -x */
export function lotsZ(
  K: Kit,
  z0: number,
  z1: number,
  edgeX: number,
  side: -1 | 1,
  mats: WMat[],
) {
  const { rand, bld, setGround } = K;
  for (let z = z0; z < z1 - 11; ) {
    const lw = 12 + Math.floor(rand() * 4) * 1.5;
    const w = Math.round(6.5 + rand() * 3.5);
    const d = Math.round(6 + rand() * 3);
    const yard = 3.2 + rand() * 1.2;
    const hz0 = Math.round((z + (lw - w) / 2 + (rand() - 0.5) * 1.5) * 2) / 2;
    const xNear = edgeX + side * yard;
    const xFar = xNear + side * d;
    const lotFar = xFar + side * 10;
    const xA = Math.min(edgeX, lotFar);
    const xB = Math.max(edgeX, lotFar);
    if (!K.isFree(xA, z, xB, z + lw)) {
      z += 4;
      continue;
    }
    const mat = mats[Math.floor(rand() * mats.length)]!;
    const small = rand() < 0.22;
    const porch = !small && rand() < 0.75 ? 1 : 0;
    const hb = bld({
      t: small ? "shack" : "house",
      x0: Math.min(xNear, xFar),
      z0: hz0,
      x1: Math.max(xNear, xFar),
      z1: hz0 + (small ? Math.max(5, w - 2) : w),
      front: side < 0 ? 1 : 3,
      storeys: 1,
      mat,
      sign: -1,
      porch,
      ff: 0,
      roof: rand() < 0.72 ? "gable" : "shed",
    });
    const cz = (hb.z0 + hb.z1) / 2;
    const fx = edgeX + side * 0.4;
    if (rand() < 0.85) {
      K.picket(fx, z + 0.3, fx, cz - 0.8);
      K.picket(fx, cz + 0.8, fx, z + lw - 0.3);
    }
    setGround(Math.min(fx, xNear), cz - 0.6, Math.max(fx, xNear), cz + 0.6, WK.TRAIL);
    K.backYard(xFar, cz, side, 0, hb.z1 - hb.z0);
    z += lw + (rand() < 0.2 ? 3 : 0);
  }
}

// =====================================================================================
// the districts
// =====================================================================================

/** the Mexican quarter: a plaza with a well and market stalls, the adobe mission church on
 * its east edge, and a ring of adobe houses whose ramadas shade the walk */
function plaza(K: Kit) {
  const { rand, bld, prop, solidProp, setGround } = K;
  const { x0, z0, x1, z1 } = PLAZA;
  setGround(x0, z0, x1, z1, WK.YARD);
  // the mission closes the plaza's east side: a long adobe church fronting west
  bld({
    t: "church",
    x0: -46,
    z0: 96,
    x1: -34,
    z1: 116,
    front: 3,
    storeys: 2,
    mat: "adobe",
    sign: -1,
    porch: 0,
    ff: 0,
    roof: "flat",
    tone: 0.35,
  });
  solidProp("well", (x0 + x1) / 2 - 4, (z0 + z1) / 2, 0.3, 2.6, 2.6, 1.2);
  const adobeAt = (ax0: number, az0: number, w: number, d: number, front: 0 | 1 | 2 | 3) =>
    bld({
      t: "adobe",
      x0: ax0,
      z0: az0,
      x1: ax0 + w,
      z1: az0 + d,
      front,
      storeys: 1,
      mat: "adobe",
      sign: -1,
      porch: rand() < 0.45 ? 1 : 0,
      ff: 0,
      roof: "flat",
    });
  // adobe houses ring the plaza's inside edges (the old towns' arcades faced the open
  // centre; the mission already closes the east side, and the corners stay open)
  for (let x = x0 + 4; x < x1 - 14; ) {
    const w = 8 + Math.round(rand() * 4);
    if (rand() > 0.22 && K.isFree(x, z0 + 1, x + w, z0 + 8)) adobeAt(x, z0 + 1, w, 7, 0);
    x += w + (rand() < 0.4 ? 3 : 0.5);
  }
  for (let x = x0 + 4; x < x1 - 14; ) {
    const w = 8 + Math.round(rand() * 4);
    if (rand() > 0.22 && K.isFree(x, z1 - 8, x + w, z1 - 1)) adobeAt(x, z1 - 8, w, 7, 2);
    x += w + (rand() < 0.4 ? 3 : 0.5);
  }
  for (let z = z0 + 6; z < z1 - 10; ) {
    const d = 8 + Math.round(rand() * 3);
    if (rand() > 0.25 && K.isFree(x0 + 1, z, x0 + 8, z + d)) adobeAt(x0 + 1, z, 7, d, 3);
    z += d + 1;
  }
  // life on the plaza: a cart, crates of produce, benches under the ramadas
  prop("cart", x0 + 8, (z0 + z1) / 2 + 8, 0.6, 1);
  prop("bench", (x0 + x1) / 2 - 8, (z0 + z1) / 2 - 3, 0, 1);
  prop("bench", (x0 + x1) / 2 + 2, (z0 + z1) / 2 + 5, Math.PI, 1);
  prop("crates", x1 - 9, z0 + 4, 0.4, 0.9);
  prop("sacks", x1 - 12, z0 + 5, 0.9, 1);
  prop("lantern", x0 + 4, (z0 + z1) / 2, 0, 1, 3);
  prop("lantern", x1 - 4, (z0 + z1) / 2, 0, 1, 3);
}

/** Chinatown: the laundry row - tight shacks and wash houses along the Laundry street,
 * lines of washing in every yard, paper lanterns at the doors */
function chinatown(K: Kit) {
  const { rand, bld, prop, setGround } = K;
  // ground: packed-dirt yards between the shacks
  setGround(CHINATOWN.x0, CHINATOWN.z0, CHINATOWN.x1, CHINATOWN.z1, WK.YARD);
  // wash houses along the block's inner lanes
  const shackRow = (x0: number, x1: number, edgeZ: number, side: -1 | 1) => {
    for (let x = x0; x < x1 - 6; ) {
      const w = 6 + Math.round(rand() * 3);
      const d = 5 + Math.round(rand() * 2);
      const zNear = edgeZ + side * (2 + rand() * 1.5);
      const zFar = zNear + side * d;
      if (
        K.isFree(
          x - 0.3,
          Math.min(zNear, zFar) - 0.3,
          x + w + 0.3,
          Math.max(zNear, zFar) + 0.3,
        )
      ) {
        bld({
          t: rand() < 0.35 ? "shack" : "house",
          x0: x,
          z0: Math.min(zNear, zFar),
          x1: x + w,
          z1: Math.max(zNear, zFar),
          front: side < 0 ? 2 : 0,
          storeys: 1,
          mat: rand() < 0.7 ? "board" : "clap",
          sign: rand() < 0.3 ? W["LAUNDRY"] : -1,
          porch: rand() < 0.5 ? 1 : 0,
          ff: 0,
          roof: rand() < 0.6 ? "gable" : "shed",
        });
        // washing out back between the buildings
        if (rand() < 0.8) {
          const clx = x + w / 2;
          const clz = zFar + side * (2.5 + rand() * 2);
          prop("clothesline", clx, clz, Math.PI / 2, 1, Math.floor(rand() * 4));
          for (const e of [-2.4, 2.4]) K.posts.push({ x: clx, z: clz + e, r: 0.1 });
        }
      }
      x += w + (rand() < 0.5 ? 1.5 : 0.4);
    }
  };
  shackRow(CHINATOWN.x0 + 2, CHINATOWN.x1 - 2, CHINATOWN.z0 + 2, 1);
  shackRow(CHINATOWN.x0 + 2, CHINATOWN.x1 - 2, CHINATOWN.z1 - 2, -1);
  shackRow(CHINATOWN.x0 + 2, CHINATOWN.x1 - 2, (CHINATOWN.z0 + CHINATOWN.z1) / 2, 1);
  // on the Laundry street's east edge, wash houses face west
  for (let z = CHINATOWN.z0 + 2; z < CHINATOWN.z1 - 8; ) {
    const w = 6 + Math.round(rand() * 3);
    if (K.isFree(CHINATOWN.x0 - 9, z, CHINATOWN.x0 - 1, z + w)) {
      bld({
        t: "shack",
        x0: CHINATOWN.x0 - 8,
        z0: z,
        x1: CHINATOWN.x0 - 1,
        z1: z + w,
        front: 3,
        storeys: 1,
        mat: "board",
        sign: rand() < 0.4 ? W["LAUNDRY"] : -1,
        porch: 0,
        ff: 0,
        roof: "shed",
      });
      if (rand() < 0.7)
        prop("clothesline", CHINATOWN.x0 + 2, z + w / 2, 0, 1, Math.floor(rand() * 4));
    }
    z += w + (rand() < 0.5 ? 2 : 0.5);
  }
  prop("lantern", CHINATOWN.x0 - 2, CHINATOWN.z0 + 4, 0, 1, 2.8);
  prop("lantern", CHINATOWN.x0 - 2, CHINATOWN.z1 - 4, 0, 1, 2.8);
  prop(
    "well",
    (CHINATOWN.x0 + CHINATOWN.x1) / 2 + 6,
    (CHINATOWN.z0 + CHINATOWN.z1) / 2,
    0.2,
    1,
  );
}

/** Boot Hill: the cemetery on the rise north-west of town, behind its own fence */
function bootHill(K: Kit) {
  const { rand, prop, setGround } = K;
  const { x0, z0, x1, z1 } = BOOTHILL;
  setGround(x0, z0, x1, z1, WK.YARD);
  // a sagging wire-and-post fence with the gate on the trail side (east)
  for (let x = x0 + 1; x <= x1 - 1; x += 2.5) {
    prop("fence", x, z0 + 1, 0, 2.5, 1);
    prop("fence", x, z1 - 1, 0, 2.5, 1);
  }
  for (let z = z0 + 1; z <= z1 - 1; z += 2.5) {
    prop("fence", x0 + 1, z, Math.PI / 2, 2.5, 1);
    if (z < -84 || z > -78) prop("fence", x1 - 1, z, Math.PI / 2, 2.5, 1); // the gate
  }
  // graves in ragged rows, markers leaning every way; the latest get a mound
  for (let n = 0; n < 44; n++) {
    const gx = x0 + 5 + (n % 6) * 7 + (rand() - 0.5) * 3;
    const gz = z0 + 7 + Math.floor(n / 6) * 7 + (rand() - 0.5) * 3;
    prop(rand() < 0.6 ? "cross" : "grave", gx, gz, (rand() - 0.5) * 0.5, 0.9 + rand() * 0.3);
  }
  prop("deadtree", x0 + 8, z0 + 12, 0.4, 1.3);
  prop("deadtree", x1 - 10, z1 - 12, 2.6, 1.1);
  // a bench at the gate, and the grave-digger's tools
  prop("bench", x1 - 5, -81, -Math.PI / 2, 1);
  prop("woodpile", x0 + 6, z1 - 8, 0.2, 0.9);
}

/** the freight yard: a second siding with parked boxcars, an engine shed, the stock-pen
 * loading chute, a coal dock and the section gang's bunkhouse */
function railYard(K: Kit) {
  const { rand, bld, prop, solidProp, setGround, markSolid } = K;
  // packed cinder ground through the whole district
  setGround(YARD.x0, YARD.z0, YARD.x1, YARD.z1, WK.YARD);
  // the siding: parked cars at x = 162 (their rails are drawn by mesh.ts)
  const cars: [WPropKind, number, number][] = [
    ["stockcar", 162, -98],
    ["stockcar", 162, -82],
    ["boxcar", 162, -20],
    ["boxcar", 162, -4],
    ["stockcar", 162, 14],
    ["flatcar", 162, 62],
  ];
  for (const [k, cx, cz] of cars) solidProp(k, cx, cz, 0, 3, 14, 4.2);
  // the engine shed beside the siding's south end
  bld({
    t: "barn",
    x0: 172,
    z0: 98,
    x1: 192,
    z1: 118,
    front: 3,
    storeys: 2,
    mat: "barn",
    sign: -1,
    porch: 0,
    ff: 0,
    roof: "gable",
  });
  // the coal dock: a low platform with a heap, beside the shed
  markSolid(196, 96, 212, 108, 1.1);
  prop("hay", 202, 100, 0.4, 1); // (the coal heap reads as a dark pile at distance)
  prop("hay", 206, 104, 1.9, 0.8);
  // the stock-pen loading chute: a fenced ramp up to the siding's car floor
  for (let z = 30; z <= 44; z += 2.5) prop("fence", 156, z, Math.PI / 2, 2.5, 1);
  markSolid(156, 29, 158, 45, 1.3); // (the chute's near rail)
  K.decks.push({ x0: 158, z0: 36, x1: 164, z1: 42, y: 1.15, axis: "x" }); // the ramp
  for (let z = 36; z <= 42; z += 2.5) prop("fence", 164, z, Math.PI / 2, 2.5, 1);
  // the stock pens at the yard's north end: two fenced corrals with a loading gate onto
  // the siding, a hay barn and a scale house — where the drives handed the herd over
  const pen = (px0: number, pz0: number, px1: number, pz1: number) => {
    for (let x = px0; x <= px1; x += 2.5) {
      prop("fence", x, pz0, 0, 2.5, 1.15);
      prop("fence", x, pz1, 0, 2.5, 1.15);
    }
    for (let z = pz0; z <= pz1; z += 2.5) {
      prop("fence", px0, z, Math.PI / 2, 2.5, 1.15);
      prop("fence", px1, z, Math.PI / 2, 2.5, 1.15);
    }
    markSolid(px0 - 1, pz0 - 1, px1 + 1, pz0 + 1, 1.4);
    markSolid(px0 - 1, pz1 - 1, px1 + 1, pz1 + 1, 1.4);
    markSolid(px0 - 1, pz0, px0 + 1, pz1, 1.4);
    markSolid(px1 - 1, pz0, px1 + 1, pz1, 1.4);
    prop("hitch", px0 + 2, pz0 + 2, 0, 1);
    solidProp("trough", (px0 + px1) / 2, (pz0 + pz1) / 2, 0.3, 3, 1, 0.8);
    prop("hay", px1 - 2.5, pz0 + 2.5, rand() * 3, 1.1);
  };
  pen(168, -112, 198, -84);
  pen(204, -110, 234, -86);
  // the herd holding over for the train: longhorns standing loose in the pens
  for (const [px0, pz0, px1, pz1] of [
    [170, -110, 196, -86],
    [206, -108, 232, -88],
  ] as const)
    for (let n = 0; n < 7; n++)
      prop(
        "steer",
        px0 + 2 + rand() * (px1 - px0 - 4),
        pz0 + 2 + rand() * (pz1 - pz0 - 4),
        rand() * 6.28,
        0.85 + rand() * 0.3,
      );
  // the hay barn between the pens
  if (K.isFree(200, -80, 216, -68))
    bld({
      t: "barn",
      x0: 202,
      z0: -80,
      x1: 216,
      z1: -70,
      front: 0,
      storeys: 1,
      mat: "barn",
      sign: -1,
      porch: 0,
      ff: 0,
      roof: "gable",
    });
  if (K.isFree(166, -80, 178, -68))
    bld({
      t: "shed",
      x0: 168,
      z0: -78,
      x1: 176,
      z1: -70,
      front: 0,
      storeys: 1,
      mat: "board",
      sign: W["EXPRESS"],
      porch: 0,
      ff: 0,
      roof: "shed",
    });
  prop("hay", 216, -78, 0.5, 1.2);
  prop("cart", 238, -80, -0.7, 1);
  prop("lantern", 199, -83.4, 0, 1, 3);
  // the cattle-drive camp that always waited at the pens: a fire, bedrolls, a wagon
  prop("campfire", 240, -100, 0, 1);
  solidProp("covered", 240, -70, -0.9, 2.2, 5.2, 2.6);
  prop("woodpile", 244, -96, 0.8, 1);
  // section-gang bunkhouse and tools north of the yard
  bld({
    t: "house",
    x0: 196,
    z0: -52,
    x1: 210,
    z1: -40,
    front: 0,
    storeys: 1,
    mat: "board",
    sign: -1,
    porch: 1,
    ff: 0,
    roof: "gable",
  });
  prop("cart", 216, -46, 0.4, 1);
  prop("woodpile", 218, -52, 0.2, 1.2);
  prop("barrels", 190, -58, 0.1, 1);
  solidProp("trough", 214, -60, 0, 3, 1, 0.8);
  // the pump house and a spare watertank at the yard's south edge
  bld({
    t: "shed",
    x0: 218,
    z0: 18,
    x1: 230,
    z1: 30,
    front: 0,
    storeys: 1,
    mat: "board",
    sign: -1,
    porch: 0,
    ff: 0,
    roof: "shed",
  });
  solidProp("tank", 240, 30, 0, 5, 5, 1.1);
  // a second loading dock with freight waiting on it
  markSolid(196, 60, 214, 72, 1.05);
  prop("crates", 200, 64, 0.3, 1);
  prop("crates", 206, 66, 1.1, 0.9);
  prop("sacks", 204, 70, 0.5, 1);
  prop("barrels", 210, 62, 0.2, 1);
  prop("lantern", 205, 59.6, 0, 1, 3);
  // the machine shop and tie piles at the yard's far south-east corner
  if (K.isFree(232, 76, 250, 96))
    bld({
      t: "barn",
      x0: 234,
      z0: 78,
      x1: 248,
      z1: 94,
      front: 3,
      storeys: 1,
      mat: "barn",
      sign: -1,
      porch: 0,
      ff: 0,
      roof: "shed",
    });
  solidProp("woodpile", 240, 102, 0.15, 8, 1.6, 1.4);
  solidProp("woodpile", 244, 110, -0.1, 7, 1.6, 1.3);
  prop("cart", 228, 100, 0.9, 1);
  prop("barrels", 226, 108, 0.2, 1);
  prop("lantern", 233, 84, 0, 1, 3);
  // the water crane and standpipe where the siding ends by the engine shed
  solidProp("tank", 236, 46, 0, 4, 4, 1);
  prop("pole", 168, 96, 0, 1);
}

/** the mining district: a stamp mill below the tipple, shacks and a powder house on the
 * terraced benches, ore carts on their little track */
function mining(K: Kit) {
  const { rand, bld, prop, solidProp } = K;
  // the stamp mill: a tall board shed on the lowest bench
  bld({
    t: "shed",
    x0: 60,
    z0: -152,
    x1: 74,
    z1: -138,
    front: 3,
    storeys: 2,
    mat: "board",
    sign: W["MINE CO."],
    porch: 0,
    ff: 0,
    roof: "shed",
  });
  prop("woodpile", 52, -146, 0.1, 1.3);
  prop("orecart", 58, -136, 0.2, 1);
  prop("orecart", 84, -150, -0.4, 1);
  // miners' shacks on the benches along the switchback (the trail threads them)
  const shackAt = (sx: number, sz: number, front: 0 | 1 | 2 | 3) => {
    if (!K.isFree(sx - 1, sz - 1, sx + 7, sz + 6)) return;
    bld({
      t: "shack",
      x0: sx,
      z0: sz,
      x1: sx + 6,
      z1: sz + 5,
      front,
      storeys: 1,
      mat: rand() < 0.6 ? "board" : "log",
      sign: -1,
      porch: rand() < 0.4 ? 1 : 0,
      ff: 0,
      roof: "shed",
    });
  };
  shackAt(44, -140, 1);
  shackAt(56, -162, 2);
  shackAt(88, -166, 3);
  shackAt(114, -148, 0);
  shackAt(124, -172, 0);
  // the powder house: stone, far enough from everything, marked KEEP OUT
  bld({
    t: "shed",
    x0: 8,
    z0: -178,
    x1: 14,
    z1: -172,
    front: 2,
    storeys: 1,
    mat: "stone",
    sign: W["KEEP OUT"],
    porch: 0,
    ff: 0,
    roof: "flat",
  });
  // the blacksmith's branch shop on the bench (the mine always had one)
  bld({
    t: "smithy",
    x0: 30,
    z0: -140,
    x1: 38,
    z1: -134,
    front: 0,
    storeys: 1,
    mat: "board",
    sign: -1,
    porch: 0,
    ff: 0,
    roof: "shed",
  });
  prop("anvil", 33.4, -133.4, 0.3, 1);
  prop("lantern", 66, -134, 0, 1, 3);
  prop("barrels", 20, -150, 0.4, 1);
  // the Number Two shaft, east toward the rail line: a small hoist house, its waste-rock
  // dumps and the hand tram that joined it to the yard
  if (K.isFree(146, -172, 166, -156))
    bld({
      t: "shed",
      x0: 148,
      z0: -170,
      x1: 162,
      z1: -158,
      front: 3,
      storeys: 1,
      mat: "board",
      sign: -1,
      porch: 0,
      ff: 0,
      roof: "shed",
    });
  if (K.isFree(170, -190, 188, -176))
    bld({
      t: "shack",
      x0: 172,
      z0: -188,
      x1: 180,
      z1: -180,
      front: 0,
      storeys: 1,
      mat: "log",
      sign: -1,
      porch: 0,
      ff: 0,
      roof: "shed",
    });
  // waste-rock dumps: heaps of broken stone (solid boulders) spilling down the flat
  for (const [dx, dz, s] of [
    [176, -150, 2.2], [186, -160, 2.6], [168, -142, 1.9], [192, -146, 2.4],
    [158, -136, 1.8], [196, -172, 2.0], [148, -186, 2.3], [182, -196, 1.7],
  ] as const)
    if (K.isFree(dx - 3, dz - 3, dx + 3, dz + 3))
      solidProp("boulder", dx, dz, rand() * 6.28, 4, 4, 2.4, 1.8 + rand() * 0.8);
  prop("orecart", 155, -152, -0.35, 1);
  prop("orecart", 146, -144, -0.35, 1);
  prop("woodpile", 170, -166, 0.2, 1.2);
  prop("barrels", 144, -164, 0.5, 1);
}

/** the tent city on the south bank: settlers and railroad crews camped past the bridge */
function tentCity(K: Kit) {
  const { rand, bld, prop, solidProp, setGround } = K;
  const { x0, z0, x1, z1 } = TENTS;
  setGround(x0, z0, x1, z1, WK.YARD);
  // ragged rows of canvas either side of the trail (it runs x=54 south, jogs to x=60)
  for (let z = z0 + 2; z < z1 - 4; z += 8) {
    for (const [x, front] of [
      [x0 + 2, 1],
      [x0 + 16, 1],
      [x1 - 22, 3],
      [x1 - 8, 3],
    ] as const) {
      if (rand() < 0.18) continue;
      const w = 4 + Math.round(rand());
      const d = 5 + Math.round(rand());
      if (!K.isFree(x - 1, z - 1, x + w + 1, z + d + 1)) continue;
      bld({
        t: "tent",
        x0: x,
        z0: z,
        x1: x + w,
        z1: z + d,
        front,
        storeys: 1,
        mat: "board",
        sign: -1,
        porch: 0,
        ff: 0,
        roof: "gable",
      });
    }
  }
  prop("campfire", (x0 + x1) / 2 + 4, z0 + 12, 0, 1);
  prop("bench", (x0 + x1) / 2 + 2, z0 + 12, Math.PI / 2, 1);
  prop("crates", (x0 + x1) / 2 + 8, z0 + 10, 0.5, 1);
  prop("barrels", x0 + 4, z1 - 10, 0.2, 1);
  prop("woodpile", x1 - 6, z0 + 8, 0.1, 1);
  solidProp("wagon", x1 - 14, z1 - 8, 2.8, 2.2, 5.2, 2.6);
  prop("clothesline", x0 + 8, (z0 + z1) / 2, 0.4, 1, 1);
}

/** the levee: wood stacks, barrels and carts along the waterfront lane, plus the ferry
 * landing clutter at the wagon bridge */
function riverside(K: Kit) {
  const { rand, prop, solidProp, setGround } = K;
  for (let x = -264; x < -50; x += 13) {
    const z = riverZ(x) - riverW(x) / 2 - 12 - rand() * 3;
    if (z > 150) continue;
    const pick = rand();
    if (pick < 0.4) prop("woodpile", x, z, rand() * 0.4, 0.9 + rand() * 0.4);
    else if (pick < 0.7) prop("barrels", x, z, rand() * 6.28, 1);
    else if (pick < 0.85) prop("cart", x, z, rand() * 6.28, 1);
    else solidProp("crates", x, z, rand() * 0.4, 1.6, 1.6, 1.4);
  }
  prop("crates", -64, 174, 0.4, 1);
  prop("woodpile", -66, 170, 0.2, 1);
  // the west ford: a second crossing where the river shallows under the ranch, with a
  // shanty camp on the south bank (the sheepherders and the odd claim-jumper lived out here)
  if (K.isFree(-258, 186, -196, 226)) {
    setGround(-256, 184, -198, 224, WK.YARD);
    for (const [sx, sz, front] of [
      [-252, 192, 1], [-240, 190, 0], [-228, 194, 1], [-214, 190, 0], [-246, 206, 2], [-220, 208, 3],
    ] as const) {
      if (rand() < 0.15) continue;
      K.bld({
        t: rand() < 0.5 ? "tent" : "shack",
        x0: sx,
        z0: sz,
        x1: sx + 6,
        z1: sz + 5,
        front,
        storeys: 1,
        mat: rand() < 0.5 ? "board" : "log",
        sign: -1,
        porch: 0,
        ff: 0,
        roof: "shed",
      });
    }
    prop("campfire", -234, 202, 0, 1);
    prop("bench", -236, 204, -0.4, 1);
    prop("woodpile", -230, 206, 0.7, 1.1);
    prop("barrels", -244, 200, 0.2, 1);
    solidProp("cart", -208, 200, 0.9, 1.6, 3.4, 1.6);
    prop("clothesline", -222, 216, 0.3, 1, 1);
    prop("cross", -256, 216, 0.2, 1);
  }
  // the freight wagon campground on the south bank, west of the tent city: rigs circled
  // for the night, a cook fire, a picket line — the teamsters' side of the river
  const cx = -34, cz = 218;
  if (K.isFree(cx - 34, cz - 26, cx + 34, cz + 26)) {
    setGround(cx - 34, cz - 26, cx + 34, cz + 26, WK.YARD);
    const ring: [number, number, number][] = [
      [-18, -12, 0.9], [0, -18, 0.15], [18, -10, -0.7], [16, 8, -2.4], [-4, 16, 3.1], [-20, 8, 2.2],
    ];
    for (const [dx, dz, rot] of ring)
      solidProp(rand() < 0.7 ? "covered" : "wagon", cx + dx, cz + dz, rot, 2.2, 5.2, 2.6);
    prop("campfire", cx, cz, 0, 1);
    prop("bench", cx - 3, cz + 1, 0.8, 1);
    prop("woodpile", cx + 4, cz - 3, 0.5, 1.1);
    for (let i = 0; i < 4; i++) prop("horse", cx - 10 + i * 2.4, cz + 13, 0.3, 1);
    prop("hitch", cx - 9, cz + 12, 0, 1);
    prop("barrels", cx + 10, cz + 12, 0.4, 1);
    prop("clothesline", cx + 14, cz + 4, -0.5, 1, 1);
  }
}

/** the south-bank edge east of the bridge: the river bends, and the ground between it and
 * the tent city got the woodcutters' camps — the firewood that fed the town's stoves */
function southBank(K: Kit) {
  const { rand, prop, solidProp, setGround, markSolid } = K;
  // cordwood stacks and a saw pit along the bank east of Laundry Street
  for (let n = 0; n < 26; n++) {
    const x = 100 + rand() * 150;
    const z = 168 + rand() * 66;
    if (!K.isFree(x - 2, z - 2, x + 2, z + 2)) continue;
    const r = rand();
    if (r < 0.5) solidProp("woodpile", x, z, rand() * 6.28, 2.2, 1.1, 1.2);
    else if (r < 0.7) prop("woodpile", x, z, rand() * 6.28, 1 + rand() * 0.4);
    else if (r < 0.85) prop("deadtree", x, z, rand() * 6.28, 0.9);
    else solidProp("boulder", x, z, rand() * 6.28, 2, 2, 1.4, 1.2);
  }
  // a woodcutter's shack and his corral
  if (K.isFree(122, 196, 140, 214)) {
    setGround(120, 194, 142, 216, WK.YARD);
    K.bld({
      t: "shack",
      x0: 126,
      z0: 198,
      x1: 132,
      z1: 204,
      front: 0,
      storeys: 1,
      mat: "log",
      sign: -1,
      porch: 0,
      ff: 0,
      roof: "shed",
    });
    for (let x = 122; x <= 140; x += 2.5) {
      prop("fence", x, 208, 0, 2.5, 1);
      prop("fence", x, 214, 0, 2.5, 1);
    }
    for (let z = 208; z <= 214; z += 2.5) {
      prop("fence", 122, z, Math.PI / 2, 2.5, 1);
      prop("fence", 140, z, Math.PI / 2, 2.5, 1);
    }
    markSolid(121, 207, 141, 209, 1.3);
    markSolid(121, 213, 141, 215, 1.3);
    markSolid(121, 207, 123, 215, 1.3);
    markSolid(139, 207, 141, 215, 1.3);
    prop("cart", 136, 200, -0.5, 1);
    prop("woodpile", 124, 202, 0.3, 1.2);
  }
}

/** the two bridges over the dry riverbed: the wagon bridge on the south trail and the
 * plank bridge where Laundry Row runs out to the tent city */
function bridges(K: Kit) {
  const { prop, posts } = K;
  // decks (layout's section 9 gives them ramps and real terrain)
  K.decks.push({ x0: -62, z0: 136, x1: -52, z1: 172, y: 0.5, axis: "z" });
  K.decks.push({ x0: 48, z0: 174, x1: 60, z1: 206, y: 0.5, axis: "z" });
  // side rails: thin posts a walker brushes against
  for (const [xa, xb, z0, z1] of [
    [-61.4, -52.6, 138, 170],
    [48.6, 59.4, 176, 204],
  ] as const) {
    for (const x of [xa, xb])
      for (let z = z0 + 1; z <= z1 - 1; z += 0.4)
        posts.push({ x, z, r: 0.07, shot: true, h: 1.4 });
    for (const z of [z0 + 0.6, z1 - 0.6])
      for (const x of [xa, xb]) prop("fence", x, z, Math.PI / 2, 1.4, 1);
  }
  prop("crossbuck", -64, 134, 0, 1);
  prop("crossbuck", 62, 172, 0, 1);
}

/** a lumber yard and a brickyard/ice house in the back blocks: the working yards every
 * boomtown had behind the pretty streets — stacks, a shed, a fenced yard, a wagon */
function workYards(K: Kit) {
  const { rand, bld, prop, solidProp, setGround, markSolid } = K;
  // the lumber yard in the north-west blocks (off Second Street's west end)
  if (K.isFree(-166, -116, -120, -78)) {
    setGround(-166, -116, -120, -78, WK.YARD);
    bld({
      t: "shed",
      x0: -142,
      z0: -112,
      x1: -130,
      z1: -100,
      front: 2,
      storeys: 1,
      mat: "board",
      sign: -1,
      porch: 0,
      ff: 0,
      roof: "shed",
    });
    // stickered stacks of boards (long, low, solid)
    for (const [sx, sz, w] of [
      [-162, -96, 14],
      [-146, -96, 12],
      [-160, -84, 16],
      [-128, -84, 10],
    ] as const)
      solidProp("woodpile", sx, sz, 0.1, w, 1.6, 1.2);
    prop("cart", -122, -92, -0.4, 1);
    for (let x = -166; x <= -120; x += 2.5) {
      prop("fence", x, -116, 0, 2.5, 1);
      prop("fence", x, -78, 0, 2.5, 1);
    }
    for (let z = -116; z <= -78; z += 2.5) {
      prop("fence", -166, z, Math.PI / 2, 2.5, 1);
      prop("fence", -120, z, Math.PI / 2, 2.5, 1);
    }
    markSolid(-166, -117, -120, -115, 1.3);
    markSolid(-166, -79, -120, -77, 1.3);
    markSolid(-167, -116, -165, -78, 1.3);
    markSolid(-121, -116, -119, -78, 1.3);
  }
  // the brickyard and ice house north-east (between North Street and the mine flat)
  if (K.isFree(20, -118, 78, -84)) {
    setGround(20, -118, 78, -84, WK.YARD);
    bld({
      t: "shed",
      x0: 30,
      z0: -112,
      x1: 46,
      z1: -100,
      front: 2,
      storeys: 1,
      mat: "brick",
      sign: -1,
      porch: 0,
      ff: 0,
      roof: "flat",
    });
    bld({
      t: "shed",
      x0: 56,
      z0: -110,
      x1: 70,
      z1: -98,
      front: 3,
      storeys: 1,
      mat: "board",
      sign: -1,
      porch: 0,
      ff: 0,
      roof: "gable",
    });
    for (const [sx, sz] of [
      [26, -92],
      [34, -90],
      [50, -92],
      [66, -88],
    ] as const)
      solidProp("crates", sx, sz, rand() * 0.5, 2.2, 2.2, 1.4);
    solidProp("wagon", 50, -116, 0.3, 2.2, 5.2, 2.6);
    prop("woodpile", 76, -102, 0.2, 1.2);
    for (let x = 20; x <= 78; x += 2.5) {
      prop("fence", x, -118, 0, 2.5, 1);
      prop("fence", x, -84, 0, 2.5, 1);
    }
    markSolid(20, -119, 78, -117, 1.3);
    markSolid(20, -85, 78, -83, 1.3);
  }
}

/** parked wagons, carts, troughs and freight at every street's edge — the way Vice's
 * kerbside cars give its lanes cover, Dry Gulch's streets carry parked rigs and troughs.
 * Kept outside the rider lanes (|lat| ~1.6-2.6) and clear of junction approaches. */
function streetCover(K: Kit) {
  const { rand, solidProp } = K;
  const kinds: WPropKind[] = ["wagon", "covered", "cart", "trough", "crates", "hay", "trough"];
  // each kind parked parallel to the kerb: wagons/carts run long on their z, the trough on x
  const drop = (x: number, z: number, horiz: boolean) => {
    const k = kinds[Math.floor(rand() * kinds.length)]!;
    const j = (rand() - 0.5) * 0.4;
    if (k === "trough") solidProp(k, x, z, (horiz ? 0 : Math.PI / 2) + j, 3, 1, 0.8);
    else if (k === "hay" || k === "crates")
      solidProp(k, x, z, j * 3, k === "hay" ? 2.6 : 1.8, k === "hay" ? 2.6 : 1.8, 1.5);
    else
      solidProp(k, x, z, (horiz ? Math.PI / 2 : 0) + j, k === "cart" ? 1.6 : 2.2, k === "cart" ? 3.4 : 5.2, k === "cart" ? 1.6 : 2.6);
  };
  const off = (hw: number) => hw - 0.9 - rand() * 0.4;
  for (const s of EW_ST) {
    for (let x = s.x0 + 14; x < s.x1 - 14; x += 15 + rand() * 6) {
      if (rand() < 0.3) continue;
      const side = rand() < 0.5 ? -1 : 1;
      drop(x, s.z + side * off(s.hw), true);
      if (rand() < 0.3) drop(x + 4, s.z - side * off(s.hw), true);
    }
  }
  for (const s of NS_ST) {
    for (let z = s.z0 + 14; z < s.z1 - 14; z += 15 + rand() * 6) {
      if (rand() < 0.3) continue;
      const side = rand() < 0.5 ? -1 : 1;
      drop(s.x + side * off(s.hw), z, false);
      if (rand() < 0.3) drop(s.x - side * off(s.hw), z + 4, false);
    }
  }
}

/** vacant lots and yards deep in the blocks: a shed, a corral, a garden or a woodpile so
 * no block interior is bare (called last, only onto genuinely open ground) */
function blockFill(K: Kit) {
  const { rand, prop, solidProp, setGround } = K;
  for (let n = 0; n < 380; n++) {
    const x = -228 + rand() * 372;
    const z = -186 + rand() * 320;
    if (!K.isFree(x - 2.5, z - 2.5, x + 2.5, z + 2.5)) continue;
    const r = rand();
    if (r < 0.3) prop("woodpile", x, z, rand() * 6.28, 0.9 + rand() * 0.4);
    else if (r < 0.55) prop("garden", x, z, rand() * 6.28, 1);
    else if (r < 0.7) {
      if (K.isFree(x - 4, z - 4, x + 4, z + 4)) {
        setGround(x - 3, z - 3, x + 3, z + 3, WK.YARD);
        for (let f = -3; f <= 3; f += 2) {
          prop("fence", x + f, z - 3, 0, 2, 0.8);
          prop("fence", x + f, z + 3, 0, 2, 0.8);
          prop("fence", x - 3, z + f, Math.PI / 2, 2, 0.8);
          prop("fence", x + 3, z + f, Math.PI / 2, 2, 0.8);
        }
      }
    } else if (r < 0.85) prop("cart", x, z, rand() * 6.28, 1);
    else solidProp(rand() < 0.5 ? "crates" : "barrels", x, z, rand() * 6.28, 1.5, 1.5, 1.3);
  }
}

/** lamps on the new business streets and the long cross streets */
function streetDressing(K: Kit) {
  const { prop } = K;
  for (const z of [-64, 78]) {
    for (let x = -160; x < 130; x += 44) {
      prop("streetlamp", x, z - 6 + 0.4, 0, 1);
      prop("streetlamp", x + 22, z + 6 - 0.4, Math.PI, 1);
    }
  }
  for (const x of [-186, -108, 54]) {
    for (let z = -50; z < 130; z += 56)
      prop("streetlamp", x - 5 + 0.4, z, Math.PI / 2, 1);
  }
}

/** warehouse fronts down a north-south street (the wagon yards behind them) */
function townRowZ(K: Kit, edgeX: number, z0: number, z1: number) {
  const { rand, bld, prop } = K;
  for (let z = z0; z < z1 - 10; ) {
    const w = 12 + Math.floor(rand() * 3) * 2;
    const d = 10 + Math.round(rand() * 4);
    const xFar = edgeX - 2 - d;
    if (!K.isFree(xFar - 0.5, z - 0.5, edgeX - 2 + 0.5, z + w + 0.5)) {
      z += 4;
      continue;
    }
    const wh = rand() < 0.55;
    bld({
      t: wh ? "shed" : "store",
      x0: xFar,
      z0: z,
      x1: edgeX - 2,
      z1: z + w,
      front: 1,
      storeys: 1,
      mat: wh ? "barn" : K.pickMat(),
      sign: wh ? W["WAREHOUSE"] : K.nextFiller(),
      porch: 0,
      ff: wh ? 0 : 1,
      roof: wh ? "shed" : "gable",
    });
    if (rand() < 0.7) prop(rand() < 0.5 ? "crates" : "sacks", edgeX - 1, z + w / 2, rand() * 0.6, 0.9);
    z += w + (rand() < 0.3 ? 4 : 0.5);
  }
}

export function buildTown(K: Kit) {
  // ---- business rows on the parallel streets ----
  // North Street (z = -64): commercial fronts both sides; a boarding house mid-block
  townRow(K, false, -64, 6, -170, -36, [
    { w: 16, t: "hotel", sign: W["HOTEL"], storeys: 2, mat: "clap", porch: 2, ff: 1, d: 16 },
  ]);
  townRow(K, false, -64, 6, -32, 112, []);
  townRow(K, true, -64, 6, -170, -36, [
    { w: 14, t: "store", sign: W["FEED & SEED"], storeys: 1, mat: "board", porch: 1 },
  ]);
  townRow(K, true, -64, 6, -32, 112, [
    { w: 12, t: "store", sign: W["HARNESS"], storeys: 1, porch: 1 },
  ]);
  // South Street (z = 78): business fronts; adobe creeps in west of the plaza block
  townRow(K, true, 78, 6, -170, -112, []);
  townRow(K, true, 78, 6, -30, 48, [
    { w: 14, t: "store", sign: W["EATS"], storeys: 1, porch: 1 },
  ]);
  townRow(K, false, 78, 6, -170, -112, [
    { w: 12, t: "adobe", sign: W["EATS"], storeys: 1, mat: "adobe", porch: 0, ff: 0 },
  ], undefined, 12);
  townRow(K, false, 78, 6, -30, 112, []);
  // Second Street (z = -124): the north residential street, and the schoolhouse
  lotsX(K, -190, -36, -119, 1, ["clap", "clap", "board", "log"]);
  lotsX(K, -190, -36, -129, -1, ["clap", "board"]);
  lotsX(K, -12, 108, -119, 1, ["board", "clap"]);
  lotsX(K, -12, 108, -129, -1, ["clap", "board", "log"]);
  K.bld({
    t: "house",
    x0: -172,
    z0: -116,
    x1: -158,
    z1: -104,
    front: 0,
    storeys: 1,
    mat: "white",
    sign: W["SCHOOL"],
    porch: 1,
    ff: 0,
    roof: "gable",
    tone: 0.6,
  });
  // Front Street (z = 138): houses and riverside sheds on the north side
  lotsX(K, -34, 134, 133, -1, ["board", "clap"]);
  // the cross streets: house lots down both sides
  lotsZ(K, -56, 128, -191, -1, ["clap", "board"]); // Hill lane, west side
  lotsZ(K, -56, 128, -181, 1, ["clap", "board", "log"]); // Hill lane, east side
  lotsZ(K, -148, -76, -113, -1, ["clap", "board"]); // West st, north-west
  lotsZ(K, -148, -76, -103, 1, ["board", "clap"]);
  lotsZ(K, 12, 70, -113, -1, ["adobe", "clap", "board"]);
  lotsZ(K, 12, 70, -103, 1, ["adobe", "board", "clap"]);
  lotsZ(K, -110, -20, -27, -1, ["clap", "board"]); // Center st, west side north
  lotsZ(K, 16, 70, -27, -1, ["clap", "board"]);
  lotsZ(K, -110, -20, -9, 1, ["board", "clap"]); // Center st, east side
  lotsZ(K, 16, 70, -9, 1, ["board", "clap"]);
  lotsZ(K, -110, -20, 49, 1, ["board", "clap", "log"]); // Laundry st, east side north
  lotsZ(K, -180, -80, 113, 1, ["clap", "board"]); // Station rd, east side north
  // Station road's west side: warehouses and the wagon yard
  townRowZ(K, 113, -56, 66);
  // ---- the districts ----
  plaza(K);
  chinatown(K);
  bootHill(K);
  railYard(K);
  mining(K);
  tentCity(K);
  riverside(K);
  southBank(K);
  bridges(K);
  workYards(K);
  streetCover(K);
  streetDressing(K);
  blockFill(K);
}
