import { setStaticShotExemption } from "../staticCollision";
import { spiralContains, spiralRegion, spiralRise, spiralPoint, TAU } from "./spiral";
// The building-access runtime: one installed set of access buildings for the current map.
//
// Zones. Everyone is in exactly one zone:
//   street (key 0)     - the normal map
//   roof b (key 1 + b) - the walkable roof of access building b
//   interior (key -1)  - a lobby, an elevator car or a stairwell. Players only: enemies never
//                        enter, so a player inside is safe (and counts as "riding" for the
//                        zone rules, like the alpine chairlift).
// An enemy's zone is a function of where it stands: a roof sits inside its building's
// footprint, which is solid from the street, so any point on a roof can only be reached from
// the roof. That lets the existing enemy code run unchanged: `blocked()` answers with the
// roof's parapet and props for points on a roof (level.ts blockHook), and `groundY()` with the
// roof height (terrain.ts groundHook), so enemies, their shots, pickups and markers on a roof
// all stand at the right height.
//
// Players carry an explicit state (zone, floor, stair lap) because inside a building the same
// (x, z) can be the lobby, the car at any height or the vestibule on the roof.
import { blockHook, clearLine, type Block, type NavGrid, NAV_SCALE, BLOCK, HALF } from "../level";
import { groundHook, groundY } from "../terrain";
import { BODY_R, CAR_D, CAR_W, rideY, toLocal, toWorld, type AccessBuilding } from "./layout";
import type { LRect, Portal } from "./types";
import { registerPingTarget } from "../ping";
import { furnishingBlocked } from "./roomFurnishings";
import { dressResortRooms } from "./resortRooms";

let unping: (() => void) | null = null;

// ---- elevator car state (host-authoritative in co-op) ----
export const IDLE = 0;
export const CLOSING = 1;
export const MOVING = 2;
export const OPENING = 3;
export const DOOR_T = 1.1; // seconds for the doors to slide
const HOLD_T = 2.0; // a rider who boarded here waits this long with the doors open, then goes
const DWELL_T = 3.5; // an empty car stays open at least this long before answering a call
// the call spot: standing at the call button beside the landing doors (build.ts
// landingDoorFrame: the plate at a 1.15..1.33 on the core front), not anywhere near the doors
const CALL_A = 1.24;
const CALL_HALF = 0.6;
const CALL_DEPTH = 1.2;

export type Car = {
  phase: number;
  /** the floor the car is at (0 lobby, 1 roof), or heading to while moving */
  level: 0 | 1;
  from: 0 | 1;
  t: number;
  hold: number;
  /** host only: per floor, may a player at the call button call the car? A call is served
   * once: whoever is still standing there after the car has come must step away to call again */
  armed: [boolean, boolean];
  /** host only: did the car arrive with riders aboard? They are not carried back on their
   * own: the car waits for a button press */
  carried: boolean;
  /** events for the renderer / audio: bumped on each departure and arrival */
  departs: number;
  arrivals: number;
};

export type PlayerAcc = {
  /** 0 street, 1 interior, 2 roof */
  zone: 0 | 1 | 2;
  b: number;
  /** elevator: the floor you're on when not in the car (0 lobby, 1 roof vestibule) */
  level: 0 | 1;
  inCar: boolean;
  /** stairs: storey index and region (0 landing, 1 flight up, 2 half landing, 3 flight down) */
  lap: number;
  region: number;
  /** ladders: how far along the climb (metres up, then forward onto the deck) */
  climb: number;
  /** floor height under the player */
  y: number;
  /** car button presses so far (E in the car); sent to the host, which compares counts */
  press: number;
};

export type Remote = { x: number; z: number; az?: number; hp: number; last: number };

type AccWorld = {
  list: AccessBuilding[];
  cells: number;
  half: number;
  /** per 2 m cell: index + 1 of the roof whose walkable rect overlaps it */
  roofGrid: Int16Array;
  cars: Car[];
  /** portal door openness per building: [street, roof] 0..1 */
  doors: [number, number][];
};

let W: AccWorld | null = null;
export const player: PlayerAcc = {
  zone: 0,
  b: -1,
  level: 0,
  inCar: false,
  lap: 0,
  region: 0,
  climb: 0,
  y: 0,
  press: 0,
};

export function accessList(): AccessBuilding[] {
  return W ? W.list : [];
}
export function accessActive() {
  return W !== null && W.list.length > 0;
}
export function carOf(b: number): Car | undefined {
  return W?.cars[b];
}
export function portalDoor(b: number, which: 0 | 1) {
  return W?.doors[b]?.[which] ?? 0;
}

function newCar(): Car {
  return {
    phase: IDLE,
    level: 0,
    from: 0,
    t: 0,
    hold: 0,
    armed: [true, true],
    carried: false,
    departs: 0,
    arrivals: 0,
  };
}

/** A way up a map built by hand (Dry Gulch's saloon and belfry stairs): pingable and on the
 * minimap, but not run by this system. */
export type AccessMarker = {
  x: number;
  z: number;
  y: number;
  kind: AccessBuilding["kind"];
  label: string;
};
let markers: AccessMarker[] = [];
export function accessMarkers() {
  return markers;
}

