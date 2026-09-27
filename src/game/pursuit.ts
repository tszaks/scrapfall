// Police pursuits on the city map. The host (or solo player) runs this director once per
// fixed traffic step; guests only see the result through the car snapshot flags.
//
// A pursuit = a fleeing SUSPECT (a random civilian car turned reckless) plus one or two
// patrol cruisers that switch their lights and siren on and chase it. After a while the
// suspect gives up: it pulls over at the kerb mid-block, the lead cruiser parks angled
// behind it (lights still flashing) and a few seconds later everyone goes back to
// normal traffic. 1-3 pursuits run at once, and new ones start near a player.
import { CURB } from "./cityLayout";
import {
  ROLE_COP,
  ROLE_NORMAL,
  ROLE_SUSPECT,
  type Car,
  type SimEnv,
  type Trail,
} from "./trafficSim";

/** 0 chasing, 1 suspect is giving up (slows, waits for a mid-block spot), 2 caught scene */
export type Pursuit = {
  id: number;
  suspect: number;
  cops: number[];
  t0: number;
  dur: number;
  phase: 0 | 1 | 2;
  tc: number;
  /** when the lead cruiser stopped behind the suspect (the caught scene starts) */
  parkedAt: number;
  trail: Trail;
};
export type Director = {
  list: Pursuit[];
  nextStart: number;
  nextId: number;
  rand: () => number;
  /** debug: what happened when (read by the test tooling) */
  log: { t: number; id: number; ev: string }[];
};

const MAX_PURSUITS = 3;
/** a chase this far from every player has left the play area: it just ends */
const GONE = 450;
const CAUGHT_HOLD = 6;

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newDirector(seed: number): Director {
  return { list: [], nextStart: 4, nextId: 1, rand: mulberry(seed ^ 0x9011ce), log: [] };
}

const nearestPlayer = (c: Car, env: SimEnv) => {
  let d = Infinity;
  for (const p of env.players) d = Math.min(d, Math.hypot(p.x - c.x, p.z - c.z));
  return d;
};

function release(d: Director, p: Pursuit, cars: Car[], t: number, why: string) {
  for (const i of [p.suspect, ...p.cops]) {
    const c = cars[i];
    if (!c) continue;
    c.role = ROLE_NORMAL;
    c.chase = null;
    c.park = 0;
    c.vmax = c.baseVmax;
    c.turn = c.arc ? c.turn : null;
  }
  d.log.push({ t, id: p.id, ev: why });
  if (d.log.length > 200) d.log.shift();
}

function tryStart(d: Director, cars: Car[], env: SimEnv, t: number) {
  const r = d.rand;
  const busy = new Set<number>();
  for (const p of d.list) [p.suspect, ...p.cops].forEach((i) => busy.add(i));
  // a suspect somewhere a player will see it: 60-230 m out, moving, mid-block
  const cands: number[] = [];
  cars.forEach((c, i) => {
    if (busy.has(i) || c.role !== ROLE_NORMAL || c.arc || c.speed < 3) return;
    if (c.v.type === "police" || c.v.type === "bus") return;
    const d0 = nearestPlayer(c, env);
    if (d0 > 60 && d0 < 230) cands.push(i);
  });
  if (cands.length === 0) return false;
  const si = cands[Math.floor(r() * cands.length)]!;
  const sus = cars[si]!;
  // the nearest patrol cruisers respond
  const cops = cars
    .map((c, i) => ({ c, i, d: Math.hypot(c.x - sus.x, c.z - sus.z) }))
    .filter(({ c, i }) => !busy.has(i) && c.v.type === "police" && c.role === ROLE_NORMAL && !c.arc)
    .filter(({ d }) => d < 400)
    .sort((a, b) => a.d - b.d);
  if (cops.length === 0) return false;
  const n = cops.length > 1 && r() < 0.45 ? 2 : 1;
  const trail: Trail = [];
  const p: Pursuit = {
    id: d.nextId++,
    suspect: si,
    cops: cops.slice(0, n).map((o) => o.i),
    t0: t,
    dur: 32 + r() * 26,
    phase: 0,
    tc: 0,
    parkedAt: 0,
    trail,
  };
  sus.role = ROLE_SUSPECT;
  sus.chase = { target: -1, trail };
  sus.vmax = sus.v.type === "sports" ? 25.5 : 22 + r() * 2;
  sus.swerve = 0;
  sus.plan = 0;
  for (const ci of p.cops) {
    const c = cars[ci]!;
    c.role = ROLE_COP;
    c.chase = { target: si, trail };
    c.vmax = 26.5 + r() * 1.5;
    c.plan = 0;
    if (!c.arc) c.turn = null;
  }
  d.list.push(p);
  d.log.push({ t, id: p.id, ev: `start suspect=${si} cops=${p.cops.join(",")}` });
  return true;
}

