// Pure traffic simulation (no three.js, no React), stepped at a FIXED timestep so the
// cars take exactly the same path at 30, 60 or 144 fps. The renderer interpolates
// between the previous and current step for smooth motion.
//
// Roads come from the city layout: each has a centre line and a class that sets its
// lanes (1 per direction on side streets, 2 on avenues and the boulevard) and its
// curb-to-curb width. Right-hand traffic; right turns go to the outer lane, left turns
// to the inner one. Turns follow a quarter-circle arc fitted inside the kerb corner.
//
// Police pursuits (see pursuit.ts) add two "special" roles: a fleeing SUSPECT and the
// COPS chasing it. Specials ignore lights, drive much faster, pick a lateral line
// (their lane, the gap between lanes, or the oncoming side) by looking for free road,
// and never drive into another car. Normal cars yield to sirens (slow down and pull
// aside to open a corridor) and hold at a green while a pursuit is crossing.
import { CURB, LANES, type Road, type StreetClass } from "./cityLayout";
import { signal, untilRed, GREEN, RED, YELLOW } from "./trafficCore";
import { nodeDark } from "./events/power";
import { makeVehicle, vehicleHeight, type Vehicle } from "./vehicles";

export const SIM_DT = 1 / 60;
/** Right-hand traffic: which side of the centre line a direction drives on (+1 / -1). */
export const laneSign = (axis: 0 | 1, dir: 1 | -1) => (axis === 0 ? dir : -dir);
const CROSSWALK = 3.8; // stop line distance past the curb line
/**
 * Drivable half width, centre line to the parking lane (cityLayout: the street band
 * minus its sidewalks and parking lanes). Nothing may leave this.
 */
export const ROAD_HALF: Record<StreetClass, number> = { side: 4, avenue: 8, main: 10 };
/** the boulevard's planted median reaches this far either side of its centre line */
const MEDIAN = 2;
/** how far a yielding car shifts inside its lane (keeps it clear of parked cars and the median) */
const PULL = 0.9;

export const ROLE_NORMAL = 0;
export const ROLE_COP = 1;
export const ROLE_SUSPECT = 2;
export type Role = 0 | 1 | 2;

/** the suspect's turn decisions, so the cops can follow its exact route */
export type Trail = { axis: 0 | 1; dir: 1 | -1; line: number; next: number; turn: -1 | 0 | 1 }[];

type Arc = {
  /** arc start point, forward and turn-side unit vectors, radius, distance travelled, length */
  ex: number;
  ez: number;
  fx: number;
  fz: number;
  nx: number;
  nz: number;
  R: number;
  d: number;
  len: number;
  naxis: 0 | 1;
  ndir: 1 | -1;
  nlane: number;
  nlat: number;
  oldLine: number;
};

export type Car = {
  v: Vehicle;
  h: number;
  axis: 0 | 1;
  dir: 1 | -1;
  /** index of the road we drive on (roadZ for axis 0, roadX for axis 1) */
  line: number;
  /** lane index on that road, 0 = inner */
  lane: number;
  /** position along the axis of travel */
  s: number;
  speed: number;
  vmax: number;
  /** normal-traffic top speed (vmax goes back to this when a pursuit ends) */
  baseVmax: number;
  /** index of the next cross road ahead */
  next: number;
  /** -1 left, 0 straight, 1 right, null = not decided yet */
  turn: -1 | 0 | 1 | null;
  /** lateral position: world-signed offset of the car's centre from the road centre line */
  lat: number;
  latT: number;
  latV: number;
  /** how far a yielding car has shifted inside its lane (0..PULL) */
  pull: number;
  /** heading (atan2(x, z) convention), including steering and the parked angle */
  yaw: number;
  pyaw: number;
  /** extra yaw of a cruiser parked at an angle behind a caught suspect */
  yawOff: number;
  arc: Arc | null;
  role: Role;
  /** cop: which car it chases; suspect: target -1. Both share the pursuit's trail. */
  chase: { target: number; trail: Trail } | null;
  /** caught scene: 1 suspect pulling over, 2 lead cruiser, 3 second cruiser */
  park: 0 | 1 | 2 | 3;
  /** specials: time until the next lateral re-plan; suspect swerve timer and favourite lane */
  plan: number;
  swerve: number;
  pref: number;
  /** null until the first step (cars can spawn past a stop line: that isn't running a red) */
  committedPrev: boolean | null;
  /** the stop line we've already decided about on amber, and whether we stop for it */
  amberAt: number;
  amberStop: boolean;
  /** was a pursuit car last step; after release it drives on as one up to the next junction */
  wasSpecial: boolean;
  coolKey: number;
  /** blackout: the dead signal we last saw (and when), and the one we've already stopped at */
  darkSid: number;
  darkT: number;
  darkDone: number;
  /** the light this car obeyed last step */
  lightPrev: number;
  /** which car is holding us up (-1 = nothing / a light) and how long we've been stuck */
  blocker: number;
  stuckT: number;
  /** deadlock breaker: the cars we're allowed to ignore for a moment, and for how long */
  ghost: number[];
  ghostT: number;
  yawVis: number;
  honk: number;
  hitCd: number;
  /** world position at the previous / current fixed step (for render interpolation) */
  px: number;
  pz: number;
  x: number;
  z: number;
  /** far from every player: stepped at a quarter of the rate */
  far?: boolean;
  /** guest-side smoothed render position (follows host snapshots) */
  gx?: number;
  gz?: number;
};

export type SimEnemy = { x: number; z: number; alive: boolean; r: number; big: boolean };
export type SimEnv = {
  roadX: Road[];
  roadZ: Road[];
  rand: () => number;
  /** players the cars brake for; index 0 is the local player (for the horn) */
  players: { x: number; z: number }[];
  enemies: SimEnemy[];
  /** a moving car touched an enemy; the host applies damage / knockback */
  onEnemyContact?: ((car: Car, idx: number, big: boolean) => void) | undefined;
};

/** Debug counters (read by the test tooling through the ?debug=1 handle). */
export const trafficStats = {
  redRunsSpecial: 0,
  redRunsNormal: 0,
  deadlockBreaks: 0,
  /** the last few normal-car red runs, for diagnosis */
  redRunLog: [] as Record<string, unknown>[],
};

/** the car that produced the last scan result, and a car the scans must skip */
let scanHit: Car | null = null;
let scanSkip: Car[] = [];

/** lateral offset of a lane from the road centre line */
export const laneOffset = (road: Road, axis: 0 | 1, dir: 1 | -1, lane: number) => {
  const ls = LANES[road.cls];
  return laneSign(axis, dir) * ls[Math.max(0, Math.min(ls.length - 1, lane))]!;
};

/** The siren corridor: the gap between lanes (or just over the centre line on side streets). */
export const corridorLat = (road: Road, axis: 0 | 1, dir: 1 | -1) => {
  const ls = LANES[road.cls];
  return laneSign(axis, dir) * (ls.length > 1 ? (ls[0]! + ls[1]!) / 2 : 0.4);
};

export const posOf = (c: Car, roadX: Road[], roadZ: Road[]) => {
  const road = (c.axis === 0 ? roadZ : roadX)[c.line]!;
  const perp = road.c + c.lat;
  return c.axis === 0 ? { x: c.s, z: perp } : { x: perp, z: c.s };
};
export const headingOf = (c: Car) => c.yaw;
const axisYaw = (axis: 0 | 1, dir: 1 | -1) =>
  Math.atan2(axis === 0 ? dir : 0, axis === 1 ? dir : 0);

