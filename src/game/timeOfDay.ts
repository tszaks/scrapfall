import { matchEnvironment } from "./matchEnvironment";
// Continuous time of day. `tod.k` runs from 0 (golden sunset) to 1 (full night) and every
// look in the game (sky, fog, lights, windows, street lights, neon, headlights, the sun)
// is a blend of its two authored endpoints at that k.
//
// One seeded environment owns the whole match. Co-op peers share the seed; local
// overrides are reserved for solo diagnostic URLs. Lighting blends remain continuous.
import { useSyncExternalStore } from "react";
import * as THREE from "three";

import { ARENA_SUN, worldLook, type Look, type TimeOfDay } from "./lighting";
import { SUN_DIR } from "./sky";
import { beachLook } from "./beach/beachLook";
import { SKY_DIR as WESTERN_SKY_DIR } from "./western/textures";
import { layoutOf, type Theme } from "./themes";

export type TimeMode = "auto" | "night" | "sunset";

export const tod = {
  /** the time: 0 sunset .. 1 night */
  k: 0,
  /** how dark it looks (what the visuals blend by): the light drains early in the dusk,
   * the way a real sunset goes, so the middle waves read as dusk rather than late sunset */
  v: 0,
  /** where k is heading */
  target: 0,
  /** this player's choice */
  mode: "auto" as TimeMode,
  /** co-op guests: the host's auto value (null = solo / host / not heard yet) */
  hostK: null as number | null,
  /** the match's wave and how far through it the squad is (host / solo) */
  wave: 0,
  progress: 0,
  playing: false,
  /** snap straight to the target on the next step (first frame, new arena) */
  snap: true,
  /** the lock came from N during a match: it lasts for that match only */
  lockedInMatch: false,
};

/** bumps every frame k moved (TimeDriver); consumers compare against their last seen value */
export const todFrame = { version: 0, lastK: -1 };

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export { smooth as todSmooth };

/** k for a point in the match: wave 1 golden, dusk through the middle, night by wave 7-8 */
export function waveStage(wave: number, progress: number) {
  if (wave <= 0) return 0;
  const s = wave - 1 + Math.min(1, Math.max(0, progress));
  return smooth(0.4, 7.4, s);
}

