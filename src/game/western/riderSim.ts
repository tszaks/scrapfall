// Dry Gulch's street life: riders, buckboards and the stagecoach moving about town on the
// roads (Main Street, the cross street, the back streets, the east road), and now and then a
// sheriff's POSSE running down an OUTLAW through town - the Western's answer to Vice Heights'
// traffic and police pursuits. A small host-authoritative simulation (fixed steps, like the
// train); guests get the state in the host's snapshots.
//
// Everyone keeps to the right-hand side of the road. At a junction a rider picks a way on (not
// straight back); at the end of a street they swing round and come back.

import { streetNet } from "./streets";

export type Kind = 0 | 1 | 2; // rider, buckboard, stagecoach
export const ROLE_TOWN = 0;
export const ROLE_OUTLAW = 1;
export const ROLE_POSSE = 2;
export type Role = 0 | 1 | 2;

export type Node = { x: number; z: number; e: number[] };
export type Edge = { a: number; b: number; len: number; lane: number };
export type Net = { nodes: Node[]; edges: Edge[] };

/** the road network through town: the full street grid (streets.ts), solo-safe (every end
 * is inside the blockades) */
export function roadNet(): Net {
  return streetNet();
}

export type Agent = {
  kind: Kind;
  role: Role;
  /** edge, direction along it (+1 = a -> b), distance travelled along it */
  e: number;
  dir: 1 | -1;
  s: number;
  speed: number;
  /** cruising speed */
  vmax: number;
  /** lateral offset from the road's centre line (eases toward the lane on a turn) */
  lat: number;
  /** stopped (a caught outlaw, a posse round him) until this sim time */
  hold: number;
  /** leg phase for the gait */
  ph: number;
  /** a chase rider swings into the other lane to pass slower traffic until this time */
  pass: number;
  /** look: coat / paint pick */
  look: number;
  /** a turn's leftover offset, easing out (so a corner is a curve, not a jump) */
  ox: number;
  oz: number;
  /** world pose, derived each step */
  x: number;
  z: number;
  yaw: number;
};

export function pose(net: Net, a: Agent) {
  const ed = net.edges[a.e]!;
  const na = net.nodes[a.dir > 0 ? ed.a : ed.b]!;
  const nb = net.nodes[a.dir > 0 ? ed.b : ed.a]!;
  const t = Math.min(1, Math.max(0, a.s / ed.len));
  const dx = (nb.x - na.x) / ed.len;
  const dz = (nb.z - na.z) / ed.len;
  // right-hand lane: to the right of the direction of travel ((dx, dz) rotated -90 degrees)
  const rx = -dz;
  const rz = dx;
  a.x = na.x + (nb.x - na.x) * t + rx * a.lat + a.ox;
  a.z = na.z + (nb.z - na.z) * t + rz * a.lat + a.oz;
  // (heading follows the curve while the turn's offset eases out)
  const yaw = Math.atan2(dx, dz);
  if (Math.hypot(a.ox, a.oz) > 0.05) {
    const ty = Math.atan2(dx * 6 - a.ox, dz * 6 - a.oz);
    a.yaw = ty;
  } else a.yaw = yaw;
}

/** half-length / half-width / height of each kind's box (for bumps and bullets) */
export const BOX: Record<Kind, { hl: number; hw: number; h: number }> = {
  0: { hl: 1.25, hw: 0.45, h: 2.5 },
  1: { hl: 3.2, hw: 0.9, h: 2.2 },
  2: { hl: 4.4, hw: 1.05, h: 2.9 },
};

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Sim = {
  net: Net;
  agents: Agent[];
  t: number;
  r: () => number;
  /** the pursuit, while one runs */
  chase: { next: number; start: number; caught: number; end: number; x: number; z: number };
  /** posse shots this step (for sound and muzzle flashes): world points */
  shots: { x: number; z: number; tx: number; tz: number }[];
  /** banner events for the HUD */
  events: string[];
};

export const TOWNFOLK = 7;

