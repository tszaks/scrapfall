// The Dry Gulch freight: a pure function of one shared clock. No three.js, no React.
//
// Trains run on a timetable generated from the arena seed: one every 60-90 s, alternating
// direction at random, at a steady 17 m/s (a hard-running 1880s freight). Where every car is
// at any moment follows from the clock alone, so co-op guests only need the host's clock
// (and, on the boss wave, the time the Iron Marshal's train pulls in) to see the same train.
// The host (or solo player) advances the clock at a fixed step; see Train.tsx.
import { RAIL_X } from "./layout";

export const TRAIN_SPEED = 17;
/** first train arrives this long after the arena starts */
const FIRST = 26;
/** gap between trains, seconds */
const GAP_MIN = 60;
const GAP_MAX = 90;
/** the loco is this far (in time) from the line's first open-air portal when it whistles */
export const WHISTLE_LEAD = 12;
/** boss train: brakes at this rate to stop at the platform, waits, then pulls out */
const BRAKE = 1.25;
const PULL = 0.7;
const DWELL = 16;

export type CarKind =
  "loco" | "tender" | "box" | "flat" | "tank" | "stock" | "gondola" | "caboose" | "armored";
export type CarSpec = { kind: CarKind; len: number; w: number; h: number; tint: number };
const SPEC: Record<CarKind, { len: number; w: number; h: number }> = {
  loco: { len: 12.6, w: 3.0, h: 5.4 },
  tender: { len: 7.2, w: 2.9, h: 3.6 },
  box: { len: 11.2, w: 3.0, h: 4.3 },
  flat: { len: 11.2, w: 2.9, h: 3.1 },
  tank: { len: 10.4, w: 2.9, h: 3.9 },
  stock: { len: 11.2, w: 3.0, h: 4.3 },
  gondola: { len: 10.6, w: 2.9, h: 2.4 },
  caboose: { len: 9.4, w: 3.0, h: 4.9 },
  armored: { len: 12.0, w: 3.1, h: 4.6 },
};
/** gap between coupled cars */
export const COUPLE = 1.1;

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Run = {
  /** run number (the timetable index), -1 for the boss train */
  k: number;
  /** when the loco front passes the entry portal */
  arrive: number;
  dir: 1 | -1;
  cars: CarSpec[];
  /** total length, loco front to caboose tail */
  length: number;
};

export function consist(seed: number, k: number, boss = false): CarSpec[] {
  const r = mulberry(seed * 31 + k * 7919 + 17);
  const cars: CarSpec[] = [
    { kind: "loco", ...SPEC.loco, tint: r() },
    { kind: "tender", ...SPEC.tender, tint: r() },
  ];
  if (boss) {
    cars.push({ kind: "armored", ...SPEC.armored, tint: 0 });
    cars.push({ kind: "box", ...SPEC.box, tint: 0.1 });
    cars.push({ kind: "caboose", ...SPEC.caboose, tint: 0 });
    return cars;
  }
  const n = 8 + Math.floor(r() * 5);
  const pool: CarKind[] = ["box", "box", "box", "flat", "tank", "stock", "gondola", "flat", "box"];
  for (let i = 0; i < n; i++) {
    const kind = pool[Math.floor(r() * pool.length)]!;
    cars.push({ kind, ...SPEC[kind], tint: r() });
  }
  cars.push({ kind: "caboose", ...SPEC.caboose, tint: r() });
  return cars;
}
const lengthOf = (cars: CarSpec[]) =>
  cars.reduce((s, c) => s + c.len, 0) + COUPLE * (cars.length - 1);

/** Shared train state. The host advances `t`; guests copy it (and `bossAt`) from snapshots. */
export const trainClock = { t: 0, bossAt: -1, bossFrom: -1 };

/** the train line's geometry (set once per arena by the renderer) */
export const trainLine = {
  /** z of the entry portals, north and south (where a run "arrives") */
  north: -200,
  south: 270,
  /** z of the loco's front when the boss train stands at the platform */
  stop: -24,
  /** how far past the portals the timetable keeps trains alive */
  reach: 700,
  seed: 1,
};

/** The timetable up to time `t` (plus one run ahead): deterministic from the seed. */
let cache: { seed: number; runs: Run[]; until: number } = { seed: -1, runs: [], until: 0 };
function timetable(t: number) {
  if (cache.seed !== trainLine.seed) cache = { seed: trainLine.seed, runs: [], until: 0 };
  const r = mulberry(trainLine.seed ^ 0x7a11);
  // regenerate deterministically from the start (cheap: a few dozen runs per game)
  if (cache.until < t + 200) {
    const runs: Run[] = [];
    let at = FIRST;
    let k = 0;
    while (at < t + 400) {
      const dir: 1 | -1 = r() < 0.5 ? 1 : -1;
      const cars = consist(trainLine.seed, k);
      runs.push({ k, arrive: at, dir, cars, length: lengthOf(cars) });
      at += GAP_MIN + r() * (GAP_MAX - GAP_MIN);
      k++;
    }
    cache = { seed: trainLine.seed, runs, until: at };
  }
  return cache.runs;
}

