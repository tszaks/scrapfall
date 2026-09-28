// Walk-in interiors for Dry Gulch's landmark buildings: the saloon, the sheriff's office and
// jail, the bank, the general store and the livery stable. A plan is pure data in the
// building's local frame (x across the front, -W/2..W/2; z back from the front wall, 0..-D;
// the front faces +z), derived from the building alone, so the layout (collision, floor
// heights, lamps) and the mesh (walls, furniture) always agree on where everything stands.
import type { WBld } from "./layout";

export type Rect = { x0: number; z0: number; x1: number; z1: number };
/** a doorway in one of the four walls: x-range for front/back, z-range for the sides */
export type Door = {
  wall: "front" | "back";
  a: number;
  b: number;
  h: number;
  kind: "plain" | "batwing" | "barn";
};

export type RoomItem =
  | { k: "bar"; r: Rect } // the bar counter
  | { k: "backbar"; r: Rect } // shelves of bottles and a mirror behind the bar
  | { k: "table"; x: number; z: number; chairs: number; cards?: boolean }
  | { k: "piano"; x: number; z: number }
  | { k: "stair"; x0: number; x1: number; zLow: number; zHigh: number; y: number }
  | { k: "landing"; r: Rect; y: number }
  | { k: "cells"; r: Rect; n: number } // jail cells along the back: bars on the room side
  | { k: "desk"; x: number; z: number; rot: number }
  | { k: "stove"; x: number; z: number }
  | { k: "rack"; x: number; z: number; rot: number } // gun rack on a wall
  | { k: "board"; x: number; z: number; rot: number } // wanted posters on a wall
  | { k: "counter"; r: Rect; top?: "scale" | "till" }
  | { k: "cage"; r: Rect } // the teller cage on the bank counter
  | { k: "vault"; x: number; z: number; w: number }
  | { k: "shelves"; r: Rect; face: 1 | -1 } // goods on shelves; face = the side it opens to (x)
  | { k: "goods"; x: number; z: number; kind: "barrel" | "sacks" | "crates" }
  | { k: "stall"; r: Rect; open: 1 | -1; horse: boolean } // a horse stall opening to +x or -x
  | { k: "bench"; x: number; z: number; rot: number }
  | { k: "lamp"; x: number; y: number; z: number; hang: boolean };

export type RoomPlan = {
  W: number;
  D: number;
  /** the floor, raised to the boardwalk (m) */
  floor: number;
  /** ceiling height */
  ceil: number;
  doors: Door[];
  /** a door in the upper front wall (the saloon's, onto its balcony) */
  upperDoor?: { a: number; b: number; y: number };
  items: RoomItem[];
  /** the wall finish: papered, bare boards, plaster, stone */
  finish: "paper" | "boards" | "plaster" | "stone";
  wallColor: string;
};

/** which buildings you can walk into */
export function isWalkIn(b: WBld) {
  return b.walkIn === true;
}

export function frameWD(b: WBld) {
  const W = b.front === 0 || b.front === 2 ? b.x1 - b.x0 : b.z1 - b.z0;
  const D = b.front === 0 || b.front === 2 ? b.z1 - b.z0 : b.x1 - b.x0;
  return { W, D };
}