export function newSim(seed: number): Sim {
  const net = roadNet();
  const r = rng(seed ^ 0x7a11);
  const agents: Agent[] = [];
  for (let i = 0; i < TOWNFOLK; i++) {
    const kind: Kind = i === 0 ? 2 : i < 3 ? 1 : 0;
    const e = Math.floor(r() * net.edges.length);
    const ed = net.edges[e]!;
    agents.push({
      kind,
      role: ROLE_TOWN,
      e,
      dir: r() < 0.5 ? 1 : -1,
      s: r() * ed.len,
      speed: 0,
      vmax: kind === 0 ? 4 + r() * 1.5 : kind === 1 ? 3.2 : 4.2,
      lat: ed.lane,
      hold: 0,
      ph: r() * 6,
      pass: 0,
      look: Math.floor(r() * 6),
      ox: 0,
      oz: 0,
      x: 0,
      z: 0,
      yaw: 0,
    });
  }
  // the pursuit's riders wait off stage (hold = Infinity) until one starts
  for (let i = 0; i < 4; i++)
    agents.push({
      kind: 0,
      role: i === 0 ? ROLE_OUTLAW : ROLE_POSSE,
      e: 3,
      dir: -1,
      s: 0,
      speed: 0,
      vmax: i === 0 ? 8.8 : 9.4,
      lat: 1.8,
      hold: Infinity,
      ph: r() * 6,
      pass: 0,
      look: i,
      ox: 0,
      oz: 0,
      x: 1e4,
      z: 1e4,
      yaw: 0,
    });
  for (const a of agents) pose(net, a);
  for (const a of agents) if (a.hold === Infinity) a.x = a.z = 1e4;
  return {
    net,
    agents,
    t: 0,
    r,
    chase: { next: 70 + r() * 40, start: -1, caught: -1, end: -1, x: 0, z: 0 },
    shots: [],
    events: [],
  };
}

/** an obstacle the riders brake for (players), or knock aside (enemies) */
export type Body = { x: number; z: number; r: number };

const onStage = (a: Agent) => a.hold !== Infinity;

/** pick the way on at the end of an edge (not straight back unless it's a dead end) */
function nextEdge(sim: Sim, a: Agent, prefer?: (e: number, far: number) => number) {
  const ed = sim.net.edges[a.e]!;
  const at = a.dir > 0 ? ed.b : ed.a;
  const node = sim.net.nodes[at]!;
  const opts = node.e.filter((e) => e !== a.e);
  if (!opts.length) {
    // the end of the street: swing round (in a curve across the road)
    a.dir = a.dir > 0 ? -1 : 1;
    a.s = ed.len - a.s;
    a.lat = -a.lat;
    return;
  }
  let pickE = opts[Math.floor(sim.r() * opts.length)]!;
  if (prefer) {
    let best = -Infinity;
    for (const e of opts) {
      const oe = sim.net.edges[e]!;
      const far = oe.a === at ? oe.b : oe.a;
      const sc = prefer(e, far) + sim.r() * 0.2;
      if (sc > best) {
        best = sc;
        pickE = e;
      }
    }
  }
  const ne = sim.net.edges[pickE]!;
  a.e = pickE;
  a.dir = ne.a === at ? 1 : -1;
  a.s = 0;
}

