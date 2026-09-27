// Pings: middle mouse (or G) marks what you're looking at, an enemy (outlined and labelled,
// tracked for a few seconds), a pickup, an elevator or just a spot, for everyone in the
// room: in the world (HudOverlay.tsx) and on the minimap. Solo players can use them as
// markers. One compact message per ping ({type: "ping", k, x, y, z, i}), rate-limited.
import * as THREE from "three";

export type PingKind = "enemy" | "loc" | "gun" | "heal" | "crate" | "elev";
export const PING_KINDS: PingKind[] = ["enemy", "loc", "gun", "heal", "crate", "elev"];

export type Ping = {
  owner: string;
  num: number;
  kind: PingKind;
  x: number;
  y: number;
  z: number;
  /** enemy index (enemy pings follow it), else -1 */
  ei: number;
  label: string;
  born: number;
  life: number;
};

export const PING_LIFE: Record<PingKind, number> = {
  enemy: 6,
  loc: 10,
  gun: 10,
  heal: 10,
  crate: 10,
  elev: 10,
};
const MAX_PER_PLAYER = 3;
const COOLDOWN = 450; // ms between my pings

export const pings: Ping[] = [];

/** something else in the world that can be pinged (elevators, map set pieces) */
export type PingTarget = { x: number; y: number; z: number; kind: PingKind; label: string };
type Provider = (
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
) => (PingTarget & { dist: number }) | null;
const providers = new Set<Provider>();
/** register a pingable thing; returns the unregister function */
export function registerPingTarget(p: Provider) {
  providers.add(p);
  return () => {
    providers.delete(p);
  };
}

export type PingEnemy = { x: number; z: number; alive: boolean; kind: string; elite?: number };
export type PingWorld = {
  enemies: PingEnemy[];
  items: { x: number; z: number; active: boolean; kind: "gun" | "heal" | "crate"; label: string }[];
  /** true where a wall / building stands */
  solid: (x: number, z: number) => boolean;
  ground: (x: number, z: number) => number;
  /** nothing solid between the two points (2D) */
  los: (ax: number, az: number, bx: number, bz: number) => boolean;
  /** enemy height band [lo, hi] and body radius */
  band: (kind: string) => [number, number];
  radius: (kind: string) => number;
  enemyLabel: (e: PingEnemy) => string;
};

const _f = new THREE.Vector3();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
let lastMine = 0;

/** what's under the crosshair, or null (a ray into the sky) */
export function aimPing(cam: THREE.Camera, w: PingWorld, owner: string, num: number): Ping | null {
  const now = performance.now();
  if (now - lastMine < COOLDOWN) return null;
  cam.getWorldDirection(_f);
  const o = cam.position;
  let best: Ping | null = null;
  let bestScore = Infinity;
  // enemies: the one nearest the crosshair inside a small cone, with a clear line
  w.enemies.forEach((e, i) => {
    if (!e.alive) return;
    const [lo, hi] = w.band(e.kind);
    const gy = w.ground(e.x, e.z);
    _v.set(e.x, gy + (lo + hi) / 2, e.z).sub(o);
    const along = _v.dot(_f);
    if (along <= 0.5 || along > 110) return;
    const perp = _p.copy(_f).multiplyScalar(-along).add(_v).length();
    const r = w.radius(e.kind) * (e.elite ? 1.6 : 1);
    const allow = Math.max(r * 1.4 + (hi - lo) * 0.3, along * Math.tan((3.2 * Math.PI) / 180));
    if (perp > allow) return;
    if (!w.los(o.x, o.z, e.x, e.z)) return;
    const score = perp / along;
    if (score < bestScore) {
      bestScore = score;
      best = mk(owner, num, "enemy", e.x, gy + hi, e.z, i, w.enemyLabel(e), now);
    }
  });
  if (best) return commitMine(best, now);
  // pickups
  for (const it of w.items) {
    if (!it.active) continue;
    const gy = w.ground(it.x, it.z);
    _v.set(it.x, gy + 0.8, it.z).sub(o);
    const along = _v.dot(_f);
    if (along <= 0.5 || along > 120) continue;
    const perp = _p.copy(_f).multiplyScalar(-along).add(_v).length();
    if (perp > Math.max(1.2, along * Math.tan((4 * Math.PI) / 180))) continue;
    const score = perp / along;
    if (score < bestScore) {
      bestScore = score;
      best = mk(owner, num, it.kind, it.x, gy + 1, it.z, -1, it.label, now);
    }
  }
  if (best) return commitMine(best, now);
  // anything registered (elevators ...)
  let bd = Infinity;
  providers.forEach((p) => {
    const t = p(o, _f, 120);
    if (t && t.dist < bd) {
      bd = t.dist;
      best = mk(owner, num, t.kind, t.x, t.y, t.z, -1, t.label, now);
    }
  });
  if (best) return commitMine(best, now);
  // a spot: march the ray until it meets the ground or a wall
  const step = 0.5;
  let px = o.x;
  let py = o.y;
  let pz = o.z;
  for (let s = step; s < 160; s += step) {
    const x = o.x + _f.x * s;
    const y = o.y + _f.y * s;
    const z = o.z + _f.z * s;
    const g = w.ground(x, z);
    if (y <= g) return commitMine(mk(owner, num, "loc", x, g + 0.05, z, -1, "HERE", now), now);
    if (w.solid(x, z)) return commitMine(mk(owner, num, "loc", px, Math.max(py, w.ground(px, pz) + 0.05), pz, -1, "HERE", now), now);
    px = x;
    py = y;
    pz = z;
  }
  return null;
}