/** every access door and marker can be pinged (co-op: "up here", "elevator") */
function registerPings(targets: { x: number; y: number; z: number; label: string }[]) {
  unping?.();
  unping = null;
  if (!targets.length) return;
  unping = registerPingTarget((o, dir, maxDist) => {
    let best: {
      x: number;
      y: number;
      z: number;
      kind: "elev";
      label: string;
      dist: number;
    } | null = null;
    for (const t of targets) {
      const vx = t.x - o.x;
      const vy = t.y - o.y;
      const vz = t.z - o.z;
      const along = vx * dir.x + vy * dir.y + vz * dir.z;
      if (along < 0.5 || along > maxDist) continue;
      const perp = Math.hypot(vx - dir.x * along, vy - dir.y * along, vz - dir.z * along);
      if (perp > Math.max(1.3, along * Math.tan((4 * Math.PI) / 180))) continue;
      if (!best || along < best.dist)
        best = { x: t.x, y: t.y, z: t.z, kind: "elev", label: t.label, dist: along };
    }
    return best;
  });
}

const LABEL: Record<AccessBuilding["kind"], [string, string]> = {
  elevator: ["ELEVATOR", "ELEVATOR · ROOF"],
  stairs: ["STAIRS", "STAIRS · ROOF"],
  ladder: ["LADDER", "LADDER · DECK"],
};

/** Install the access buildings for a new map (null / [] uninstalls every hook). */
export function installAccess(list: AccessBuilding[] | null, extra: AccessMarker[] = []) {
  dressResortRooms(list);
  setStaticShotExemption(
    list?.length
      ? (x, y, z) => {
          for (let i = 0; i < list.length; i++) {
            const b = list[i]!;
            if (!b.spec.punch) continue;
            for (const side of [0, 1] as const) {
              const q = b.portals[side],
                floor = side ? b.top : b.groundY;
              if (!q.open && (W?.doors[i]?.[side] ?? 0) < 0.55) continue;
              if (
                y < floor + 0.03 ||
                y > floor + (side ? 2.2 : (b.spec.doorH ?? (b.elev ? 2.9 : 2.45)))
              )
                continue;
              const [a, d] = toLocal(b, x, z),
                off = portalOffset(q, a, d);
              if (Math.abs(off.lat) < q.half - 0.02 && Math.abs(off.out) < 0.65) return true;
            }
          }
          return false;
        }
      : null,
  );
  resetPlayer();
  markers = extra;
  registerPings([
    ...(list ?? []).flatMap((b) =>
      b.portals.map((q, i) => {
        const [x, z] = toWorld(b, q.a + q.na * 0.3, q.d + q.nd * 0.3);
        return { x, y: (i ? b.top : b.groundY) + 1.3, z, label: LABEL[b.kind][i]! };
      }),
    ),
    ...extra.map((m) => ({ x: m.x, y: m.y + 1.3, z: m.z, label: m.label })),
  ]);
  if (!list || list.length === 0) {
    W = null;
    blockHook.fn = null;
    groundHook.fn = null;
    return;
  }
  const half = HALF;
  const cells = Math.round((half * 2) / BLOCK);
  const roofGrid = new Int16Array(cells * cells);
  list.forEach((b, k) => {
    const R = b.spec.roof;
    const i0 = Math.max(0, Math.floor((R.x0 + half) / BLOCK));
    const i1 = Math.min(cells - 1, Math.floor((R.x1 + half) / BLOCK));
    const j0 = Math.max(0, Math.floor((R.z0 + half) / BLOCK));
    const j1 = Math.min(cells - 1, Math.floor((R.z1 + half) / BLOCK));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) roofGrid[i * cells + j] = k + 1;
  });
  W = {
    list,
    cells,
    half,
    roofGrid,
    cars: list.map(newCar),
    doors: list.map(() => [0, 0]),
  };
  blockHook.fn = (x, z, r) => {
    const k = roofAt(x, z);
    return k < 0 ? undefined : roofBlocked(list[k]!, x, z, r);
  };
  groundHook.fn = (x, z) => {
    const k = roofAt(x, z);
    return k < 0 ? undefined : list[k]!.top;
  };
}

/** E in the car: press the other floor's button (the car goes once its doors are clear) */
export function pressCarButton() {
  if (!player.inCar) return false;
  player.press++;
  return true;
}

export function resetPlayer() {
  Object.assign(player, {
    zone: 0,
    b: -1,
    level: 0,
    inCar: false,
    lap: 0,
    region: 0,
    climb: 0,
    y: 0,
  });
}

/** index of the roof whose walkable rectangle contains (x, z), or -1 */
export function roofAt(x: number, z: number) {
  const w = W;
  if (!w) return -1;
  const i = Math.floor((x + w.half) / BLOCK);
  const j = Math.floor((z + w.half) / BLOCK);
  if (i < 0 || j < 0 || i >= w.cells || j >= w.cells) return -1;
  const k = w.roofGrid[i * w.cells + j]! - 1;
  if (k < 0) return -1;
  const R = w.list[k]!.spec.roof;
  return x >= R.x0 && x <= R.x1 && z >= R.z0 && z <= R.z1 ? k : -1;
}

/** zone key of a point for enemies / pickups: 0 street, 1 + b on roof b */
/** roof zones are keyed 100 + building (street zones belong to the map: 0, or the alpine
 * village / summit), inside a building is -1 */
export const ROOF_KEY = 100;
export const zoneAt = (x: number, z: number) => {
  const k = roofAt(x, z);
  return k < 0 ? 0 : ROOF_KEY + k;
};