export function stepSim(sim: Sim, dt: number, players: Body[]) {
  sim.t += dt;
  sim.shots.length = 0;
  const t = sim.t;
  const A = sim.agents;
  const outlaw = A[TOWNFOLK]!;
  const posse = A.slice(TOWNFOLK + 1);
  // ---- the pursuit director ----
  const C = sim.chase;
  if (C.start < 0 && t > C.next) {
    // the outlaw bursts out of the far end of a street, the posse hard behind
    const ends = [3, 7, 10, 5]; // the east road, the north end, the south end, the north back street's west end
    const e = ends[Math.floor(sim.r() * ends.length)]!;
    const ed = sim.net.edges[e]!;
    const deadEnd = sim.net.nodes[ed.b]!.e.length === 1 ? ed.b : ed.a;
    const dir: 1 | -1 = ed.b === deadEnd ? -1 : 1;
    const start = (a: Agent, back: number) => {
      a.e = e;
      a.dir = dir;
      a.s = back;
      a.speed = a.vmax * 0.7;
      a.hold = 0;
      a.lat = ed.lane;
      pose(sim.net, a);
    };
    start(outlaw, 6);
    posse.forEach((p, i) => {
      start(p, 0);
      p.s = -6 - i * 5;
    });
    C.start = t;
    C.caught = -1;
    C.end = -1;
    sim.events.push("chase");
  }
  // ---- everyone moves ----
  for (const a of A) {
    if (!onStage(a)) continue;
    if (a.hold > t) {
      a.speed = Math.max(0, a.speed - 6 * dt);
    } else {
      // brake for anything in the lane ahead: players, a slower rider, a stopped coach
      const hx = Math.sin(a.yaw);
      const hz = Math.cos(a.yaw);
      const look = 3 + a.speed * 1.4 + BOX[a.kind].hl;
      let block = Infinity;
      for (const p of players) {
        const dx = p.x - a.x;
        const dz = p.z - a.z;
        const along = dx * hx + dz * hz;
        const lat = Math.abs(dx * hz - dz * hx);
        if (along > 0 && along < look && lat < BOX[a.kind].hw + p.r + 0.3)
          block = Math.min(block, along);
      }
      for (const o of A) {
        if (o === a || !onStage(o)) continue;
        // (the outlaw doesn't wait for the posse; the posse ride behind him and each other)
        if (a.role === ROLE_OUTLAW && o.role === ROLE_POSSE) continue;
        const dx = o.x - a.x;
        const dz = o.z - a.z;
        const along = dx * hx + dz * hz;
        const lat = Math.abs(dx * hz - dz * hx);
        if (
          along > 0 &&
          along < look + BOX[o.kind].hl &&
          lat < BOX[a.kind].hw + BOX[o.kind].hw + 0.2
        ) {
          // a chase rider doesn't queue behind a buckboard: he swings out and passes
          if (a.role !== ROLE_TOWN && o.role === ROLE_TOWN) {
            a.pass = t + 3;
            if (along > 3) continue;
          }
          block = Math.min(block, along - BOX[o.kind].hl);
        }
      }
      const gap = block - BOX[a.kind].hl - 1;
      const want = gap < 0.5 ? 0 : Math.min(a.vmax, gap * 0.9);
      const acc = want > a.speed ? 2.2 : 7;
      a.speed += Math.sign(want - a.speed) * Math.min(Math.abs(want - a.speed), acc * dt);
    }
    a.s += a.speed * dt;
    const ed = sim.net.edges[a.e]!;
    if (a.s >= ed.len) {
      const px = a.x;
      const pz = a.z;
      a.s -= ed.len;
      if (a.role === ROLE_POSSE && outlaw.hold !== Infinity) {
        // the posse take the way the outlaw went
        nextEdge(sim, a, (e, far) =>
          e === outlaw.e
            ? 1000
            : -Math.hypot(sim.net.nodes[far]!.x - outlaw.x, sim.net.nodes[far]!.z - outlaw.z),
        );
      } else if (a.role === ROLE_OUTLAW) {
        // the outlaw runs for the far side of town
        nextEdge(
          sim,
          a,
          (_e, far) =>
            Math.hypot(sim.net.nodes[far]!.x - posse[0]!.x, sim.net.nodes[far]!.z - posse[0]!.z) *
            0.02,
        );
      } else nextEdge(sim, a);
      // carry the old position into the turn and let it ease out
      a.ox = 0;
      a.oz = 0;
      pose(sim.net, a);
      a.ox = px - a.x;
      a.oz = pz - a.z;
    }
    a.ox *= Math.exp(-dt * 1.6);
    a.oz *= Math.exp(-dt * 1.6);
    // ease into the lane after a turn (the posse spread across the road, riding abreast)
    const pi = a.role === ROLE_POSSE ? A.indexOf(a) - TOWNFOLK - 1 : -1;
    const base = sim.net.edges[a.e]!.lane * (a.pass > t ? -1 : 1);
    const lane = base + (pi >= 0 ? [-1.4, 0.2, 1.6][pi]! : 0);
    a.lat += (lane - a.lat) * Math.min(1, dt * (a.pass > t ? 3 : 1.5));
    a.ph += dt * a.speed * (a.kind === 0 ? 2.6 : 2.1);
    pose(sim.net, a);
  }
  // ---- the chase: shots, the catch, the ride out ----
  if (C.start >= 0) {
    if (C.caught < 0) {
      for (const p of posse) {
        const d = Math.hypot(p.x - outlaw.x, p.z - outlaw.z);
        if (d < 38 && sim.r() < dt * 0.9)
          sim.shots.push({ x: p.x, z: p.z, tx: outlaw.x, tz: outlaw.z });
      }
      // caught: run down after a while, or trapped at the end of a street
      const lead = Math.min(...posse.map((p) => Math.hypot(p.x - outlaw.x, p.z - outlaw.z)));
      const trapped =
        sim.net.nodes[outlaw.dir > 0 ? sim.net.edges[outlaw.e]!.b : sim.net.edges[outlaw.e]!.a]!.e
          .length === 1 && sim.net.edges[outlaw.e]!.len - outlaw.s < 8;
      if ((t - C.start > 42 && lead < 14) || trapped || t - C.start > 75) {
        C.caught = t;
        C.x = outlaw.x;
        C.z = outlaw.z;
        // he pulls up; the posse ride in and rein up round him (they stop behind him)
        outlaw.hold = t + 16;
        sim.events.push("caught");
      }
    } else if (t > C.caught + 16 && C.end < 0) {
      // the posse lead him off: all four leave the stage
      C.end = t;
      for (const a of [outlaw, ...posse]) {
        a.hold = Infinity;
        a.x = a.z = 1e4;
      }
      C.start = -1;
      C.next = t + 100 + sim.r() * 70;
    }
  }
}

