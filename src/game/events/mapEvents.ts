// Mid-match map events: a blackout in Vice Heights, an avalanche on Whiteout Pass, and
// hooks for the train robbery (Dry Gulch) and the wave surge (the beach pier).
//
// How it works:
//  - Each map registers its events with `registerMapEvent` (a trigger window by wave, a
//    chance per wave, a cooldown in waves, an optional "guaranteed by wave N", a delay into
//    the wave, a duration, a banner and a sound).
//  - The host (or the solo player) rolls for an event when each wave starts and fires it a
//    few seconds in. Only one event runs at a time.
//  - Everything an event does is a pure function of (seed, seconds since it started), so a
//    guest only needs the start message ({type: "mev", id, s, t}) and runs the same timeline.
//    The host repeats it every 2 s to correct drift and to catch late joiners.
//  - Each client applies an event's effect to its own player (knockdowns, damage); only the
//    host touches enemies.
import type { CityLayout } from "../cityLayout";
import type { Theme } from "../themes";

export type EventEnemy = { x: number; z: number; alive: boolean; kind: string };

export type EventCtx = {
  /** seconds since the event started (the same on every client) */
  t: number;
  dt: number;
  seed: number;
  host: boolean;
  theme: Theme;
  city: CityLayout | null;
  /** this client's player */
  player: { x: number; y: number; z: number; alive: boolean };
  /** hurt / knock the local player (dmg 0 = just a shove) */
  hurtPlayer: (dmg: number, kx: number, kz: number, shake: number) => void;
  /** move the local player by (dx, dz), sliding along walls */
  movePlayer: (dx: number, dz: number) => void;
  /** host only: damage an enemy through the normal hit path */
  hurtEnemy: (i: number, dmg: number, kx: number, kz: number) => void;
  enemies: EventEnemy[];
  /** show a banner (title, subtitle) */
  banner: (title: string, sub?: string, color?: string) => void;
};

export type MapEventDef = {
  id: string;
  /** banner when it starts */
  title: string;
  sub: string;
  color?: string;
  /** which maps it can happen on */
  applies: (theme: Theme, city: CityLayout | null) => boolean;
  /** waves it may start in (inclusive) */
  waves: [number, number];
  /** chance per eligible wave */
  chance: number;
  /** waves to wait after it happened */
  cooldown: number;
  /** if it hasn't happened by this wave, it happens then */
  guarantee?: number;
  /** seconds into the wave before it starts (random in this range) */
  delay: [number, number];
  /** seconds it lasts */
  duration: number;
  /** the alarm when it starts */
  sound?: "siren" | "rumble" | "horn" | "whistle";
  start?: (ctx: EventCtx) => void;
  step?: (ctx: EventCtx) => void;
  end?: (ctx: EventCtx) => void;
};

const registry: MapEventDef[] = [];
export function registerMapEvent(def: MapEventDef) {
  const i = registry.findIndex((d) => d.id === def.id);
  if (i >= 0) registry[i] = def;
  else registry.push(def);
}
export function mapEventDefs(): readonly MapEventDef[] {
  return registry;
}
export function eventsFor(theme: Theme, city: CityLayout | null) {
  return registry.filter((d) => d.applies(theme, city));
}

export type ActiveEvent = { def: MapEventDef; seed: number; t: number; started: boolean };

export const mapEvent = {
  active: null as ActiveEvent | null,
  /** banner for the HUD (read by HudOverlay) */
  banner: null as { title: string; sub: string; color: string; at: number } | null,
  // host scheduling
  wave: 0,
  waveTime: 0,
  pending: null as { id: string; at: number } | null,
  lastWave: new Map<string, number>(),
  happened: new Set<string>(),
  /** host: the last time the active event was announced */
  announceT: 0,
};

/** a new arena: nothing running, nothing scheduled */
export function resetMapEvents() {
  const a = mapEvent.active;
  mapEvent.active = null;
  mapEvent.banner = null;
  mapEvent.wave = 0;
  mapEvent.waveTime = 0;
  mapEvent.pending = null;
  mapEvent.lastWave.clear();
  mapEvent.happened.clear();
  return a;
}

/** tiny seeded random for the host's rolls */
function roll(seed: number) {
  let x = (seed ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/**
 * Host / solo: call every playing frame. Returns an event to start this frame (the caller
 * starts it and tells the guests), or null.
 */
export function hostSchedule(
  wave: number,
  dt: number,
  theme: Theme,
  city: CityLayout | null,
  matchSeed: number,
): { id: string; seed: number } | null {
  const S = mapEvent;
  if (wave !== S.wave) {
    S.wave = wave;
    S.waveTime = 0;
    S.pending = null;
    if (wave > 0 && !S.active) {
      for (const d of eventsFor(theme, city)) {
        if (wave < d.waves[0] || wave > d.waves[1]) continue;
        const last = S.lastWave.get(d.id);
        if (last !== undefined && wave - last <= d.cooldown) continue;
        const due = d.guarantee !== undefined && wave >= d.guarantee && !S.happened.has(d.id);
        const r = roll(matchSeed * 31 + wave * 977 + d.id.length * 13);
        if (!due && r >= d.chance) continue;
        const r2 = roll(matchSeed * 17 + wave * 131 + 7);
        S.pending = { id: d.id, at: d.delay[0] + (d.delay[1] - d.delay[0]) * r2 };
        break;
      }
    }
  }
  S.waveTime += dt;
  if (S.pending && !S.active && S.waveTime >= S.pending.at) {
    const id = S.pending.id;
    S.pending = null;
    return { id, seed: (matchSeed * 7 + wave * 7919) % 2147483647 };
  }
  return null;
}

/** start (or re-sync) an event on this client */
export function startMapEvent(id: string, seed: number, t: number) {
  const def = registry.find((d) => d.id === id);
  if (!def) return false;
  const a = mapEvent.active;
  if (a && a.def.id === id && a.seed === seed) {
    // already running: nudge the clock if it drifted
    if (Math.abs(a.t - t) > 0.4) a.t = t;
    return true;
  }
  mapEvent.active = { def, seed, t, started: false };
  mapEvent.lastWave.set(id, mapEvent.wave);
  mapEvent.happened.add(id);
  return true;
}

/** test / debug: fire an event right now (host or solo) */
export const forceRequests: string[] = [];
export function forceMapEvent(id: string) {
  forceRequests.push(id);
}

/** guests: the host started / re-synced / ended an event */
export function onMapEventMsg(m: { type?: unknown; id?: unknown; s?: unknown; t?: unknown }) {
  if (m.type !== "mev") return false;
  const id = String(m.id ?? "");
  if (id) startMapEvent(id, Number(m.s) || 0, Number(m.t) || 0);
  else if (mapEvent.active) mapEvent.active.t = mapEvent.active.def.duration; // ends next frame
  return true;
}