function roofBlocked(b: AccessBuilding, x: number, z: number, r: number, fixtures = true) {
  const R = b.spec.roof;
  if (x < R.x0 + r || x > R.x1 - r || z < R.z0 + r || z > R.z1 - r) return true;
  for (const o of b.obstacles)
    if (x > o.x0 - r && x < o.x1 + r && z > o.z0 - r && z < o.z1 + r) return true;
  // (inlined toLocal + a looped furnishingBlocked: blocked() calls this for every body
  // query that lands on a roof cell — the tuple and .some closure were per-call garbage)
  const dx = x - b.ox;
  const dz = z - b.oz;
  const a = dx * b.tx + dz * b.tz;
  const d = dx * b.ix + dz * b.iz;
  if (!fixtures) return false;
  const y0 = b.top + 0.08,
    y1 = b.top + 1.8;
  for (const p of b.furnishings)
    if (
      p.level === 1 &&
      p.y1 > y0 &&
      p.y0 < y1 &&
      a > p.a0 - r &&
      a < p.a1 + r &&
      d > p.d0 - r &&
      d < p.d1 + r
    )
      return true;
  return false;
}

// ---------------------------------------------------------------- cars

export function carOpen(c: Car) {
  if (c.phase === IDLE) return 1;
  if (c.phase === CLOSING) return Math.max(0, 1 - c.t / DOOR_T);
  if (c.phase === OPENING) return Math.min(1, c.t / DOOR_T);
  return 0;
}
/** car floor height */
export function carY(b: AccessBuilding, c: Car) {
  const y0 = b.groundY;
  const y1 = b.top;
  if (c.phase !== MOVING) return c.level ? y1 : y0;
  return rideY(c.from ? y1 : y0, c.level ? y1 : y0, c.t, b.elev!.ride);
}
/** the floor number the indicator shows (1 .. floors) */
export function carFloor(b: AccessBuilding, c: Car) {
  const E = b.elev!;
  const k = (carY(b, c) - b.groundY) / (b.top - b.groundY);
  return Math.max(1, Math.min(E.floors, 1 + Math.floor(k * (E.floors - 1) + 0.5)));
}
const doorsPassable = (c: Car) => (c.phase === IDLE || c.phase === OPENING) && carOpen(c) > 0.7;

type Who = { a: number; d: number; code: number };

/**
 * Host: run every car. `people` are all live players as access zone codes plus positions
 * (the host's own player and the guests' last reported states).
 */
/** host: each player's last seen button-press count (a higher count = a new press) */
const pressSeen = new Map<string, number>();
export function stepCars(
  dt: number,
  people: { x: number; z: number; az: number; id?: string; press?: number }[],
  host: boolean,
) {
  const w = W;
  if (!w) return;
  // new button presses this frame, by the building the presser rides in
  const pressedIn = new Set<number>();
  for (const p of people) {
    if (p.id === undefined || p.press === undefined) continue;
    const seen = pressSeen.get(p.id);
    pressSeen.set(p.id, p.press);
    if (seen !== undefined && p.press > seen && p.az > 0 && azCode(p.az) === AZ_CAR)
      pressedIn.add(azBuilding(p.az));
  }
  w.list.forEach((b, k) => {
    const E = b.elev;
    if (!E) return;
    const c = w.cars[k]!;
    c.t += dt;
    if (!host) {
      // guests only advance the clock between snapshots; the host changes phases
      return;
    }
    const here: Who[] = [];
    for (const p of people) {
      if (p.az <= 0 || azBuilding(p.az) !== k) continue;
      let code = azCode(p.az);
      // a car that opens straight into a lookout room is called from the room floor
      if (code === AZ_ROOF && E.direct) code = AZ_UP;
      if (code < 2) continue;
      const [a, d] = toLocal(b, p.x, p.z);
      here.push({ a, d, code });
    }
    const inCar = here.filter((h) => h.code === AZ_CAR);
    const inDoor = here.some(
      (h) =>
        Math.abs(h.a) < CAR_W / 2 &&
        h.d > E.coreFront - 0.45 &&
        h.d < E.car.d0 + BODY_R + 0.05 &&
        (h.code === AZ_CAR || h.code === (c.level ? AZ_UP : AZ_DOWN)),
    );
    const atButton = (code: number) =>
      here.some(
        (h) =>
          h.code === code &&
          h.d > E.coreFront - CALL_DEPTH &&
          h.d < E.coreFront + 0.05 &&
          Math.abs(h.a - CALL_A) < CALL_HALF,
      );
    const callAt = [atButton(AZ_DOWN), atButton(AZ_UP)] as const;
    for (const f of [0, 1] as const) if (!callAt[f]) c.armed[f] = true; // stepped away: re-armed
    // standing at the button of the floor where the car is open: that call is served
    if (c.phase === IDLE && callAt[c.level]) c.armed[c.level] = false;
    const other = (1 - c.level) as 0 | 1;
    const called = callAt[other] && c.armed[other];
    if (c.phase === IDLE) {
      if (inCar.length > 0) {
        // a rider pressed the button: go. One who boarded here rides after a moment; riders
        // the car just brought stay until they press (never carried back on their own)
        c.hold += dt;
        if (!inDoor && (pressedIn.has(k) || (!c.carried && c.hold > HOLD_T))) start(c, CLOSING);
      } else {
        c.hold = 0;
        c.carried = false;
        // an empty car stays open a while (c.t counts from the doors opening), then answers
        if (called && c.t >= DWELL_T && !inDoor) start(c, CLOSING);
      }
    } else if (c.phase === CLOSING) {
      if (inDoor && c.t < DOOR_T * 0.9) {
        // the door sensor: someone stepped into the doorway, open up again
        const o = carOpen(c);
        start(c, OPENING);
        c.t = o * DOOR_T;
      } else if (c.t >= DOOR_T) {
        c.from = c.level;
        c.level = (1 - c.level) as 0 | 1;
        start(c, MOVING);
        c.departs++;
      }
    } else if (c.phase === MOVING) {
      if (c.t >= E.ride) {
        start(c, OPENING);
        c.arrivals++;
        c.carried = inCar.length > 0;
      }
    } else if (c.phase === OPENING) {
      if (c.t >= DOOR_T) {
        start(c, IDLE);
        c.hold = 0;
      }
    }
  });
}
function start(c: Car, phase: number) {
  c.phase = phase;
  c.t = 0;
}