/** Build a car in its lane at rest state (used by the traffic spawner). */
export function makeCar(
  v: Vehicle,
  h: number,
  road: Road,
  axis: 0 | 1,
  dir: 1 | -1,
  line: number,
  lane: number,
  s: number,
  vmax: number,
  next: number,
): Car {
  const lat = laneOffset(road, axis, dir, lane);
  const x = axis === 0 ? s : road.c + lat;
  const z = axis === 0 ? road.c + lat : s;
  const yaw = axisYaw(axis, dir);
  return {
    v,
    h,
    axis,
    dir,
    line,
    lane,
    s,
    speed: vmax * 0.6,
    vmax,
    baseVmax: vmax,
    next,
    turn: null,
    lat,
    latT: lat,
    latV: 0,
    pull: 0,
    yaw,
    pyaw: yaw,
    yawOff: 0,
    arc: null,
    role: ROLE_NORMAL,
    chase: null,
    park: 0,
    plan: 0,
    swerve: 0,
    pref: 0,
    committedPrev: null,
    amberAt: -1,
    amberStop: false,
    wasSpecial: false,
    coolKey: -1,
    darkSid: -1,
    darkT: -9,
    darkDone: -1,
    lightPrev: 0,
    blocker: -1,
    stuckT: 0,
    ghost: [],
    ghostT: 0,
    yawVis: yaw,
    honk: 0,
    hitCd: 0,
    px: x,
    pz: z,
    x,
    z,
  };
}

/** new heading after turning (1 right / -1 left) from (axis, dir) */
export function turned(axis: 0 | 1, dir: 1 | -1, turn: 1 | -1) {
  const dx = axis === 0 ? dir : 0;
  const dz = axis === 1 ? dir : 0;
  // right of heading (dx, dz) is (-dz, dx)
  const nx = turn === 1 ? -dz : dz;
  const nz = turn === 1 ? dx : -dx;
  const naxis = (1 - axis) as 0 | 1;
  const ndir = (naxis === 0 ? nx : nz) as 1 | -1;
  return { naxis, ndir };
}

/** which turns are possible at the next intersection (only roads that continue) */
function turnOptions(c: Car, cross: Road[], along: Road[]) {
  const opts: (-1 | 0 | 1)[] = [];
  if (c.next + c.dir >= 0 && c.next + c.dir < cross.length) opts.push(0);
  for (const turn of [1, -1] as const) {
    const { ndir } = turned(c.axis, c.dir, turn);
    const nextIdx = c.line + ndir;
    if (nextIdx >= 0 && nextIdx < along.length) opts.push(turn);
  }
  return opts;
}

/**
 * Geometry of the coming turn: the arc radius that fits inside the kerb corner, where
 * the arc starts (along our axis) and the lateral line we come out on. Normal cars keep
 * the arc inside the intersection; specials may start it early and swing wide (they
 * come out on the corridor), which is what "cutting the corner" looks like.
 */
/**
 * The lane a turn ends in: right turns from the outer lane go to the outer lane, left turns
 * from the inner lane to the inner lane. A turn from the "wrong" lane (forced at a T-junction)
 * keeps its lane index, so side-by-side turners follow parallel arcs instead of crossing.
 */
function exitLane(c: Car, ownRoad: Road, crossRoad: Road, turn: 1 | -1) {
  const ownLast = LANES[ownRoad.cls].length - 1;
  const newLast = LANES[crossRoad.cls].length - 1;
  if (turn === 1 && c.lane >= ownLast) return newLast;
  if (turn === -1 && c.lane === 0) return 0;
  return Math.min(c.lane, newLast);
}

function turnGeom(c: Car, crossRoad: Road, ownRoad: Road, turn: 1 | -1, special: boolean) {
  const { naxis, ndir } = turned(c.axis, c.dir, turn);
  const nlane = exitLane(c, ownRoad, crossRoad, turn);
  const nlat = special
    ? corridorLat(crossRoad, naxis, ndir)
    : laneOffset(crossRoad, naxis, ndir, nlane);
  // local frame: u forward (0 = cross road centre), w toward the turn side (0 = our centre line)
  const latR = c.lat * laneSign(c.axis, c.dir);
  const wCar = turn === 1 ? latR : -latR;
  const uNew = nlat * c.dir;
  const hc = ROAD_HALF[crossRoad.cls];
  const ho = ROAD_HALF[ownRoad.cls];
  const early = special ? (ownRoad.cls === "main" ? 3 : 6) : 1;
  let R = Math.min(uNew + hc + early, ho + early - wCar, special ? 16 : 9);
  // normal left turns stay tight so two opposite left-turners pass each other cleanly
  if (!special && turn === -1) R = Math.min(R, Math.abs(uNew) + 0.25);
  // the inner kerb corner sits at (u, w) = (-hc, ho): keep the car's inner edge off it
  for (; R > 1.5; R -= 0.25) {
    const a = -hc - uNew + R;
    const b = wCar + R - ho;
    if (a <= 0 || b <= 0 || Math.hypot(a, b) + c.v.wid / 2 + 0.4 <= R) break;
  }
  R = Math.max(1.5, R);
  const sStart = crossRoad.c + c.dir * (uNew - R);
  return { R, sStart, naxis, ndir, nlane, nlat };
}

type Geom = ReturnType<typeof turnGeom>;

function startArc(c: Car, g: Geom, ownRoad: Road, turn: 1 | -1) {
  const fx = c.axis === 0 ? c.dir : 0;
  const fz = c.axis === 1 ? c.dir : 0;
  // right of (fx, fz) is (-fz, fx)
  const nx = turn === 1 ? -fz : fz;
  const nz = turn === 1 ? fx : -fx;
  const perp = ownRoad.c + c.lat;
  c.arc = {
    ex: c.axis === 0 ? g.sStart : perp,
    ez: c.axis === 0 ? perp : g.sStart,
    fx,
    fz,
    nx,
    nz,
    R: g.R,
    d: 0,
    len: (g.R * Math.PI) / 2,
    naxis: g.naxis,
    ndir: g.ndir,
    nlane: g.nlane,
    nlat: g.nlat,
    oldLine: c.line,
  };
}

/** move along the arc; at its end the car becomes a straight driver on the new road */
function advanceArc(c: Car, dist: number, roadX: Road[], roadZ: Road[]) {
  const a = c.arc!;
  a.d += dist;
  if (a.d >= a.len) {
    const over = a.d - a.len;
    const X = a.naxis === 0 ? a.ex + a.R * (a.fx + a.nx) : a.ez + a.R * (a.fz + a.nz);
    c.axis = a.naxis;
    c.dir = a.ndir;
    c.line = c.next;
    c.lane = a.nlane;
    c.lat = a.nlat;
    c.latT = a.nlat;
    c.latV = 0;
    c.s = X + a.ndir * over;
    c.next = a.oldLine + a.ndir;
    c.turn = null;
    c.arc = null;
    c.plan = 0;
    const n = (c.axis === 0 ? roadX : roadZ).length;
    if (c.next < 0 || c.next >= n) {
      // should not happen (turns only pick roads that continue): turn around safely
      c.dir = -c.dir as 1 | -1;
      c.next = Math.max(0, Math.min(n - 1, c.next - c.dir * 2));
    }
    return;
  }
  const th = a.d / a.R;
  const sn = Math.sin(th);
  const cs = 1 - Math.cos(th);
  c.x = a.ex + a.R * (a.fx * sn + a.nx * cs);
  c.z = a.ez + a.R * (a.fz * sn + a.nz * cs);
  c.s = c.axis === 0 ? c.x : c.z;
}