/** the boss train as a run (north to south, stopping at the platform) */
function bossRun(): Run | null {
  if (trainClock.bossAt < 0) return null;
  const cars = consist(trainLine.seed, 999, true);
  return { k: -1, arrive: trainClock.bossAt, dir: 1, cars, length: lengthOf(cars) };
}
/** loco front position along the line (z) for a run at time t */
export function frontOf(run: Run, t: number) {
  if (run.k >= 0) {
    const entry = run.dir > 0 ? trainLine.north : trainLine.south;
    return entry + run.dir * TRAIN_SPEED * (t - run.arrive);
  }
  // the boss train: `arrive` is the moment it stands still at the platform
  const v = TRAIN_SPEED;
  const tb = v / BRAKE; // braking time
  const db = (v * v) / (2 * BRAKE);
  const stop = trainLine.stop;
  const dt = t - run.arrive;
  if (dt < -tb) return stop - db + v * (dt + tb);
  if (dt < 0) return stop - 0.5 * BRAKE * dt * dt;
  if (dt < DWELL) return stop;
  const u = dt - DWELL;
  const tp = v / PULL;
  if (u < tp) return stop + 0.5 * PULL * u * u;
  return stop + (v * v) / (2 * PULL) + v * (u - tp);
}
/** loco speed (m/s) for a run at time t (for the wheels, the chuffing and the smoke) */
export function speedOf(run: Run, t: number) {
  if (run.k >= 0) return TRAIN_SPEED;
  const v = TRAIN_SPEED;
  const dt = t - run.arrive;
  const tb = v / BRAKE;
  if (dt < -tb) return v;
  if (dt < 0) return -BRAKE * dt;
  if (dt < DWELL) return 0;
  return Math.min(v, PULL * (dt - DWELL));
}

/** a run is "live" while any of it could be seen: from well before the first portal to past the last */
function live(run: Run, t: number) {
  const f = frontOf(run, t);
  const tail = f - run.dir * run.length;
  const lo = trainLine.north - trainLine.reach;
  const hi = trainLine.south + trainLine.reach;
  return run.dir > 0 ? f > lo && tail < hi : f < hi && tail > lo;
}

/** every train that is on the line at time t (regular runs are suppressed round the boss train) */
export function trainsAt(t: number): Run[] {
  const out: Run[] = [];
  const boss = bossRun();
  for (const run of timetable(t)) {
    if (run.arrive > t + 60) break;
    // runs due after the boss train was called, until it has pulled out, are cancelled
    if (boss && run.arrive > trainClock.bossFrom - 1 && run.arrive < boss.arrive + DWELL + 45)
      continue;
    if (live(run, t)) out.push(run);
  }
  if (boss && live(boss, t)) out.push(boss);
  return out;
}

/** per-car centre positions along the line, front first */
export function carCentres(run: Run, t: number) {
  const f = frontOf(run, t);
  const out: number[] = [];
  let s = 0;
  for (const c of run.cars) {
    out.push(f - run.dir * (s + c.len / 2));
    s += c.len + COUPLE;
  }
  return out;
}

/**
 * Host: call the Iron Marshal's train. It rolls out of the north canyon and stops at the
 * platform; returns the seconds until it stands there (the boss steps off then). If a
 * regular train is still on the line, the boss train waits until it has cleared.
 */
export function callBossTrain(now: number) {
  let at = now + 24;
  // a train already out on the line runs on; the boss train follows once it's out of the way:
  // a northbound one must be back in the north tunnel, a southbound one past the station
  for (const run of timetable(now)) {
    if (run.arrive > now) break;
    if (!live(run, now)) continue;
    const clear = (t: number) => {
      const tail = frontOf(run, t) - run.dir * run.length;
      return run.dir > 0 ? tail > trainLine.stop + 40 : tail < trainLine.north - 20;
    };
    let end = now;
    while (end < now + 120 && !clear(end)) end += 0.5;
    // the boss train takes ~24 s from the call to stand at the platform; it may leave the
    // tunnel once the line is clear
    at = Math.max(at, end + (run.dir > 0 ? 6 : 20));
  }
  trainClock.bossAt = at;
  trainClock.bossFrom = now;
  return at - now;
}
/** where the boss steps off: on the platform beside the armored car */
export function bossSpot() {
  return { x: RAIL_X - 7.5, z: trainLine.stop - 26 };
}

/** whistle cues for a run: times at which the loco blows (long, long, short, long) */
export function whistles(run: Run) {
  // (the boss train is called only ~24 s out, so all three cues fall inside that window)
  if (run.k < 0) return [run.arrive - 21, run.arrive - 13, run.arrive - 4];
  return [run.arrive - WHISTLE_LEAD, run.arrive - WHISTLE_LEAD + 2.2, run.arrive - 1.5];
}