/** snapshot field: 4 numbers per elevator (phase, level, from, t in centiseconds) */
export function encodeCars(): number[] | null {
  const w = W;
  if (!w || !w.list.some((b) => b.elev)) return null;
  const out: number[] = [];
  w.list.forEach((b, k) => {
    if (!b.elev) return;
    const c = w.cars[k]!;
    out.push(c.phase, c.level, c.from, Math.round(c.t * 100), c.departs & 1023, c.arrivals & 1023);
  });
  return out;
}
export function decodeCars(arr: number[]) {
  const w = W;
  if (!w) return;
  let o = 0;
  w.list.forEach((b, k) => {
    if (!b.elev || o + 5 >= arr.length) return;
    const c = w.cars[k]!;
    c.phase = arr[o]!;
    c.level = (arr[o + 1]! ? 1 : 0) as 0 | 1;
    c.from = (arr[o + 2]! ? 1 : 0) as 0 | 1;
    c.t = arr[o + 3]! / 100;
    c.departs = arr[o + 4]!;
    c.arrivals = arr[o + 5]!;
    o += 6;
  });
}

// ---------------------------------------------------------------- zone codes (net + AI)

// az = b * 8 + code; 0 = street
export const AZ_ROOF = 1;
export const AZ_DOWN = 2; // lobby / stairwell ground floor
export const AZ_UP = 3; // roof vestibule / stairwell above the ground floor
export const AZ_CAR = 4;
export const azBuilding = (az: number) => Math.floor(az / 8) - 1;
export const azCode = (az: number) => az % 8;
const mkAz = (b: number, code: number) => (b + 1) * 8 + code;

/** the local player's zone code for the network */
export function playerAz(): number {
  const p = player;
  if (p.zone === 0 || p.b < 0) return 0;
  if (p.zone === 2) return mkAz(p.b, AZ_ROOF);
  if (p.inCar) return mkAz(p.b, AZ_CAR);
  const b = W?.list[p.b];
  if (b?.ladder) return mkAz(p.b, p.level ? AZ_UP : AZ_DOWN);
  if (b?.stair) return mkAz(p.b, p.lap === 0 && p.region === 0 ? AZ_DOWN : AZ_UP);
  return mkAz(p.b, p.level ? AZ_UP : AZ_DOWN);
}
/** zone key (0 street, 1 + b roof, -1 inside) from a network zone code */
export function zoneKeyOfAz(az: number | undefined) {
  if (!az) return 0;
  const code = azCode(az);
  return code === AZ_ROOF ? ROOF_KEY + azBuilding(az) : -1;
}
export function playerZoneKey() {
  return player.zone === 0 ? 0 : player.zone === 2 ? ROOF_KEY + player.b : -1;
}

/** height a teammate's avatar stands at: riding teammates follow this client's car clock */
export function remoteFloorY(az: number | undefined, ay: number | undefined, fallback: number) {
  if (!az || !W) return fallback;
  const b = azBuilding(az);
  const code = azCode(az);
  const acc = W.list[b];
  if (acc && code === AZ_CAR && acc.elev) return carY(acc, W.cars[b]!);
  return ay ?? fallback;
}

// ---------------------------------------------------------------- the local player

const inRects = (rects: LRect[], a: number, d: number, r: number) => {
  for (const q of rects)
    if (a >= q.a0 + r && a <= q.a1 - r && d >= q.d0 + r && d <= q.d1 - r) return true;
  return false;
};

// Walkable space is a union of rectangles; the body's centre has to stay inside one of them
// shrunk by the body radius, so rectangles that join (a doorway and a room, a flight and a
// landing) overlap by more than a body width.
const JOIN = 1.0;

/** a doorway: from `out` metres outside the wall to `inn` metres past its inner face */
function portalRect(p: Portal, out = 1.45, inn = p.inn ?? JOIN): LRect {
  if (p.nd !== 0) {
    const s = p.nd; // -1: outside is -d
    const d0 = s < 0 ? p.d - out : p.d - p.wall - inn;
    const d1 = s < 0 ? p.d + p.wall + inn : p.d + out;
    return { a0: p.a - p.half, a1: p.a + p.half, d0, d1 };
  }
  const s = p.na;
  const a0 = s < 0 ? p.a - out : p.a - p.wall - inn;
  const a1 = s < 0 ? p.a + p.wall + inn : p.a + out;
  return { a0, a1, d0: p.d - p.half, d1: p.d + p.half };
}
/** how far (a, d) is outside a portal's wall face, and its offset along the doorway */
function portalOffset(p: Portal, a: number, d: number) {
  const out = (a - p.a) * p.na + (d - p.d) * p.nd;
  const lat = p.nd !== 0 ? a - p.a : d - p.d;
  return { out, lat };
}