/** heading of travel (no steering, no parked angle) */
function travelYaw(c: Car) {
  const a = c.arc;
  if (!a) return axisYaw(c.axis, c.dir);
  const th = a.d / a.R;
  return Math.atan2(
    a.fx * Math.cos(th) + a.nx * Math.sin(th),
    a.fz * Math.cos(th) + a.nz * Math.sin(th),
  );
}

/**
 * Free distance ahead inside a lateral band [lo, hi] (metres to the right of our centre,
 * in the frame of heading (fx, fz)). Other cars count with their real rotated footprint.
 * A car driving away earns part of its own braking distance; an oncoming one halves it.
 */
function scanBand(
  c: Car,
  list: Car[],
  fx: number,
  fz: number,
  lo: number,
  hi: number,
  range: number,
  /** ignore anything further than this (a turn comes first: scanPath covers it) */
  limit = Infinity,
) {
  const half = c.v.len / 2;
  const rx = -fz;
  const rz = fx;
  let free = Infinity;
  scanHit = null;
  for (const o of list) {
    if (o === c || scanSkip.includes(o)) continue;
    const dx = o.x - c.x;
    const dz = o.z - c.z;
    if (Math.abs(dx) > range + 12 || Math.abs(dz) > range + 12) continue;
    const a = dx * fx + dz * fz;
    const l = dx * rx + dz * rz;
    const ofx = Math.sin(o.yaw);
    const ofz = Math.cos(o.yaw);
    const cd = ofx * fx + ofz * fz;
    const sd = ofx * rx + ofz * rz;
    const ha = (Math.abs(cd) * o.v.len + Math.abs(sd) * o.v.wid) / 2;
    const hl = (Math.abs(sd) * o.v.len + Math.abs(cd) * o.v.wid) / 2;
    if (l + hl < lo || l - hl > hi) continue;
    if (a < 0) continue; // beside or behind us: driving on separates us (sideClear guards lane changes)
    let gap = a - ha - half;
    if (gap > range || gap > limit) continue;
    const vo = o.speed * cd;
    if (gap > 0) {
      if (vo > 0.5) gap += (0.8 * vo * vo) / (2 * 14);
      else if (vo < -0.5) gap *= (c.speed + 1) / (c.speed - vo + 1);
    }
    if (gap < free) {
      free = gap;
      scanHit = o;
    }
  }
  return free;
}

/**
 * The road ahead as a path: a straight run, then (if turning) the arc, then straight
 * out of it. Lets a car look where it will actually drive instead of along its nose.
 */
type Path = {
  x0: number;
  z0: number;
  fx: number;
  fz: number;
  /** length of the first straight run (Infinity when no turn is coming) */
  L0: number;
  ex: number;
  ez: number;
  nx: number;
  nz: number;
  R: number;
  d0: number;
  len: number;
};
const _pp = { x: 0, z: 0, tx: 0, tz: 0 };

function pathOf(c: Car, geom: Geom | null, ownRoad: Road, turn: -1 | 0 | 1): Path {
  const a = c.arc;
  if (a)
    return {
      x0: c.x,
      z0: c.z,
      fx: a.fx,
      fz: a.fz,
      L0: 0,
      ex: a.ex,
      ez: a.ez,
      nx: a.nx,
      nz: a.nz,
      R: a.R,
      d0: a.d,
      len: a.len,
    };
  const fx = c.axis === 0 ? c.dir : 0;
  const fz = c.axis === 1 ? c.dir : 0;
  if (!geom || turn === 0)
    return {
      x0: c.x,
      z0: c.z,
      fx,
      fz,
      L0: Infinity,
      ex: 0,
      ez: 0,
      nx: 0,
      nz: 0,
      R: 1,
      d0: 0,
      len: 0,
    };
  const perp = ownRoad.c + c.lat;
  return {
    x0: c.x,
    z0: c.z,
    fx,
    fz,
    L0: Math.max(0, (geom.sStart - c.s) * c.dir),
    ex: c.axis === 0 ? geom.sStart : perp,
    ez: c.axis === 0 ? perp : geom.sStart,
    nx: turn === 1 ? -fz : fz,
    nz: turn === 1 ? fx : -fx,
    R: geom.R,
    d0: 0,
    len: (geom.R * Math.PI) / 2,
  };
}

/** point and tangent `s` metres along a path (written into _pp) */
function pathAt(P: Path, s: number) {
  if (s < P.L0) {
    _pp.x = P.x0 + P.fx * s;
    _pp.z = P.z0 + P.fz * s;
    _pp.tx = P.fx;
    _pp.tz = P.fz;
    return _pp;
  }
  s -= P.L0;
  const rem = P.len - P.d0;
  if (s < rem) {
    const th = (P.d0 + s) / P.R;
    const sn = Math.sin(th);
    const cs = Math.cos(th);
    _pp.x = P.ex + P.R * (P.fx * sn + P.nx * (1 - cs));
    _pp.z = P.ez + P.R * (P.fz * sn + P.nz * (1 - cs));
    _pp.tx = P.fx * cs + P.nx * sn;
    _pp.tz = P.fz * cs + P.nz * sn;
    return _pp;
  }
  s -= rem;
  _pp.x = P.ex + P.R * (P.fx + P.nx) + P.nx * s;
  _pp.z = P.ez + P.R * (P.fz + P.nz) + P.nz * s;
  _pp.tx = P.nx;
  _pp.tz = P.nz;
  return _pp;
}

/**
 * Free distance along the path: our front edge is swept along it in 1 m steps and
 * tested against every nearby car's real footprint (plus `margin` sideways).
 */
function scanPath(c: Car, list: Car[], P: Path, range: number, margin: number) {
  const half = c.v.len / 2;
  const hw = c.v.wid / 2;
  const near: Car[] = [];
  scanHit = null;
  for (const o of list)
    if (
      o !== c &&
      !scanSkip.includes(o) &&
      Math.abs(o.x - c.x) < range + 14 &&
      Math.abs(o.z - c.z) < range + 14
    )
      near.push(o);
  if (near.length === 0) return Infinity;
  for (let s = 0; s <= range; s += 1) {
    const p = pathAt(P, s + half);
    for (const o of near) {
      const ofx = Math.sin(o.yaw);
      const ofz = Math.cos(o.yaw);
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      const along = dx * ofx + dz * ofz;
      const lat = dx * ofz - dz * ofx; // o's right is (ofz, -ofx) up to sign: only |lat| matters
      // our front edge runs along our right vector (-tz, tx): its reach on o's axes
      const ea = hw * Math.abs(-p.tz * ofx + p.tx * ofz);
      const el = hw * Math.abs(-p.tz * ofz - p.tx * ofx);
      if (Math.abs(along) < o.v.len / 2 + ea + 0.2 && Math.abs(lat) < o.v.wid / 2 + el + margin) {
        let gap = s - 0.3;
        const vo = o.speed * (ofx * p.tx + ofz * p.tz);
        if (gap > 0) {
          if (vo > 0.5) gap += (0.8 * vo * vo) / (2 * 14);
          else if (vo < -0.5) gap *= (c.speed + 1) / (c.speed - vo + 1);
        }
        scanHit = o;
        return gap;
      }
    }
  }
  return Infinity;
}