// ---- snapshot sync: 6 numbers per agent ----
export function encodeSim(sim: Sim): number[] {
  const out: number[] = [Math.round(sim.t * 100)];
  for (const a of sim.agents) {
    out.push(
      a.e,
      a.dir,
      Math.round(a.s * 100),
      Math.round(a.speed * 100),
      Math.round(a.lat * 100),
      a.hold === Infinity ? -1 : a.hold > sim.t ? 1 : 0,
    );
  }
  return out;
}
export function decodeSim(sim: Sim, arr: number[], off: number) {
  if (arr.length < off + 1 + sim.agents.length * 6) return;
  sim.t = arr[off]! / 100;
  let o = off + 1;
  for (const a of sim.agents) {
    const e = arr[o]!;
    if (e >= 0 && e < sim.net.edges.length) a.e = e;
    a.dir = arr[o + 1]! > 0 ? 1 : -1;
    const s = arr[o + 2]! / 100;
    // (small corrections ease in; big ones snap)
    a.s = Math.abs(s - a.s) < 3 ? a.s + (s - a.s) * 0.3 : s;
    a.speed = arr[o + 3]! / 100;
    a.lat = arr[o + 4]! / 100;
    const h = arr[o + 5]!;
    a.hold = h < 0 ? Infinity : h > 0 ? sim.t + 1 : 0;
    o += 6;
    if (a.hold === Infinity) a.x = a.z = 1e4;
    else pose(sim.net, a);
  }
}
/** guests run the riders forward between snapshots (no decisions, just motion) */
export function coastSim(sim: Sim, dt: number) {
  sim.t += dt;
  for (const a of sim.agents) {
    if (a.hold === Infinity) continue;
    const ed = sim.net.edges[a.e]!;
    a.s = Math.min(ed.len, a.s + a.speed * dt);
    a.ph += dt * a.speed * (a.kind === 0 ? 2.6 : 2.1);
    pose(sim.net, a);
  }
}