function elevRects(b: AccessBuilding, st: PlayerAcc, c: Car, doors: [number, number]): LRect[] {
  const E = b.elev!;
  const out: LRect[] = [E.car];
  const L = st.inCar ? c.level : st.level;
  const open = doorsPassable(c) && c.level === L;
  const conn: LRect = { a0: -0.7, a1: 0.7, d0: E.coreFront - JOIN, d1: E.car.d0 + JOIN };
  if (open) out.push(conn);
  if (!st.inCar || open) {
    out.push(L === 0 ? E.lobby : E.vest);
    if (doors[L]! > 0.6) out.push(portalRect(b.portals[L]!));
  }
  return out;
}

function stairRegion(b: AccessBuilding, a: number, d: number) {
  const s = b.stair!;
  if (s.spiral) return spiralRegion(s.spiral, a, d);
  const v = d - s.v0;
  if (v < s.Ls) return 0;
  if (v > s.Ls + s.Lr) return 2;
  return a < 0 ? 1 : 3;
}
export function stairY(b: AccessBuilding, a: number, d: number, lap: number) {
  const s = b.stair!;
  const base = b.groundY + lap * s.h;
  if (s.spiral) return base + spiralRise(s.spiral, a, d) * s.h;
  const v = d - s.v0;
  if (v < s.Ls) return base;
  if (v > s.Ls + s.Lr) return base + s.h / 2;
  const k = (v - s.Ls) / s.Lr;
  return a < 0 ? base + (k * s.h) / 2 : base + s.h / 2 + ((1 - k) * s.h) / 2;
}
function stairRects(b: AccessBuilding, st: PlayerAcc, doors: [number, number]): LRect[] {
  const s = b.stair!;
  const W2 = s.W / 2;
  const g = 0.1;
  const ov = JOIN;
  const out: LRect[] = [];
  const S: LRect = { a0: -W2, a1: W2, d0: st.lap === 0 ? 0.3 : s.v0, d1: s.v0 + s.Ls };
  out.push(S);
  if (s.spiral) {
    if (st.lap === 0 && st.region === 0 && doors[0] > 0.6) out.push(portalRect(b.portals[0]));
    if (st.lap >= s.laps && st.region === 0 && doors[1] > 0.6) out.push(portalRect(b.portals[1]));
    return out;
  }
  out.push({ a0: -W2, a1: W2, d0: s.v0 + s.Ls + s.Lr, d1: s.v0 + s.Ls + s.Lr + s.Ln });
  const laneA: LRect = { a0: -W2, a1: -g, d0: s.v0 + s.Ls - ov, d1: s.v0 + s.Ls + s.Lr + ov };
  const laneB: LRect = { a0: g, a1: W2, d0: s.v0 + s.Ls - ov, d1: s.v0 + s.Ls + s.Lr + ov };
  // the flight down from the ground-floor landing and the flight up from the roof landing
  // don't exist; everywhere else both flights meet both landings
  const onS = st.region === 0;
  if (!(onS && st.lap >= s.laps)) out.push(laneA);
  if (!(onS && st.lap === 0)) out.push(laneB);
  if (st.lap === 0 && onS && doors[0] > 0.6) out.push(portalRect(b.portals[0]));
  if (st.lap >= s.laps && onS && doors[1] > 0.6) out.push(portalRect(b.portals[1]));
  return out;
}

function insideStair(
  b: AccessBuilding,
  st: PlayerAcc,
  rects: LRect[],
  a: number,
  d: number,
  r: number,
) {
  const s = b.stair;
  return s?.spiral
    ? spiralContains(s.spiral, a, d, r, rects, st.lap, s.laps, st.region)
    : inRects(rects, a, d, r);
}

/** interior collision for the local player, `undefined` outside (use the normal grid) */
export function playerBlocked(
  x: number,
  z: number,
  r: number,
  feet = player.y,
): boolean | undefined {
  const w = W;
  const p = player;
  if (!w) return undefined;
  if (p.zone !== 1) {
    // Punch-host facades and ladders need their narrow authored portal before the
    // interior transition threshold. Height prevents this opening on other storeys.
    for (const b of w.list)
      for (const side of [0, 1] as const) {
        if (Math.abs(feet - (side ? b.top : b.groundY)) > 0.3) continue;
        const [a, d] = toLocal(b, x, z),
          q = b.portals[side],
          offset = portalOffset(q, a, d);
        const half = b.ladder ? 0.5 : q.half - r - 0.02;
        if (Math.abs(offset.lat) < half && offset.out > -0.25 && offset.out < 1.25) return false;
      }
    // An enclosed lookout has a floor only inside its authored room. Open arches
    // must not let a walking player leave that floor and fall into the solid tower.
    const room=p.zone===2 ? w.list[p.b] : undefined;
    if(room?.room && roofBlocked(room,x,z,r))return true;
    return undefined;
  }
  const b = w.list[p.b]!;
  if (b.ladder) return true; // on a ladder the climb moves you (stepPlayer)
  const [a, d] = toLocal(b, x, z);
  const rects = b.elev
    ? elevRects(b, p, w.cars[p.b]!, w.doors[p.b]!)
    : stairRects(b, p, w.doors[p.b]!);
  return (
    !insideStair(b, p, rects, a, d, r) || furnishingBlocked(b, 0, a, d, r, feet + 0.08, feet + 1.8)
  );
}