/** nothing beside us in the band we are about to slide across */
function sideClear(c: Car, list: Car[], fx: number, fz: number, lo: number, hi: number) {
  const half = c.v.len / 2;
  const rx = -fz;
  const rz = fx;
  for (const o of list) {
    if (o === c) continue;
    const dx = o.x - c.x;
    const dz = o.z - c.z;
    if (Math.abs(dx) > 20 || Math.abs(dz) > 20) continue;
    const a = dx * fx + dz * fz;
    const l = dx * rx + dz * rz;
    const ofx = Math.sin(o.yaw);
    const ofz = Math.cos(o.yaw);
    const cd = ofx * fx + ofz * fz;
    const sd = ofx * rx + ofz * rz;
    const ha = (Math.abs(cd) * o.v.len + Math.abs(sd) * o.v.wid) / 2;
    const hl = (Math.abs(sd) * o.v.len + Math.abs(cd) * o.v.wid) / 2;
    if (l + hl < lo || l - hl > hi) continue;
    if (a - ha < half + 3 && a + ha > -half - 1.5) return false;
  }
  return true;
}

/**
 * Roads may carry their index in the full city grid (`sig`, out of `sigN` roads along z), so
 * a trimmed road list (solo play keeps traffic inside the blockades) still reads the same
 * light phases the rendered traffic lights show.
 */
type SigRoad = Road & { sig?: number; sigN?: number };
function signalId(crossRoad: SigRoad, ownRoad: SigRoad, axis: 0 | 1, fallback: number) {
  const x = axis === 0 ? crossRoad : ownRoad; // the N-S road (fixed x)
  const z = axis === 0 ? ownRoad : crossRoad;
  if (x.sig === undefined || z.sig === undefined || z.sigN === undefined) return fallback;
  return x.sig * z.sigN + z.sig;
}

/** the node id of the intersection a car is heading for */
const nodeOf = (c: Car, nz: number) => (c.axis === 0 ? c.next * nz + c.line : c.line * nz + c.next);