/** local (x, z) to world, matching mesh.ts frameOf / the prop stamp rotation */
export function toWorld(b: WBld, lx: number, lz: number): [number, number] {
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  if (b.front === 2) return [cx + lx, b.z1 + lz];
  if (b.front === 0) return [cx - lx, b.z0 - lz];
  if (b.front === 1) return [b.x1 + lz, cz - lx];
  return [b.x0 - lz, cz + lx];
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** the saloon's interior stair rises along its left wall to a landing in the front corner */
export const SALOON_STAIR = { w: 1.5, run: 6.2 };
/** the saloon's balcony runs across the left part of its front (over the stair's landing); the
 * batwing doors open under the plain porch roof on the right */
export function saloonBalcony(W: number) {
  return { a: -W / 2, b: -W / 2 + Math.round(W * 0.6) };
}
export function saloonDoor(W: number) {
  return { a: W / 2 - 5.4, b: W / 2 - 3.6 };
}

export function roomPlan(b: WBld, deck: number, storey: number): RoomPlan | null {
  if (!isWalkIn(b)) return null;
  const { W, D } = frameWD(b);
  const x0 = -W / 2;
  const x1 = W / 2;
  const z0 = -D;
  const R = rng(b.seed ^ 0x51f3);
  const items: RoomItem[] = [];
  const ceil = storey;
  const base = { W, D, floor: deck, ceil };
  if (b.t === "saloon") {
    const up = storey; // the landing and the balcony stand at the upper floor
    const sx1 = x0 + 0.15 + SALOON_STAIR.w;
    const landing: Rect = { x0: x0 + 0.15, z0: -2.3, x1: x0 + 2.6, z1: -0.15 };
    items.push({
      k: "stair",
      x0: x0 + 0.15,
      x1: sx1,
      zLow: landing.z0 - SALOON_STAIR.run,
      zHigh: landing.z0,
      y: up,
    });
    items.push({ k: "landing", r: landing, y: up });
    // the bar down the right wall (clear of the doors), the backbar behind it
    items.push({ k: "bar", r: { x0: x1 - 3.0, z0: z0 + 3, x1: x1 - 2.3, z1: -6.2 } });
    items.push({ k: "backbar", r: { x0: x1 - 0.75, z0: z0 + 2.6, x1: x1 - 0.15, z1: -6.6 } });
    // card tables across the floor (clear of the stair, the bar and the doorway)
    const tx = [x0 + 5.2, x0 + 9.2, x0 + 13.2];
    const tz = [-5.4, -10, -14.6];
    for (const x of tx)
      for (const z of tz) {
        if (R() < 0.12) continue;
        items.push({
          k: "table",
          x: x + (R() - 0.5) * 0.8,
          z: z + (R() - 0.5) * 0.8,
          chairs: 3 + Math.floor(R() * 2),
          cards: R() < 0.5,
        });
      }
    items.push({ k: "piano", x: x0 + 3.4, z: z0 + 0.75 });
    for (const x of tx) items.push({ k: "lamp", x, y: ceil - 0.5, z: -9.5, hang: true });
    items.push({ k: "lamp", x: x1 - 0.5, y: 2.4, z: -9, hang: false });
    items.push({ k: "lamp", x: x1 - 0.5, y: 2.4, z: z0 + 5, hang: false });
    const dr = saloonDoor(W);
    return {
      ...base,
      doors: [
        { wall: "front", a: dr.a, b: dr.b, h: 2.5, kind: "batwing" },
        { wall: "back", a: x0 + 0.78, b: x0 + 1.72, h: 2.1, kind: "plain" },
      ],
      upperDoor: { a: x0 + 0.95, b: x0 + 1.95, y: up },
      items,
      finish: "paper",
      wallColor: "#6a2a24",
    };
  }
  if (b.t === "sheriff") {
    const cellD = 3.2;
    items.push({
      k: "cells",
      r: { x0: x0 + 0.15, z0: z0 + 0.15, x1: x1 - 0.15, z1: z0 + cellD },
      n: W >= 15 ? 3 : 2,
    });
    items.push({ k: "desk", x: x0 + 3.2, z: -4.2, rot: 0 });
    items.push({ k: "stove", x: x1 - 2.4, z: z0 + cellD + 2.2 });
    items.push({ k: "rack", x: x0 + 0.2, z: -2.8, rot: Math.PI / 2 });
    items.push({ k: "board", x: x1 - 0.2, z: -3.4, rot: -Math.PI / 2 });
    items.push({ k: "bench", x: x1 - 1.0, z: -1.2, rot: 0 });
    items.push({ k: "lamp", x: 0, y: ceil - 0.5, z: -3.5, hang: true });
    items.push({ k: "lamp", x: 0, y: ceil - 0.5, z: z0 + cellD + 1.2, hang: true });
    return {
      ...base,
      doors: [{ wall: "front", a: -0.6, b: 0.6, h: 2.3, kind: "plain" }],
      items,
      finish: "stone",
      wallColor: "#b8ac94",
    };
  }
  if (b.t === "bank") {
    const cz = -6.5;
    items.push({ k: "counter", r: { x0: x0 + 0.15, z0: cz - 0.7, x1: x1 - 0.15, z1: cz } });
    items.push({ k: "cage", r: { x0: x0 + 0.15, z0: cz - 0.7, x1: x1 - 0.15, z1: cz } });
    items.push({ k: "vault", x: 0, z: z0 + 0.15, w: 2.4 });
    items.push({ k: "desk", x: x0 + 3, z: z0 + 3.2, rot: Math.PI });
    items.push({ k: "desk", x: x1 - 3, z: z0 + 3.2, rot: Math.PI });
    items.push({ k: "bench", x: x0 + 0.7, z: -2.8, rot: Math.PI / 2 });
    items.push({ k: "lamp", x: -3, y: ceil - 0.5, z: -3.2, hang: true });
    items.push({ k: "lamp", x: 3, y: ceil - 0.5, z: -3.2, hang: true });
    items.push({ k: "lamp", x: 0, y: ceil - 0.5, z: z0 + 3.5, hang: true });
    return {
      ...base,
      doors: [{ wall: "front", a: -0.75, b: 0.75, h: 2.5, kind: "plain" }],
      items,
      finish: "plaster",
      wallColor: "#d8ccb0",
    };
  }
  if (b.t === "store") {
    // the general store: shelves up both sides, the counter on the right, the stove at the back
    items.push({
      k: "shelves",
      r: { x0: x0 + 0.15, z0: z0 + 1.6, x1: x0 + 0.7, z1: -1.4 },
      face: 1,
    });
    items.push({
      k: "shelves",
      r: { x0: x1 - 0.7, z0: z0 + 1.6, x1: x1 - 0.15, z1: -1.4 },
      face: -1,
    });
    items.push({ k: "counter", r: { x0: x1 - 2.4, z0: -9, x1: x1 - 1.7, z1: -2.6 }, top: "till" });
    items.push({
      k: "counter",
      r: { x0: x0 + 1.7, z0: -7.5, x1: x0 + 2.4, z1: -3.2 },
      top: "scale",
    });
    items.push({ k: "stove", x: 0, z: z0 + 3 });
    items.push({ k: "goods", x: -0.6, z: -3.4, kind: "barrel" });
    items.push({ k: "goods", x: 0.7, z: -3.9, kind: "barrel" });
    items.push({ k: "goods", x: -0.2, z: -6.2, kind: "sacks" });
    items.push({ k: "goods", x: 0.3, z: z0 + 1.2, kind: "crates" });
    items.push({ k: "bench", x: -1.6, z: z0 + 3, rot: Math.PI / 2 });
    items.push({ k: "lamp", x: 0, y: ceil - 0.5, z: -3, hang: true });
    items.push({ k: "lamp", x: 0, y: ceil - 0.5, z: z0 + 5, hang: true });
    return {
      ...base,
      doors: [
        { wall: "front", a: -0.7, b: 0.7, h: 2.4, kind: "plain" },
        { wall: "back", a: x0 + 0.78, b: x0 + 1.72, h: 2.1, kind: "plain" },
      ],
      items,
      finish: "boards",
      wallColor: "#a08868",
    };
  }
  if (b.t === "stable") {
    // a centre aisle front to back, stalls either side
    const aisle = 1.9;
    const sw = 3;
    for (const side of [-1, 1] as const) {
      const xa = side < 0 ? x0 + 0.15 : aisle;
      const xb = side < 0 ? -aisle : x1 - 0.15;
      for (let z = -2.4; z - sw > z0 + 1.2; z -= sw)
        items.push({
          k: "stall",
          r: { x0: xa, z0: z - sw, x1: xb, z1: z },
          open: side < 0 ? 1 : -1,
          horse: R() < 0.55,
        });
    }
    items.push({ k: "goods", x: x0 + 1.4, z: -1.1, kind: "sacks" });
    for (let z = -4; z > z0 + 2; z -= 6)
      items.push({ k: "lamp", x: 0, y: ceil - 0.4, z, hang: true });
    return {
      ...base,
      doors: [
        { wall: "front", a: -1.8, b: 1.8, h: 3.3, kind: "barn" },
        { wall: "back", a: -1.4, b: 1.4, h: 3.0, kind: "barn" },
      ],
      items,
      finish: "boards",
      wallColor: "#8a6a4c",
    };
  }
  return null;
}

export type Circle = { x: number; z: number; r: number; shot: boolean };
/** a rectangle's outline as a ring of circles (bodies can't cross it) */
function ring(r: Rect, rad: number, shot: boolean, out: Circle[]) {
  const step = rad * 1.6;
  const edge = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = 0; i <= n; i++)
      out.push({ x: ax + ((bx - ax) * i) / n, z: az + ((bz - az) * i) / n, r: rad, shot });
  };
  const x0 = r.x0 + rad;
  const x1 = r.x1 - rad;
  const z0 = r.z0 + rad;
  const z1 = r.z1 - rad;
  edge(x0, z0, x1, z0);
  edge(x1, z0, x1, z1);
  edge(x1, z1, x0, z1);
  edge(x0, z1, x0, z0);
}
/** what in a room stops a body (and, for the solid pieces, a shot): local-frame circles */
export function roomCollision(it: RoomItem): Circle[] {
  const out: Circle[] = [];
  switch (it.k) {
    case "bar":
    case "backbar":
    case "counter":
    case "shelves":
      ring(it.r, 0.2, true, out);
      break;
    case "piano":
      ring({ x0: it.x - 0.8, z0: it.z - 0.35, x1: it.x + 0.8, z1: it.z + 0.35 }, 0.18, true, out);
      break;
    case "table":
      out.push({ x: it.x, z: it.z, r: 0.62, shot: false });
      break;
    case "desk":
      ring({ x0: it.x - 0.8, z0: it.z - 0.4, x1: it.x + 0.8, z1: it.z + 0.4 }, 0.2, true, out);
      break;
    case "stove":
      out.push({ x: it.x, z: it.z, r: 0.45, shot: true });
      break;
    case "bench":
      out.push({ x: it.x, z: it.z, r: 0.35, shot: false });
      break;
    case "vault":
      break; // flush with the back wall
    case "goods":
      out.push({ x: it.x, z: it.z, r: it.kind === "crates" ? 0.7 : 0.55, shot: true });
      break;
    case "cells": {
      // the bars along the room side of the cells: bodies stop, shots pass between the bars
      const z = it.r.z1;
      for (let x = it.r.x0; x <= it.r.x1; x += 0.2) out.push({ x, z, r: 0.07, shot: false });
      break;
    }
    case "stall": {
      // the stall's three board sides (the open side faces the aisle)
      const r = it.r;
      for (let x = r.x0; x <= r.x1; x += 0.25) {
        out.push({ x, z: r.z0, r: 0.08, shot: false });
      }
      const back = it.open > 0 ? r.x0 : r.x1;
      for (let z = r.z0; z <= r.z1; z += 0.25) out.push({ x: back, z, r: 0.08, shot: false });
      if (it.horse) out.push({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, r: 0.7, shot: true });
      break;
    }
    default:
      break;
  }
  return out;
}