const CLIMB = 2.4; // m/s up or down a ladder
const ladderLen = (L: NonNullable<AccessBuilding["ladder"]>) => L.rise + (L.land + 0.7 - L.base);

/**
 * After the local player moved: take doorways (street <-> interior <-> roof), follow the
 * stairs and the car, and return the floor height under the player. `pos` may be nudged
 * (into a departing car, or out of its closing doorway). `vx, vz` is this frame's intended
 * walk (doorways are only taken walking into them).
 */
export function stepPlayer(
  pos: { x: number; z: number },
  vx: number,
  vz: number,
  streetBlocked: (x: number, z: number, r: number) => boolean,
  dt = 1 / 60,
): number {
  const w = W;
  const p = player;
  if (!w) {
    p.zone = 0;
    p.y = groundY(pos.x, pos.z);
    return p.y;
  }
  if (p.zone === 0) {
    // walking into a street door?
    for (let k = 0; k < w.list.length; k++) {
      const b = w.list[k]!;
      if (Math.abs(pos.x - b.ox) > 3 || Math.abs(pos.z - b.oz) > 3) continue;
      const [a, d] = toLocal(b, pos.x, pos.z);
      const q = b.portals[0];
      const { out, lat } = portalOffset(q, a, d);
      const inward = -(vx * b.tx + vz * b.tz) * q.na - (vx * b.ix + vz * b.iz) * q.nd;
      const latOk = b.ladder ? Math.abs(lat) < 0.5 : Math.abs(lat) < q.half - BODY_R - 0.02;
      if (out > 0 && out < 0.68 && latOk && inward > 0.55) {
        Object.assign(p, { zone: 1, b: k, level: 0, inCar: false, lap: 0, region: 0, climb: 0 });
        w.doors[k]![0] = Math.max(w.doors[k]![0], 0.61);
        break;
      }
    }
    if (p.zone === 0) {
      p.b = -1;
      p.y = groundY(pos.x, pos.z);
      return p.y;
    }
  }
  if (p.zone === 2) {
    const b = w.list[p.b]!;
    if (roofAt(pos.x, pos.z) !== p.b) {
      // shouldn't happen (the parapet stops you); fall back to the street state
      p.zone = 0;
      p.b = -1;
      p.y = groundY(pos.x, pos.z);
      return p.y;
    }
    const [a, d] = toLocal(b, pos.x, pos.z);
    const q = b.portals[1];
    const { out, lat } = portalOffset(q, a, d);
    const inward = -(vx * b.tx + vz * b.tz) * q.na - (vx * b.ix + vz * b.iz) * q.nd;
    const latOk = b.ladder ? Math.abs(lat) < 0.5 : Math.abs(lat) < q.half - BODY_R - 0.02;
    if (out > 0 && out < 0.68 && latOk && inward > 0.55) {
      const s = b.stair;
      // (a ladder picks up where you stand: the forward part of the climb, heading down)
      const climb = b.ladder ? b.ladder.rise + (d - b.ladder.base) : 0;
      Object.assign(p, { zone: 1, level: 1, inCar: false, lap: s ? s.laps : 0, region: 0, climb });
      w.doors[p.b]![1] = Math.max(w.doors[p.b]![1], 0.61);
    } else {
      p.y = b.top;
      return p.y;
    }
  }
  // ---- interior ----
  const k = p.b;
  const b = w.list[k]!;
  if (b.ladder) {
    // hold forward (toward the wall / the deck) to climb, back to go down; the camera rides
    // the climb smoothly, then steps forward over the edge onto the deck
    const L = b.ladder;
    const push = vx * b.ix + vz * b.iz;
    const total = ladderLen(L);
    p.climb += push * (p.climb > L.rise ? 3.2 : CLIMB) * dt;
    if (p.climb <= 0 && push < -0.3) {
      [pos.x, pos.z] = toWorld(b, 0, L.base - 0.45);
      Object.assign(p, { zone: 0, b: -1, climb: 0 });
      p.y = groundY(pos.x, pos.z);
      return p.y;
    }
    p.climb = Math.max(0, p.climb);
    if (p.climb >= total) {
      [pos.x, pos.z] = toWorld(b, 0, L.land + 0.72);
      Object.assign(p, { zone: 2, climb: 0 });
      p.y = b.top;
      return p.y;
    }
    const dd = p.climb <= L.rise ? L.base : L.base + (p.climb - L.rise);
    [pos.x, pos.z] = toWorld(b, 0, dd);
    p.level = p.climb > L.rise * 0.5 ? 1 : 0;
    p.y = b.groundY + Math.min(p.climb, L.rise);
    return p.y;
  }
  let [a, d] = toLocal(b, pos.x, pos.z);
  {
    // safety net: if the body ever ends up outside the walkable space (a door shut on it, a
    // network correction), put it back at the nearest valid spot instead of freezing it
    const rects = b.elev ? elevRects(b, p, w.cars[k]!, w.doors[k]!) : stairRects(b, p, w.doors[k]!);
    if (!insideStair(b, p, rects, a, d, BODY_R)) {
      let best: [number, number] | null = null;
      let bd = Infinity;
      for (const q of rects) {
        const r = BODY_R + 0.01;
        if (q.a1 - q.a0 < 2 * r || q.d1 - q.d0 < 2 * r) continue;
        const ca = Math.max(q.a0 + r, Math.min(q.a1 - r, a));
        const cd = Math.max(q.d0 + r, Math.min(q.d1 - r, d));
        const dd = Math.hypot(ca - a, cd - d);
        if (dd < bd) {
          bd = dd;
          best = [ca, cd];
        }
      }
      if (b.stair?.spiral) {
        const sp = b.stair.spiral;
        for (let i = 0; i < 120; i++) {
          const [ca, cd] = spiralPoint(sp, (i * TAU) / 120, (sp.inner + sp.outer) / 2);
          if (!insideStair(b, p, rects, ca, cd, BODY_R)) continue;
          const dist = Math.hypot(ca - a, cd - d);
          if (dist < bd) {
            bd = dist;
            best = [ca, cd];
          }
        }
      }
      if (best) {
        [a, d] = best;
        [pos.x, pos.z] = toWorld(b, a, d);
      }
    }
  }
  if (b.elev) {
    const E = b.elev;
    const c = w.cars[k]!;
    const wasIn = p.inCar;
    p.inCar = d > E.coreFront + 0.05;
    if (p.inCar && !wasIn) p.level = c.level;
    if (p.inCar && (c.phase === CLOSING || c.phase === MOVING)) {
      // riding: keep the body inside the car
      const r = BODY_R + 0.01;
      a = Math.max(E.car.a0 + r, Math.min(E.car.a1 - r, a));
      d = Math.max(E.car.d0 + r, Math.min(E.car.d1 - r, d));
      [pos.x, pos.z] = toWorld(b, a, d);
    } else if (!p.inCar && c.phase !== IDLE && c.phase !== OPENING && d > E.coreFront - BODY_R) {
      d = E.coreFront - BODY_R - 0.01;
      [pos.x, pos.z] = toWorld(b, a, d);
    }
    if (p.inCar) p.level = c.level;
    // doorways out
    const q = b.portals[p.level];
    if (!p.inCar && portalOffset(q, a, d).out > 0.72) {
      if (p.level === 0 && !streetBlocked(pos.x, pos.z, BODY_R)) {
        Object.assign(p, { zone: 0, b: -1 });
        p.y = groundY(pos.x, pos.z);
        return p.y;
      }
      if (p.level === 1 && roofAt(pos.x, pos.z) === k && !roofBlocked(b, pos.x, pos.z, BODY_R)) {
        p.zone = 2;
        p.y = b.top;
        return p.y;
      }
    }
    p.y = p.inCar ? carY(b, c) : p.level ? b.top : b.groundY;
    return p.y;
  }
  // stairs
  const s = b.stair!;
  const reg = stairRegion(b, a, d);
  if (p.region === 3 && reg === 0) p.lap = Math.min(s.laps, p.lap + 1);
  else if (p.region === 0 && reg === 3) p.lap = Math.max(0, p.lap - 1);
  p.region = reg;
  p.level = p.lap >= s.laps ? 1 : 0;
  if (reg === 0) {
    if (
      p.lap === 0 &&
      portalOffset(b.portals[0], a, d).out > 0.72 &&
      !streetBlocked(pos.x, pos.z, BODY_R)
    ) {
      Object.assign(p, { zone: 0, b: -1 });
      p.y = groundY(pos.x, pos.z);
      return p.y;
    }
    if (
      p.lap >= s.laps &&
      portalOffset(b.portals[1], a, d).out > 0.72 &&
      roofAt(pos.x, pos.z) === k &&
      !roofBlocked(b, pos.x, pos.z, BODY_R)
    ) {
      p.zone = 2;
      p.y = b.top;
      return p.y;
    }
  }
  p.y = stairY(b, a, d, p.lap);
  return p.y;
}