/** `?time=night|sunset|auto` (or a number 0..1 for testing) picks the opening mode */
export function initialMode(): { mode: TimeMode; k: number | null } {
  if (typeof window === "undefined") return { mode: "auto", k: null };
  const q = new URLSearchParams(window.location.search);
  const t = q.get("time");
  if (t === "night" || t === "sunset" || t === "auto") return { mode: t, k: null };
  if (t !== null && t !== "" && Number.isFinite(Number(t)))
    return { mode: "auto", k: Math.min(1, Math.max(0, Number(t))) };
  if (q.get("night") === "0") return { mode: "sunset", k: null };
  if (q.get("night") === "1") return { mode: "night", k: null };
  return { mode: "auto", k: null };
}
/** test override: `?time=0.4` pins k */
let pinned: number | null = null;
export function pinTime(k: number | null) {
  pinned = k;
  tod.snap = true;
}

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((f) => f());
}
function subscribe(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function setTimeMode(m: TimeMode) {
  if (tod.mode === m) return;
  tod.mode = m;
  emit();
}
/** Conditions stay fixed for the entire run; retained for old input preferences. */
export function cycleTimeMode() {}
export function toggleTimeLock(_inMatch: boolean) {}
/** the wave clock goes back to wave 0 (new arena / new seed) */
export function resetMatchTime() {
  tod.wave = 0;
  tod.progress = 0;
  tod.hostK = null;
}
/** Begin the fixed match lighting immediately, clearing any legacy local lock. */
export function beginMatchTime() {
  tod.snap = true;
  if (tod.lockedInMatch) {
    tod.lockedInMatch = false;
    setTimeMode("auto");
  }
  resetMatchTime();
}
/** the host's wave clock (solo and co-op host): wave number and how much of it is cleared */
export function setWaveClock(wave: number, progress: number) {
  tod.wave = wave;
  tod.progress = progress;
}

/** where k should be right now */
function targetNow() {
  if (pinned !== null && matchEnvironment.allowOverrides) return pinned;
  if (!tod.playing) return 0;
  if (tod.hostK !== null) return tod.hostK;
  return matchEnvironment.kind === "night" ? 1 : matchEnvironment.kind === "rain" ? 0.35 : 0;
}

let lastQ = -1;
/** advance k toward its target; called once per frame by the TimeDriver */
export function stepTod(dt: number) {
  tod.target = targetNow();
  const d = tod.target - tod.k;
  if (tod.snap) {
    tod.k = tod.target;
    tod.snap = false;
  } else if (d !== 0) {
    // the waves move it gently; a manual lock or a new arena fades over a couple of seconds
    const auto = tod.mode === "auto" && tod.playing && pinned === null;
    const rate = auto ? 0.02 : 0.45;
    tod.k += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
  }
  tod.v = 1 - Math.pow(1 - tod.k, 1.5);
  const q = Math.round(tod.v * QUANT);
  if (q !== lastQ) {
    lastQ = q;
    emit();
  }
}
const QUANT = 64;

/** the look blend (tod.v) in 1/64 steps as React state: components that re-run effects on
 * it update rarely */
export function useTodK() {
  return useSyncExternalStore(
    subscribe,
    () => Math.round(tod.v * QUANT) / QUANT,
    () => 0,
  );
}
/** the nearest of the two authored looks (for code that only knows night / sunset) */
export function useTodNearest(): TimeOfDay {
  return useSyncExternalStore(
    subscribe,
    () => (tod.v >= 0.5 ? "night" : "sunset"),
    () => "sunset",
  );
}
export function useTodMode(): TimeMode {
  return useSyncExternalStore(
    subscribe,
    () => tod.mode,
    () => "auto",
  );
}

// ---- blending the two authored looks ----

export type Blend = {
  sky: THREE.Color;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiI: number;
  ambient: number;
  ambientColor: THREE.Color;
  camFar: number;
  /** direction toward the sun (k < 0.5) or the moon, its colour and strength */
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunI: number;
  /** directional haze toward that light */
  hazeColor: THREE.Color;
  hazeK: number;
};

type Pair = {
  S: Look;
  N: Look;
  c: Record<"sky" | "fog" | "haze" | "hs" | "hg" | "amb" | "sun", [THREE.Color, THREE.Color]>;
  sDir: THREE.Vector3;
  nDir: THREE.Vector3;
};
const pairs = new Map<string, Pair>();
const col = (h: string) => new THREE.Color(h);

/** direction toward the light for a look (the city and the arenas keep theirs elsewhere) */
function lightDir(theme: Theme, look: Look, time: TimeOfDay) {
  const layout = layoutOf(theme);
  const custom =
    layout === "beach"
      ? beachLook(time).lightDir
      : layout === "western"
        ? WESTERN_SKY_DIR[time]
        : (look as Look & { sunDir?: [number, number, number] }).sunDir;
  const d =
    custom ??
    (theme.blockShape === "city"
      ? SUN_DIR[time]
      : layoutOf(theme) === "scatter"
        ? ARENA_SUN[time]
        : look.sun.pos);
  const v = new THREE.Vector3(d[0], d[1], d[2]);
  return v.lengthSq() > 1e-6 ? v.normalize() : new THREE.Vector3(0, 1, 0);
}

function pairFor(theme: Theme, arena: number): Pair {
  const key = `${theme.name}|${arena}`;
  let p = pairs.get(key);
  if (p) return p;
  const S = worldLook(theme, "sunset", arena);
  const N = worldLook(theme, "night", arena);
  const c: Pair["c"] = {
    sky: [col(S.sky), col(N.sky)],
    fog: [col(S.fogColor), col(N.fogColor)],
    haze: [col(S.fogSun.color), col(N.fogSun.color)],
    hs: [col(S.hemi[0]), col(N.hemi[0])],
    hg: [col(S.hemi[1]), col(N.hemi[1])],
    amb: [col(S.ambientColor), col(N.ambientColor)],
    sun: [col(S.sun.color), col(N.sun.color)],
  };
  p = { S, N, c, sDir: lightDir(theme, S, "sunset"), nDir: lightDir(theme, N, "night") };
  pairs.set(key, p);
  return p;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** the two authored looks for a map (sunset, night) */
export function lookPair(theme: Theme, arena: number) {
  const p = pairFor(theme, arena);
  return { sunset: p.S, night: p.N };
}

/**
 * The look at k, written into `out`. The sun sinks and fades over the first half, the moon
 * rises and brightens over the second, so the light never swings round while it is bright.
 */
export function blendLook(theme: Theme, arena: number, k: number, out: Blend): Blend {
  const p = pairFor(theme, arena);
  const { S, N, c } = p;
  out.sky.lerpColors(c.sky[0], c.sky[1], k);
  out.fogColor.lerpColors(c.fog[0], c.fog[1], k);
  out.fogNear = lerp(S.fog[0], N.fog[0], k);
  out.fogFar = lerp(S.fog[1], N.fog[1], k);
  out.hemiSky.lerpColors(c.hs[0], c.hs[1], k);
  out.hemiGround.lerpColors(c.hg[0], c.hg[1], k);
  out.hemiI = lerp(S.hemi[2], N.hemi[2], k);
  out.ambient = lerp(S.ambient, N.ambient, k);
  out.ambientColor.lerpColors(c.amb[0], c.amb[1], k);
  out.camFar = Math.max(S.camFar, N.camFar);
  if (k < 0.5) {
    const f = 1 - smooth(0, 0.5, k);
    out.sunDir.copy(p.sDir);
    out.sunDir.y -= k * 0.12; // sinking
    out.sunDir.normalize();
    out.sunColor.copy(c.sun[0]);
    out.sunI = S.sun.intensity * f;
    out.hazeColor.copy(c.haze[0]);
    out.hazeK = S.fogSun.k * f;
  } else {
    const f = smooth(0.5, 1, k);
    out.sunDir.copy(p.nDir);
    out.sunColor.copy(c.sun[1]);
    out.sunI = N.sun.intensity * f;
    out.hazeColor.copy(c.haze[1]);
    out.hazeK = N.fogSun.k * f;
  }
  if (tod.playing && (matchEnvironment.kind === "sunny" || matchEnvironment.kind === "rain")) {
    const rain = matchEnvironment.kind === "rain";
    out.sky.set(rain ? "#788894" : "#6dafdc");
    out.fogColor.set(rain ? "#879395" : "#bbd3d9");
    out.hemiSky.set(rain ? "#b8c7d0" : "#c4defa");
    out.hemiGround.set("#8e806d");
    out.hemiI = rain ? 1.15 : 1.15;
    out.ambient = rain ? 0.35 : 0.26;
    out.ambientColor.set("#ffffff");
    out.sunDir.set(-0.5, 0.82, 0.28).normalize();
    out.sunColor.set(rain ? "#d3dce4" : "#fff1d2");
    out.sunI = rain ? 0.55 : 3.1;
    out.hazeColor.copy(out.fogColor);
    out.hazeK = rain ? 0.12 : 0.045;
    if (rain) {
      out.fogNear *= 0.45;
      out.fogFar *= 0.58;
    }
  }
  return out;
}
export function newBlend(): Blend {
  return {
    sky: new THREE.Color(),
    fogColor: new THREE.Color(),
    fogNear: 0,
    fogFar: 1,
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiI: 1,
    ambient: 0,
    ambientColor: new THREE.Color(),
    camFar: 120,
    sunDir: new THREE.Vector3(0, 1, 0),
    sunColor: new THREE.Color(),
    sunI: 0,
    hazeColor: new THREE.Color(),
    hazeK: 0,
  };
}
/** one shared blend of the current map at the current k (filled by TimeLights each frame) */
export const liveLook: Blend = newBlend();

// ---- city light staging: street lights first, then windows floor by floor ----

export type CityChannels = {
  /** street light pools and lamp bulbs */
  pools: number;
  glow: number;
  signs: number;
  /** lit-window texture strength, share of dark windows, and the height (m) the lights have
   * climbed to: windows above it are still dark */
  windows: number;
  dark: number;
  lightH: number;
  env: number;
  /** car headlight beams and road pools, police light spill */
  cone: number;
  headPool: number;
  spill: number;
};
export function cityChannels(k: number, out: CityChannels): CityChannels {
  const street = smooth(0.05, 0.45, k);
  const win = smooth(0.22, 0.9, k);
  out.pools = lerp(0.32, 0.9, street);
  out.glow = lerp(1.1, 1.35, street);
  out.signs = lerp(1.0, 1.25, smooth(0.15, 0.7, k));
  out.windows = lerp(0.55, 0.95, win);
  out.dark = lerp(0.62, 0.2, win);
  out.lightH = lerp(38, 720, Math.pow(smooth(0.12, 0.9, k), 1.4));
  out.env = lerp(1.15, 0.9, k);
  const lamps = smooth(0.0, 0.5, k);
  out.cone = lerp(0.025, 0.06, lamps);
  out.headPool = lerp(0.22, 0.5, lamps);
  out.spill = lerp(0.4, 0.75, lamps);
  return out;
}
export const liveCity: CityChannels = cityChannels(0, {} as CityChannels);