function mk(owner: string, num: number, kind: PingKind, x: number, y: number, z: number, ei: number, label: string, now: number): Ping {
  return { owner, num, kind, x, y, z, ei, label, born: now, life: PING_LIFE[kind] };
}
function commitMine(p: Ping, now: number) {
  lastMine = now;
  addPing(p);
  return p;
}

/** add a ping (mine or a teammate's): one per enemy per owner, at most 3 per owner */
export function addPing(p: Ping) {
  for (let i = pings.length - 1; i >= 0; i--) {
    const q = pings[i]!;
    if (q.owner === p.owner && ((p.ei >= 0 && q.ei === p.ei) || (p.ei < 0 && Math.hypot(q.x - p.x, q.z - p.z) < 1.5)))
      pings.splice(i, 1);
  }
  pings.push(p);
  const mine = pings.filter((q) => q.owner === p.owner);
  if (mine.length > MAX_PER_PLAYER) pings.splice(pings.indexOf(mine[0]!), 1);
}

const r1 = (v: number) => Math.round(v * 10) / 10;
export function pingMsg(p: Ping) {
  return { type: "ping", k: PING_KINDS.indexOf(p.kind), x: r1(p.x), y: r1(p.y), z: r1(p.z), i: p.ei, l: p.label.slice(0, 24) };
}
/** a teammate's ping arrived */
export function pingFromMsg(m: { k?: unknown; x?: unknown; y?: unknown; z?: unknown; i?: unknown; l?: unknown; from?: unknown }, num: number) {
  const kind = PING_KINDS[Number(m.k)] ?? "loc";
  const p = mk(String(m.from ?? "host"), num, kind, Number(m.x) || 0, Number(m.y) || 0, Number(m.z) || 0, Number.isInteger(m.i) ? Number(m.i) : -1, String(m.l ?? "").slice(0, 24) || kind.toUpperCase(), performance.now());
  addPing(p);
  return p;
}

/** expire old pings and follow pinged enemies (a pinged enemy that dies drops its ping) */
export function tickPings(enemies: PingEnemy[], ground: (x: number, z: number) => number, band: (k: string) => [number, number]) {
  const now = performance.now();
  for (let i = pings.length - 1; i >= 0; i--) {
    const p = pings[i]!;
    if (now - p.born > p.life * 1000) {
      pings.splice(i, 1);
      continue;
    }
    if (p.ei >= 0) {
      const e = enemies[p.ei];
      if (!e || !e.alive) {
        pings.splice(i, 1);
        continue;
      }
      p.x = e.x;
      p.z = e.z;
      p.y = ground(e.x, e.z) + band(e.kind)[1];
    }
  }
}
export function clearPings() {
  pings.length = 0;
}