/** animate the auto doors at every doorway (street and roof): open while anyone is close */
export function stepDoors(dt: number, people: { x: number; z: number; y: number }[]) {
  const w = W;
  if (!w) return;
  w.list.forEach((b, k) => {
    for (const which of [0, 1] as const) {
      const q = b.portals[which];
      const [px, pz] = toWorld(b, q.a, q.d);
      const py = which ? b.top : b.groundY;
      let near = false;
      for (const o of people) {
        if (Math.abs(o.y - py) > 2.5) continue;
        if (Math.hypot(o.x - px, o.z - pz) < 3.4) near = true;
      }
      if (q.open) {
        w.doors[k]![which] = 1;
        continue;
      }
      const cur = w.doors[k]![which]!;
      w.doors[k]![which] = near ? Math.min(1, cur + dt * 2.6) : Math.max(0, cur - dt * 1.6);
    }
  });
}

// ---------------------------------------------------------------- nav + spawning

/** open the nav cells on every roof (kept apart from the street by at least one solid cell) */
export function patchNav(nav: NavGrid) {
  const w = W;
  if (!w) return nav;
  const n = nav.n;
  const cs = BLOCK * NAV_SCALE;
  const origin = -w.half;
  const roofCell = new Int16Array(n * n);
  w.list.forEach((b, k) => {
    const R = b.spec.roof;
    const i0 = Math.max(0, Math.floor((R.x0 - origin) / cs));
    const i1 = Math.min(n - 1, Math.floor((R.x1 - origin) / cs));
    const j0 = Math.max(0, Math.floor((R.z0 - origin) / cs));
    const j1 = Math.min(n - 1, Math.floor((R.z1 - origin) / cs));
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const cx = origin + (i + 0.5) * cs;
        const cz = origin + (j + 0.5) * cs;
        // walkable at the cell centre with a body's clearance
        if (roofBlocked(b, cx, cz, 0.6)) continue;
        roofCell[i * n + j] = k + 1;
      }
  });
  const g = nav.g;
  const open: number[] = [];
  for (let c = 0; c < n * n; c++) {
    const k = roofCell[c]!;
    if (!k) continue;
    const i = Math.floor(c / n);
    const j = c - i * n;
    let touches = false;
    for (let di = -1; di <= 1 && !touches; di++)
      for (let dj = -1; dj <= 1; dj++) {
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const cc = ii * n + jj;
        if (roofCell[cc] === k) continue;
        if (!g[cc]) {
          touches = true;
          break;
        }
      }
    if (!touches) open.push(c);
  }
  for (const c of open) {
    const i = Math.floor(c / n);
    const j = c - i * n;
    g[c] = 0;
    nav.px[c] = origin + (i + 0.5) * cs;
    nav.pz[c] = origin + (j + 0.5) * cs;
  }
  return nav;
}