/** is the suspect somewhere it can pull over (mid-block, not near a junction)? */
function midBlock(c: Car, env: SimEnv) {
  if (c.arc) return false;
  const cross = c.axis === 0 ? env.roadX : env.roadZ;
  const nextBox = cross[c.next]!;
  if ((nextBox.c - c.s) * c.dir - CURB[nextBox.cls] < 24) return false;
  const prev = cross[c.next - c.dir];
  // room behind it for the cruisers too, so nobody parks in the junction
  if (prev && (c.s - prev.c) * c.dir - CURB[prev.cls] < 22) return false;
  return true;
}

export function stepDirector(d: Director, cars: Car[], env: SimEnv, t: number) {
  for (let k = d.list.length - 1; k >= 0; k--) {
    const p = d.list[k]!;
    const sus = cars[p.suspect]!;
    const age = t - p.t0;
    let done: string | null = null;
    if (p.phase < 2 && age > 8 && nearestPlayer(sus, env) > GONE) done = "left the area";
    else if (p.phase === 0 && age > p.dur) {
      p.phase = 1;
      sus.vmax = 11; // giving up: lets the cruiser close in
      d.log.push({ t, id: p.id, ev: "giving up" });
    } else if (p.phase === 1) {
      // pull over once mid-block with a cruiser close by
      const near = p.cops.some((i) => Math.hypot(cars[i]!.x - sus.x, cars[i]!.z - sus.z) < 70);
      if (near && midBlock(sus, env)) {
        p.phase = 2;
        p.tc = t;
        sus.park = 1;
        d.log.push({ t, id: p.id, ev: "pulling over" });
      } else if (age > p.dur + 35) done = "gave up waiting";
    } else if (p.phase === 2) {
      // cruisers on the suspect's road, behind it, pull in: the first angled right behind
      // the suspect, a second one behind that
      const onTail = (c: Car, max: number) => {
        const behind = (sus.s - c.s) * sus.dir;
        return (
          !c.arc &&
          c.axis === sus.axis &&
          c.dir === sus.dir &&
          c.line === sus.line &&
          behind > 0 &&
          behind < max
        );
      };
      const cops = p.cops
        .map((i) => cars[i]!)
        .sort((x, y) => (sus.s - x.s) * sus.dir - (sus.s - y.s) * sus.dir);
      let rank: 2 | 3 = 2;
      for (const c of cops) {
        if (c.park === 0 && onTail(c, 70)) c.park = rank;
        if (c.park) rank = 3;
      }
      const lead = cops.find((c) => c.park === 2);
      if (lead && !p.parkedAt && lead.speed < 0.3 && sus.speed < 0.3) {
        p.parkedAt = t;
        d.log.push({ t, id: p.id, ev: "caught" });
      }
      if (p.parkedAt && t - p.parkedAt > CAUGHT_HOLD) done = "released";
      else if (t - p.tc > (p.parkedAt ? 30 : 14)) done = "released (no cruiser arrived)";
    }
    if (done) {
      release(d, p, cars, t, done);
      d.list.splice(k, 1);
    }
  }
  if (d.list.length < MAX_PURSUITS && t >= d.nextStart) {
    const ok = tryStart(d, cars, env, t);
    // keep at least one chase going; extra ones every so often
    const n = d.list.length;
    d.nextStart = t + (!ok ? 3 : n === 0 ? 5 : n === 1 ? 14 + d.rand() * 14 : 25 + d.rand() * 20);
  } else if (d.list.length === 0 && d.nextStart > t + 6) d.nextStart = t + 6;
}