/** where a cop should turn: the suspect's own choice if we're on its trail, else toward it */
function copTurn(c: Car, cars: Car[], cross: Road[], along: Road[]): -1 | 0 | 1 {
  const opts = turnOptions(c, cross, along);
  if (opts.length === 0) return 0;
  const trail = c.chase!.trail;
  for (let k = trail.length - 1; k >= 0; k--) {
    const e = trail[k]!;
    if (e.axis === c.axis && e.dir === c.dir && e.line === c.line && e.next === c.next)
      if (opts.includes(e.turn)) return e.turn;
  }
  const tgt = cars[c.chase!.target];
  if (!tgt) return opts[0]!;
  const nx = c.axis === 0 ? cross[c.next]!.c : along[c.line]!.c;
  const nz = c.axis === 0 ? along[c.line]!.c : cross[c.next]!.c;
  const dx = tgt.x - nx;
  const dz = tgt.z - nz;
  const d = Math.hypot(dx, dz) || 1;
  let best = opts[0]!;
  let bestScore = -Infinity;
  for (const o of opts) {
    let hx = c.axis === 0 ? c.dir : 0;
    let hz = c.axis === 1 ? c.dir : 0;
    if (o !== 0) {
      const { naxis, ndir } = turned(c.axis, c.dir, o);
      hx = naxis === 0 ? ndir : 0;
      hz = naxis === 1 ? ndir : 0;
    }
    const score = (hx * dx + hz * dz) / d + (o === 0 ? 0.2 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}

/** lateral lines a special may drive on, with how much it dislikes each (metres of free road) */
function specialLines(road: Road, axis: 0 | 1, dir: 1 | -1, suspect: boolean, pref: number) {
  const sg = laneSign(axis, dir);
  const ls = LANES[road.cls];
  const out: { lat: number; cost: number }[] = [];
  ls.forEach((o, k) => out.push({ lat: sg * o, cost: suspect ? (k === pref ? -4 : 0) : 3 }));
  out.push({ lat: corridorLat(road, axis, dir), cost: suspect ? 2 : 0 });
  if (road.cls === "avenue") {
    out.push({ lat: 0, cost: suspect ? 4 : 5 });
    out.push({ lat: -sg * 4, cost: suspect ? 9 : 12 });
  } else if (road.cls === "side") out.push({ lat: -sg * 2, cost: suspect ? 9 : 12 });
  return out;
}

/** keep a lateral line on the tarmac (and off the boulevard median) */
function clampLat(road: Road, axis: 0 | 1, dir: 1 | -1, lat: number, wid: number) {
  const lim = ROAD_HALF[road.cls] - wid / 2 - 0.3;
  let l = Math.max(-lim, Math.min(lim, lat));
  if (road.cls === "main") {
    const sg = laneSign(axis, dir);
    const inner = MEDIAN + wid / 2 + 0.1;
    if (l * sg < inner) l = sg * inner;
  }
  return l;
}

/**
 * Advance cars by exactly `dt`. `only` limits the step to near (false) or far (true) cars,
 * so far cars can run at a lower rate with a larger dt. Returns the indices of cars that
 * are braking for the local player (so the caller can honk).
 */
export function stepCars(
  cars: Car[],
  env: SimEnv,
  dt: number,
  t: number,
  only: boolean | null = null,
) {
  const { roadX, roadZ, rand } = env;
  const brakingForLocal: number[] = [];
  const specials: Car[] = [];
  for (const o of cars) if (o.role !== ROLE_NORMAL || o.park) specials.push(o);
  const index = new Map<Car, number>();
  cars.forEach((o, i) => index.set(o, i));
  for (let ci = 0; ci < cars.length; ci++) {
    const c = cars[ci]!;
    if (only !== null && !!c.far !== only) continue;
    // Deadlock breaker: cars stuck for seconds, each waiting for the next in a loop (e.g. a
    // cruiser and a car meeting nose to nose in a junction). The lowest index in the loop
    // may ignore the car it waits for until they're apart (or 4 s pass).
    if (c.ghost.length === 0 && c.stuckT > 2.5 && c.blocker >= 0) {
      // follow who-waits-for-whom; a short loop of stuck cars is a deadlock
      const loop: number[] = [];
      let k = c.blocker;
      let lowest = true;
      for (let hop = 0; hop < 4 && k >= 0 && k !== ci; hop++) {
        const q = cars[k]!;
        if (q.stuckT <= 2.5) {
          k = -1;
          break;
        }
        if (k < ci) lowest = false;
        loop.push(k);
        k = q.blocker;
      }
      if (k === ci && lowest) {
        c.ghost = loop;
        c.ghostT = 0;
        trafficStats.deadlockBreaks++;
      }
    }
    scanSkip = [];
    if (c.ghost.length) {
      c.ghostT += dt;
      const apart = c.ghost.every((g) => Math.hypot(cars[g]!.x - c.x, cars[g]!.z - c.z) > 14);
      if (c.ghostT > 4 || apart) c.ghost = [];
      else scanSkip = c.ghost.map((g) => cars[g]!);
    }
    // A pursuit car that has just been released is still doing pursuit speed and may be
    // metres from a red it was always going to run: it keeps driving like one through the
    // next junction (and while still well over its normal speed), and is counted as one.
    const key = c.axis * 1e6 + c.line * 1000 + c.next;
    if (c.role === ROLE_NORMAL && c.wasSpecial) c.coolKey = key;
    else if (c.coolKey !== key && !c.arc) c.coolKey = -1;
    c.wasSpecial = c.role !== ROLE_NORMAL;
    const special = c.role !== ROLE_NORMAL || c.coolKey >= 0 || c.speed > c.baseVmax + 3;
    const cross = c.axis === 0 ? roadX : roadZ;
    const along = c.axis === 0 ? roadZ : roadX; // roads parallel to us, indexed by line
    const half = c.v.len / 2;
    const hw = c.v.wid / 2;
    c.px = c.x;
    c.pz = c.z;
    c.pyaw = c.yaw;

    // ---- decide what to do at the next intersection ----
    if (!c.arc) {
      if (c.role === ROLE_COP && c.chase) {
        // keep re-planning (the trail may appear) until close to the junction
        const dNode = (cross[c.next]!.c - c.s) * c.dir;
        if (c.turn === null || dNode > 35) c.turn = copTurn(c, cars, cross, along);
      } else if (c.turn === null) {
        let opts = turnOptions(c, cross, along);
        // on two-lane roads: left turns from the inner lane, right turns from the outer one
        // (turning across the other lane is what used to cause side-swipes in junctions)
        const nl = LANES[along[c.line]!.cls].length;
        if (c.role === ROLE_NORMAL && nl > 1) {
          const ok = opts.filter((o) => o === 0 || (o === -1 ? c.lane === 0 : c.lane === nl - 1));
          if (ok.length) opts = ok;
        }
        const w = opts.map((o) => (o === 0 ? (c.role === ROLE_SUSPECT ? 1.3 : 2.2) : 1));
        let r = rand() * w.reduce((a, b) => a + b, 0);
        c.turn = opts[opts.length - 1] ?? 0;
        for (let k = 0; k < opts.length; k++) {
          r -= w[k]!;
          if (r <= 0) {
            c.turn = opts[k]!;
            break;
          }
        }
        if (c.role === ROLE_SUSPECT && c.chase) {
          const tr = c.chase.trail;
          tr.push({ axis: c.axis, dir: c.dir, line: c.line, next: c.next, turn: c.turn });
          if (tr.length > 16) tr.shift();
        }
      }
    }

    const crossRoad = cross[c.next]!;
    const cx = crossRoad.c;
    const crossHalf = CURB[crossRoad.cls];
    const ownRoad = along[c.line]!;
    const sg = laneSign(c.axis, c.dir);
    const node = nodeOf(c, roadZ.length);
    const stopCentre = cx - c.dir * (crossHalf + CROSSWALK + half);
    const committed = !!c.arc || (c.s - stopCentre) * c.dir > 0.05;
    // blackout: a dead signal is an all-way stop, so cars creep through (the box check
    // below still keeps them out of cross traffic)
    // (the lights are numbered on the full city grid, even when solo play trims the roads)
    const sid = signalId(crossRoad, ownRoad, c.axis, node);
    // (a signal flickering back to life mid-approach stays "dead" for a moment, so the
    // light doesn't blink red at a car already creeping through its all-way stop)
    if (nodeDark(sid)) {
      c.darkSid = sid;
      c.darkT = t;
    }
    const deadSignal = c.darkSid === sid && t - c.darkT < 1.5;
    if (!deadSignal) c.darkDone = -1;
    const light = deadSignal ? GREEN : signal(sid, t, c.axis);
    // `committed` reflects last step's move, so judge it by the light that move was made
    // under (a car creeping over a dead signal isn't running the red it comes back on)
    if (committed && c.committedPrev === false && c.lightPrev === RED) {
      if (special) trafficStats.redRunsSpecial++;
      else {
        trafficStats.redRunsNormal++;
        trafficStats.redRunLog.push({
          t: +t.toFixed(2),
          car: ci,
          x: +c.x.toFixed(1),
          z: +c.z.toFixed(1),
          speed: +c.speed.toFixed(1),
          far: !!c.far,
          turn: c.turn,
          amberStop: c.amberStop,
          sid,
          blocker: c.blocker,
          ghost: c.ghost.length,
          dark: deadSignal,
          stuckT: +c.stuckT.toFixed(1),
        });
        if (trafficStats.redRunLog.length > 20) trafficStats.redRunLog.shift();
      }
    }
    c.committedPrev = committed;
    c.lightPrev = light;

    // travel frame (arc tangent while turning)
    const ty = travelYaw(c);
    const fx = Math.sin(ty);
    const fz = Math.cos(ty);
    let room = Infinity;
    let who = -1;
    /** tighten the room we have, remembering which car (if any) caused it */
    const lim = (v: number, o: Car | null) => {
      if (v < room) {
        room = v;
        who = o ? (index.get(o) ?? -1) : -1;
      }
    };
    let vcap = c.vmax;
    if (deadSignal && !committed) {
      const toStop = (stopCentre - c.s) * c.dir;
      if (toStop < 22) vcap = Math.min(vcap, 2.2 + Math.max(0, toStop) * 0.3);
      // all-way stop: come to a halt at the line once, then creep across
      if (!special && c.darkDone !== sid) {
        lim(toStop, null);
        if (toStop < 1.5 && c.speed < 0.3) c.darkDone = sid;
      }
    }
    let yawOffT = 0;
    const turnDir = c.turn === 1 || c.turn === -1 ? c.turn : 0;
    // how close we are to where our arc would begin (no lateral changes in the last metres)
    let geom: Geom | null = null;
    if (!c.arc && turnDir !== 0) geom = turnGeom(c, crossRoad, ownRoad, turnDir, special);
    const dA = geom ? (geom.sStart - c.s) * c.dir : Infinity;
    const nearArc = dA < 10;

    if (!special) {
      // ---- normal traffic ----
      if (!committed && light !== GREEN) {
        const dist = (stopCentre - c.s) * c.dir;
        // Amber: decide ONCE per stop line and stick to it. Re-deciding every step made cars
        // that could stop comfortably coast on (braking only starts late) until the "can I
        // stop?" test flipped to "no", then roll over the line after it had turned red.
        // Go only if we can't stop comfortably AND will be over the line before red.
        const stopId = node * 2 + (c.dir > 0 ? 1 : 0) + c.axis * 1e6;
        if (light === YELLOW && c.amberAt !== stopId) {
          c.amberAt = stopId;
          const comfy = dist + 0.3 >= (c.speed * c.speed) / (2 * 6); // (a car waiting at the line stays)
          // turning cars slow down before the line, so assume they get there slower
          const v = Math.max(1, c.speed * (turnDir !== 0 ? 0.6 : 0.9));
          const inTime = dist / v < untilRed(sid, t, c.axis) - 0.25;
          c.amberStop = comfy || !inTime;
        }
        if (light === RED || c.amberStop) lim(dist, null);
      }
      // don't enter the box while cross traffic is still in it, or if our exit lane is backed up
      if (!committed) {
        const ix = c.axis === 0 ? cx : ownRoad.c;
        const iz = c.axis === 0 ? ownRoad.c : cx;
        const boxX = c.axis === 0 ? crossHalf : CURB[ownRoad.cls];
        const boxZ = c.axis === 0 ? CURB[ownRoad.cls] : crossHalf;
        let exAxis: 0 | 1 = c.axis;
        let exDir: 1 | -1 = c.dir;
        let exLine = c.line;
        let exLane = c.lane;
        let exEntry = cx + c.dir * crossHalf;
        if (turnDir !== 0) {
          const { naxis, ndir } = turned(c.axis, c.dir, turnDir);
          exAxis = naxis;
          exDir = ndir;
          exLine = c.next;
          exLane = exitLane(c, ownRoad, crossRoad, turnDir);
          exEntry = ownRoad.c + exDir * CURB[ownRoad.cls];
        }
        let busy = false;
        let busyBy: Car | null = null;
        for (const o of cars) {
          if (o === c || scanSkip.includes(o)) continue;
          const inBox = Math.abs(o.x - ix) < boxX && Math.abs(o.z - iz) < boxZ;
          // cross traffic in the box, or already over its stop line and on its way in (an amber
          // straggler); an oncoming car mid left turn across our path
          const crossing =
            o.axis !== c.axis &&
            (inBox ||
              (o.committedPrev === true &&
                o.speed > 1 &&
                !o.arc &&
                nodeOf(o, roadZ.length) === node));
          const leftTurner =
            !!o.arc && o.axis === c.axis && o.dir !== c.dir && o.turn === -1 && inBox;
          if (crossing || leftTurner) {
            busy = true;
            busyBy = o;
            break;
          }
          if (o.axis === exAxis && o.dir === exDir && o.line === exLine && o.lane === exLane) {
            const past = (o.s - exEntry) * exDir; // how far into the exit lane it is
            // a queued car needs a full car length of room; a moving one just needs to be clear of the entry
            const need =
              o.speed < 2 ? o.v.len / 2 + c.v.len + 1.5 : o.v.len / 2 + c.v.len / 2 + 1.5;
            if (past > -o.v.len / 2 - 1 && past < need) {
              busy = true;
              busyBy = o;
              break;
            }
          }
        }
        // turning across other traffic: a left turn gives way to oncoming cars going straight
        // or right (a forced turn from the other lane keeps its lane, so it crosses nobody)
        if (!busy && turnDir !== 0) {
          for (const o of cars) {
            if (o === c || o.axis !== c.axis || o.line !== c.line || o.next !== c.next) continue;
            if (o.dir !== c.dir && turnDir === -1 && o.turn !== -1) {
              const oTo = (cx - o.s) * o.dir - crossHalf; // distance to the box
              const inBox = !!o.arc || (oTo < 0 && -oTo < 2 * crossHalf + o.v.len);
              // (also a car waiting at its stop line: it has the right of way when it goes)
              const waiting = o.speed <= 1 && oTo - CROSSWALK - o.v.len < 3;
              if (inBox || waiting || (o.speed > 1 && oTo / o.speed < 3)) {
                busy = true;
                busyBy = o;
                break;
              }
            }
          }
        }
        // a pursuit about to cross (or already in) this junction: hold even on green
        if (!busy)
          for (const o of specials) {
            // (one that's stuck in the junction isn't coming: holding for it would jam us both)
            if (o.park || o.stuckT > 2 || nodeOf(o, roadZ.length) !== node) continue;
            if (o.axis === c.axis && o.dir === c.dir && o.line === c.line) {
              // same approach: only a left turn crosses its line, and only if it's coming
              if (turnDir !== -1 || (c.s - o.s) * c.dir <= 0 || o.speed < 3) continue;
            }
            const oc = o.axis === 0 ? roadX : roadZ;
            const oBox = oc[o.next]!;
            const oDist = o.arc ? 0 : Math.max(0, (oBox.c - o.s) * o.dir - CURB[oBox.cls]);
            if (oDist / Math.max(2, o.speed) < 4.5) {
              busy = true;
              busyBy = o;
              break;
            }
          }
        if (busy) lim((stopCentre - c.s) * c.dir, busyBy);
      }
      // keep distance to whoever is ahead in our lane (pursuit cars weave: their real
      // footprint is checked below instead)
      for (const o of cars) {
        if (
          o === c ||
          o.role !== ROLE_NORMAL ||
          o.axis !== c.axis ||
          o.dir !== c.dir ||
          o.line !== c.line ||
          o.lane !== c.lane
        )
          continue;
        const ahead = (o.s - c.s) * c.dir;
        if (ahead <= 0) continue;
        lim(ahead - o.v.len / 2 - half - 2, o);
      }
      // specials weave and park at angles: watch their real footprint in our path
      if (specials.length)
        lim(
          (turnDir !== 0 || c.arc
            ? scanPath(c, specials, pathOf(c, geom, ownRoad, turnDir), 40, 0.3)
            : scanBand(c, specials, fx, fz, -hw - 0.3, hw + 0.3, 40)) - 1.5,
          scanHit,
        );
      // brake for any player standing in the lane
      const rx = -fz; // right-hand vector of the heading
      const rz = fx;
      for (let pi = 0; pi < env.players.length; pi++) {
        const who = env.players[pi]!;
        const dx = who.x - c.x;
        const dz = who.z - c.z;
        const a = dx * fx + dz * fz;
        const lat = dx * rx + dz * rz;
        if (a > 0 && a < half + 12 && Math.abs(lat) < hw + 0.9) {
          lim(a - half - 1.4, null);
          if (pi === 0 && a < half + 8) brakingForLocal.push(ci);
        }
      }
      // yield to sirens on our road: slow down and open a corridor
      let yieldTo = 0;
      if (!c.arc)
        for (const o of specials) {
          if (o.role !== ROLE_COP || o.park || o.arc || o.axis !== c.axis || o.line !== c.line)
            continue;
          const behind = (c.s - o.s) * c.dir;
          if (o.dir === c.dir && behind > -14 && behind < 75) {
            // stay aside until it's well past; slow right down only if it can actually get by
            // (if it's stuck right behind us, keep driving to clear the way)
            const canPass = Math.abs(o.lat - c.lat) > (o.v.wid + c.v.wid) / 2 + 0.2;
            yieldTo = Math.max(yieldTo, behind <= 0 ? 3 : !canPass ? 3 : behind < 35 ? 2 : 1);
          } else if (o.dir !== c.dir && behind < 0 && behind > -85) yieldTo = Math.max(yieldTo, 1);
        }
      if (yieldTo === 1 || yieldTo === 2) vcap = Math.min(vcap, yieldTo === 2 ? 1.5 : 5);
      const ls = LANES[ownRoad.cls];
      const pullDir = ls.length > 1 && c.lane === 0 ? -1 : 1; // inner lane toward the centre, else the kerb
      const off = ls[Math.min(c.lane, ls.length - 1)]!;
      // as far as the car's width allows: never onto the parking lane, over the centre line or the median
      const room2 =
        pullDir > 0
          ? ROAD_HALF[ownRoad.cls] - 0.3 - hw - off
          : off - hw - 0.15 - (ownRoad.cls === "main" ? MEDIAN : 0);
      const pullT = yieldTo && !c.arc ? Math.max(0, Math.min(PULL, room2)) : 0;
      c.pull += Math.max(-1.2 * dt, Math.min(1.2 * dt, pullT - c.pull));
      if (!c.arc) c.latT = laneOffset(ownRoad, c.axis, c.dir, c.lane) + sg * pullDir * c.pull;
    } else {
      // ---- pursuit vehicles ----
      const suspect = c.role === ROLE_SUSPECT;
      const tgt = c.chase && c.chase.target >= 0 ? cars[c.chase.target] : undefined;
      // side streets are narrow: a bit slower there
      if (ownRoad.cls === "side") vcap *= 0.85;
      if (tgt && tgt.axis === c.axis && tgt.dir === c.dir && tgt.line === c.line) {
        const ahead = (tgt.s - c.s) * c.dir;
        // right behind the suspect: match its pace instead of overtaking it
        if (ahead > 0 && ahead < 45) vcap = Math.min(vcap, tgt.speed + 4);
      }
      // the suspect is coming straight at us on this road: pull over to our kerb, let it
      // go by, then give chase (there are no U-turns in this city)
      const meet =
        !!tgt &&
        !c.park &&
        !c.arc &&
        tgt.axis === c.axis &&
        tgt.line === c.line &&
        tgt.dir !== c.dir &&
        (tgt.s - c.s) * c.dir > 0 &&
        (tgt.s - c.s) * c.dir < 100;
      if (meet) {
        const ls = LANES[ownRoad.cls];
        c.latT = clampLat(ownRoad, c.axis, c.dir, sg * (ls[ls.length - 1]! + PULL), c.v.wid);
        vcap = Math.min(vcap, 4);
      }
      if (c.park) {
        const kerb = clampLat(
          ownRoad,
          c.axis,
          c.dir,
          sg * (LANES[ownRoad.cls][LANES[ownRoad.cls].length - 1]! + PULL),
          c.v.wid,
        );
        if (c.park === 1) {
          c.latT = kerb;
          vcap = Math.max(0, c.speed - 7 * dt); // a firm but gentle stop (obstacles can make it harder)
        } else {
          const inset = c.park === 2 ? 1.3 : 2.6;
          c.latT = clampLat(ownRoad, c.axis, c.dir, kerb - sg * inset, c.v.wid);
          yawOffT = c.park === 2 ? -0.32 : 0.22; // nose toward the kerb, the second one splayed out
        }
      } else if (!c.arc && !nearArc && !meet) {
        c.swerve -= dt;
        if (suspect && c.swerve <= 0) {
          c.swerve = 1.8 + rand() * 2.5;
          c.pref = Math.floor(rand() * LANES[ownRoad.cls].length);
        }
        c.plan -= dt;
        if (c.plan <= 0) {
          c.plan = 0.2;
          let best = c.latT;
          let bestScore = -Infinity;
          // never on the wrong side close to a junction (cross traffic turns into those lanes)
          const prev = cross[c.next - c.dir];
          const nearBox =
            (cx - c.s) * c.dir - crossHalf < 30 + c.speed * 2.5 ||
            (prev !== undefined && (c.s - prev.c) * c.dir - CURB[prev.cls] < 15);
          // another pursuit coming the other way on this road: stay (or get back) on our side
          let headOn = Infinity;
          for (const o of specials)
            if (o !== c && o.axis === c.axis && o.line === c.line && o.dir !== c.dir && !o.arc) {
              const ahead = (o.s - c.s) * c.dir;
              if (ahead > 0) headOn = Math.min(headOn, ahead);
            }
          for (const line of specialLines(ownRoad, c.axis, c.dir, suspect, c.pref)) {
            const L = clampLat(ownRoad, c.axis, c.dir, line.lat, c.v.wid);
            const dl = (L - c.lat) * sg; // metres to our right
            const current = Math.abs(L - c.latT) < 0.3;
            const wrongSide = line.lat * sg < -0.5;
            if (wrongSide && !current && (nearBox || headOn < 150)) continue;
            if (
              !current &&
              // only the strip we newly move into (what's straight ahead is the free-distance check)
              !sideClear(c, cars, fx, fz, dl < 0 ? dl - hw - 0.3 : hw, dl < 0 ? -hw : dl + hw + 0.3)
            )
              continue;
            const free = scanBand(c, cars, fx, fz, dl - hw - 0.3, dl + hw + 0.3, 60, dA + 2);
            // only switch to a line we could still stop in
            if (!current && free < (c.speed * c.speed) / 24 + 3) continue;
            let score = Math.min(60, free) - line.cost;
            if (current) score += 3;
            if (wrongSide && headOn < 80) score -= 30;
            // cops sit on the suspect's line when it's just ahead
            if (tgt && Math.abs(tgt.lat - L) < 1 && tgt.axis === c.axis && tgt.line === c.line)
              score += 5;
            // swerve around people (but never brake for them)
            for (const p of env.players) {
              const dx = p.x - c.x;
              const dz = p.z - c.z;
              const a = dx * fx + dz * fz;
              const l = dx * -fz + dz * fx;
              if (a > 0 && a < 45 && Math.abs(l - dl) < hw + 1) score -= 25;
            }
            if (score > bestScore) {
              bestScore = score;
              best = L;
            }
          }
          c.latT = best;
        }
      }
      if (nearArc) c.latT = c.lat;
      // obstacles in the band we occupy or are moving into
      const dl = (c.latT - c.lat) * sg;
      const gap = c.park >= 2 ? 2.5 : 1.5;
      if (c.arc || turnDir !== 0) {
        // follow the actual path through the turn; before it, also the band we slide into
        lim(scanPath(c, cars, pathOf(c, geom, ownRoad, turnDir), 60, 0.3) - gap, scanHit);
      }
      if (!c.arc)
        lim(
          scanBand(
            c,
            cars,
            fx,
            fz,
            Math.min(0, dl) - hw - 0.3,
            Math.max(0, dl) + hw + 0.3,
            60,
            dA + 2,
          ) - gap,
          scanHit,
        );
      // two pursuits meeting at a junction from different directions: first to arrive goes
      const entry = Math.min(dA, (cx - c.s) * c.dir - crossHalf - half);
      if (!c.arc && entry > -0.5 && !c.park) {
        const myEta = Math.max(0, entry) / Math.max(4, c.speed);
        for (const o of specials) {
          if (o === c || o.park || o.stuckT > 2 || scanSkip.includes(o)) continue;
          if (nodeOf(o, roadZ.length) !== node) continue;
          if (o.axis === c.axis && o.dir === c.dir && o.line === c.line) continue;
          const oc = o.axis === 0 ? roadX : roadZ;
          const ob = oc[o.next]!;
          const oEntry = o.arc ? -1 : (ob.c - o.s) * o.dir - CURB[ob.cls] - o.v.len / 2;
          const oEta = oEntry <= 0 ? 0 : oEntry / Math.max(4, o.speed);
          const oi = index.get(o)!;
          if (oEta < 5 && (oEta < myEta || (oEta === myEta && oi < ci))) {
            lim(entry - 1, o);
            break;
          }
        }
      }
    }
    // big enemies (brutes, vanguards, elites, mini-boss, boss) are obstacles: brake for them
    for (const e of env.enemies) {
      if (!e.alive || !e.big) continue;
      const dx = e.x - c.x;
      const dz = e.z - c.z;
      const a = dx * fx + dz * fz;
      if (a > 0 && a < half + e.r + 9 && Math.abs(dx * -fz + dz * fx) < hw + e.r + 0.3)
        lim(a - half - e.r - 0.8, null);
    }
    // slow for the corner
    if (geom) {
      const toArc = (geom.sStart - c.s) * c.dir;
      const vT = Math.max(special ? 7 : 4, Math.sqrt((special ? 11 : 4.5) * geom.R));
      vcap = Math.min(vcap, Math.sqrt(vT * vT + 2 * (special ? 10 : 4) * Math.max(0, toArc)));
    }

    // ---- lateral motion ----
    if (!c.arc) {
      // a car can only move sideways as fast as it steers: keep it to ~17 degrees of travel
      // (a stuck pursuit car may shuffle sideways to get out of a jam)
      const rate = Math.min(
        special ? 3.2 : 1.6,
        Math.max(0.1 + c.speed * 0.3, special && c.stuckT > 1.5 ? 1 : 0),
      );
      const want = Math.max(-rate, Math.min(rate, (c.latT - c.lat) * 2.5));
      c.latV += (want - c.latV) * Math.min(1, dt * 6);
      c.lat += c.latV * dt;
      if (special) {
        // the lane others see us in: the nearest of our own lanes
        const ls = LANES[ownRoad.cls];
        let k = 0;
        for (let i = 1; i < ls.length; i++)
          if (Math.abs(ls[i]! - c.lat * sg) < Math.abs(ls[k]! - c.lat * sg)) k = i;
        c.lane = k;
      }
    }

    // ---- speed ----
    const aPlan = special ? 11 : 7;
    const target = Math.min(vcap, Math.sqrt(Math.max(0, 2 * aPlan * room)));
    const v0 = c.speed;
    const accel = special ? (c.v.type === "sports" ? 8 : 6.5) : 3.5;
    const decel = special ? 14 : 16;
    if (c.speed < target) c.speed = Math.min(target, c.speed + accel * dt);
    else c.speed = Math.max(target, c.speed - decel * dt);
    if (c.speed < 0) c.speed = 0;
    c.blocker = who;
    c.stuckT = c.speed < 0.3 && target < 0.5 ? c.stuckT + dt : 0;
    let move = ((v0 + c.speed) / 2) * dt;
    // never roll past a stop line (or the car ahead) we're braking for: the speed curve
    // alone can overshoot by a few centimetres, and a coarse far step by metres
    if (!special && !committed && room < Infinity) move = Math.min(move, Math.max(0, room));

    // ---- longitudinal motion ----
    if (c.arc) advanceArc(c, move, roadX, roadZ);
    else {
      c.s += c.dir * move;
      if (geom && turnDir !== 0) {
        const over = (c.s - geom.sStart) * c.dir;
        if (over >= 0) {
          startArc(c, geom, ownRoad, turnDir);
          advanceArc(c, over, roadX, roadZ);
        }
      } else if ((c.s - cx) * c.dir > crossHalf + half) {
        c.next += c.dir;
        c.turn = null;
        if (c.next < 0 || c.next >= cross.length) {
          c.dir = -c.dir as 1 | -1;
          c.next = Math.max(0, Math.min(cross.length - 1, c.next - c.dir * 2));
          c.lat = laneOffset(ownRoad, c.axis, c.dir, c.lane);
          c.latT = c.lat;
        }
      }
    }
    if (!c.arc) {
      const p = posOf(c, roadX, roadZ);
      c.x = p.x;
      c.z = p.z;
    }
    // parked angle eases in (and back out once the pursuit is over)
    // (a car only turns its body while rolling, never on the spot)
    const yr = Math.min(1.2, c.speed * 0.35) * dt;
    c.yawOff += Math.max(-yr, Math.min(yr, yawOffT - c.yawOff));
    // a hint of steering while changing lanes; long vehicles swing their corners less
    const maxSteer = Math.min(0.3, 0.3 / half);
    const steer = c.arc
      ? 0
      : Math.max(
          -maxSteer,
          Math.min(maxSteer, Math.atan2(c.latV * laneSign(c.axis, c.dir), Math.max(1, c.speed))),
        );
    c.yaw = travelYaw(c) - steer + c.yawOff;

    // contact with enemies (host only supplies the callback)
    if (env.onEnemyContact && c.speed > 0.5) {
      const sin = Math.sin(c.yaw);
      const cos = Math.cos(c.yaw);
      for (let ei = 0; ei < env.enemies.length; ei++) {
        const e = env.enemies[ei]!;
        if (!e.alive) continue;
        const ex = e.x - c.x;
        const ez = e.z - c.z;
        if (Math.abs(ex * sin + ez * cos) > half + e.r || Math.abs(ex * cos - ez * sin) > hw + e.r)
          continue;
        if (e.big) {
          // hitting something that big stops the car dead
          c.speed = 0;
          env.onEnemyContact(c, ei, true);
        } else if (c.speed > 3) {
          env.onEnemyContact(c, ei, false);
          c.speed *= special ? 0.9 : 0.7;
        }
      }
    }
  }
  return brakingForLocal;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic starting traffic for a city (the same on every client for a seed). */
export function spawnTraffic(
  roadX: Road[],
  roadZ: Road[],
  spawn: { x: number; z: number },
  seed: number,
  /** fixed number of cars (a quiet coast road wants fewer than a downtown grid) */
  count?: number,
) {
  const rand = mulberry(seed ^ 0x51f15e);
  const list: Car[] = [];
  if (roadX.length < 2 || roadZ.length < 2) return list;
  // about one car per 45 m of street, 40-60 in all
  const len =
    (roadX.length * (roadZ[roadZ.length - 1]!.c - roadZ[0]!.c) +
      roadZ.length * (roadX[roadX.length - 1]!.c - roadX[0]!.c)) *
    2;
  const want = count ?? Math.max(40, Math.min(60, Math.round(len / 45)));
  for (let tries = 0; list.length < want && tries < 2000; tries++) {
    const axis = (rand() < 0.5 ? 0 : 1) as 0 | 1;
    const dir = (rand() < 0.5 ? 1 : -1) as 1 | -1;
    const line = Math.floor(rand() * (axis === 0 ? roadZ.length : roadX.length));
    const road = (axis === 0 ? roadZ : roadX)[line]!;
    const lane = Math.floor(rand() * LANES[road.cls].length);
    const cross = axis === 0 ? roadX : roadZ;
    const lo = cross[0]!.c;
    const hi = cross[cross.length - 1]!.c;
    const s = lo + 5 + rand() * (hi - lo - 10);
    // never start inside an intersection
    if (cross.some((c) => Math.abs(c.c - s) < CURB[c.cls] + 3)) continue;
    const perp = road.c + laneOffset(road, axis, dir, lane);
    const x = axis === 0 ? s : perp;
    const z = axis === 0 ? perp : s;
    if (Math.hypot(x - spawn.x, z - spawn.z) < 12) continue;
    // about one car in nine is a patrol cruiser (on top of the random ones), so there are
    // always spare cruisers for pursuits while most of them keep patrolling
    const v = makeVehicle(rand, Infinity, list.length % 9 === 4 ? ["police"] : undefined)!;
    if (
      list.some(
        (o) =>
          o.axis === axis &&
          o.dir === dir &&
          o.line === line &&
          o.lane === lane &&
          Math.abs(o.s - s) < (o.v.len + v.len) / 2 + 5,
      )
    )
      continue;
    let next = dir > 0 ? cross.findIndex((c) => c.c > s) : -1;
    if (dir < 0)
      for (let k = cross.length - 1; k >= 0; k--)
        if (cross[k]!.c < s) {
          next = k;
          break;
        }
    if (next < 0) continue;
    // real city speeds: ~40-50 km/h
    const vmax = v.type === "bus" ? 9 : v.type === "van" ? 10.5 : v.type === "sports" ? 14 : 12.5;
    const car = makeCar(v, vehicleHeight(v), road, axis, dir, line, lane, s, vmax, next);
    // start slow enough to stop at the first stop line (it may be red)
    const nx = cross[next]!;
    const toStop = (nx.c - s) * dir - CURB[nx.cls] - CROSSWALK - v.len / 2;
    car.speed = Math.min(car.speed, Math.sqrt(2 * 5 * Math.max(0, toStop)));
    list.push(car);
  }
  return list;
}

/**
 * Flag cars far from every player (they step at a quarter of the rate). Pursuit cars and
 * any car near one always step at the full rate, so a fast chase never meets a car that
 * only moves every fourth step (that let a suspect slide through a far car).
 */
export function markFar(cars: Car[], players: { x: number; z: number }[], range: number) {
  const near = (x: number, z: number, list: { x: number; z: number }[], r: number) =>
    list.some((p) => Math.abs(p.x - x) < r && Math.abs(p.z - z) < r);
  const specials = cars.filter((c) => c.role !== ROLE_NORMAL);
  for (const c of cars)
    c.far =
      c.role === ROLE_NORMAL && !near(c.x, c.z, players, range) && !near(c.x, c.z, specials, 70);
}