/** enemies (alive or about to land) on roof b */
export function roofCount(
  b: number,
  enemies: { x: number; z: number; alive: boolean }[],
  pend: ({ x: number; z: number; placed?: boolean } | null)[] = [],
) {
  let n = 0;
  for (const e of enemies) if (e.alive && roofAt(e.x, e.z) === b) n++;
  for (const pd of pend) if (pd?.placed && roofAt(pd.x, pd.z) === b) n++;
  return n;
}

/**
 * A spawn point on roof b: behind rooftop structures out of sight of every player up there,
 * at least 5 m away; otherwise just outside the roof door (as if they came up the stairs).
 */
export function roofSpot(
  b: number,
  blocks: Block[],
  players: { x: number; z: number }[],
  rand: () => number,
  hidden: boolean,
) {
  const acc = W!.list[b]!;
  const spots = acc.spots;
  let best: { x: number; z: number } | null = null;
  let bestScore = -Infinity;
  for (let t = 0; t < 40 && spots.length; t++) {
    const s = spots[Math.floor(rand() * spots.length)]!;
    let dmin = Infinity;
    let seen = false;
    for (const p of players) {
      dmin = Math.min(dmin, Math.hypot(p.x - s.x, p.z - s.z));
      if (!seen && hidden && clearLine(blocks, p.x, p.z, s.x, s.z, 0.1)) seen = true;
    }
    if (dmin < 4) continue;
    const score = (seen ? 0 : 100) + Math.min(dmin, 25);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  if (best && (!hidden || bestScore >= 100)) return { x: best.x, z: best.z };
  // at the roof door
  const q = acc.portals[1];
  const [x, z] = toWorld(acc, q.a + q.na * 1.3, q.d + q.nd * 1.3);
  const far = players.every((p) => Math.hypot(p.x - x, p.z - z) > 4);
  if (far || !best) return { x, z };
  return { x: best.x, z: best.z };
}

/** a street point just outside building b's entrance (street spawns anchor here while the
 * squad is inside or on the roof) */
export function doorstep(b: number) {
  const acc = W!.list[b]!;
  const [x, z] = toWorld(acc, 0, -3);
  return { x, z };
}

/** for the test handle */
export function debugState() {
  return {
    player: { ...player },
    cars: W?.cars.map((c) => ({ ...c })) ?? [],
    doors: W?.doors ?? [],
  };
}

export { CAR_D };

/**
 * Bullets near the local player inside a building: walls are the interior's (the building is
 * solid on the collision grid, and the roof height would read as the floor). `undefined`
 * everywhere else.
 */
export function bulletBlocked(x: number, y: number, z: number): boolean | undefined {
  const w = W;
  const p = player;
  if (!w) return undefined;
  // on a roof (or in a lookout room): its parapet / walls, props and floor stop shots
  const rk = roofAt(x, z);
  if (rk >= 0) {
    const rb = w.list[rk]!;
    if (y >= rb.top - 0.05 && y <= rb.top + rb.roomH)
      return (
        y < rb.top ||
        roofBlocked(rb, x, z, 0.02, false) ||
        furnishingBlocked(rb, 1, ...toLocal(rb, x, z), 0.02, y - 0.02, y + 0.02) ||
        (rb.room && y > rb.top + rb.roomH - 0.08)
      );
  }
  if (p.zone !== 1 || w.list[p.b]!.ladder) return undefined;
  const I = w.list[p.b]!.interior;
  if (x < I.x0 || x > I.x1 || z < I.z0 || z > I.z1) return undefined;
  if (Math.abs(y - (p.y + 1.3)) > 3) return undefined;
  if (y < p.y + 0.04 || y > p.y + 2.55) return true;
  const b = w.list[p.b]!;
  const [a, d] = toLocal(b, x, z);
  const rects = b.elev
    ? elevRects(b, p, w.cars[p.b]!, w.doors[p.b]!)
    : stairRects(b, p, w.doors[p.b]!);
  return (
    !insideStair(b, p, rects, a, d, 0.02) || furnishingBlocked(b, 0, a, d, 0.02, y - 0.02, y + 0.02)
  );
}
