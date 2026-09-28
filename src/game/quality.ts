// Graphics quality: AUTO (default) / HIGH / MEDIUM / LOW, persisted in localStorage.
//
// A tier is a bundle of the settings that cost the most on the GPU and CPU: the render
// resolution (device pixel ratio), the sun's shadow map, the wet streets' mirror pass, the
// rain streak count, the rooms behind the city's windows, effect particle counts and
// antialiasing. AUTO starts at HIGH's look (at the old 1.6 resolution cap; MEDIUM and at
// most 1.5 on phones) and lets the governor (QualityGovernor.tsx) lower the resolution
// first, then step the tier down, when frames run slow, and back up when there is headroom.
//
// `?quality=auto|high|medium|low` overrides the saved choice for one visit (testing).
import { useLayoutEffect, useSyncExternalStore, type RefObject } from "react";
import type * as THREE from "three";

import { isTouchDevice } from "./touch";

export type QualityPref = "auto" | "high" | "medium" | "low";
export type Tier = "high" | "medium" | "low";

export type QualitySpec = {
  /** resolution range (device pixel ratio); the governor moves between them on AUTO */
  dprMin: number;
  dprMax: number;
  /** sun shadow map size, 0 = no sun shadows */
  shadowMap: number;
  /** wet-street mirror: fraction of the drawing buffer (0 = off) and refresh interval in frames */
  reflScale: number;
  reflEvery: number;
  /** fraction of the rain streaks drawn */
  rain: number;
  /** interior-mapped rooms behind the city's windows */
  rooms: boolean;
  /** effect particle multiplier (sparks, debris, smoke) */
  particles: number;
  /** multisample antialiasing (a context attribute: applies on the next load) */
  antialias: boolean;
};

const STORE_KEY = "gta-quality";
const PREFS: QualityPref[] = ["auto", "high", "medium", "low"];
export const QUALITY_PREFS = PREFS;

const dpr0 = () => (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);

/** phones and tablets (the touch build): a 3x screen and a phone GPU, so a lower resolution
 * range, and AUTO starts one tier down (the governor still steps up with headroom) */
export const MOBILE =
  typeof window !== "undefined" && isTouchDevice() && !!window.matchMedia?.("(pointer: coarse)").matches;

export function specFor(tier: Tier, pref: QualityPref): QualitySpec {
  const dev = dpr0();
  if (tier === "high")
    return {
      // HIGH picked by hand: full Retina resolution (up to 2); AUTO keeps the old 1.6 cap
      dprMin: pref === "high" ? Math.min(dev, 2) : MOBILE ? 0.85 : 1,
      dprMax: pref === "high" ? Math.min(dev, 2) : Math.min(dev, MOBILE ? 1.5 : 1.6),
      shadowMap: 2048,
      reflScale: 0.5,
      reflEvery: 2,
      rain: 1,
      rooms: true,
      particles: 1,
      antialias: true,
    };
  if (tier === "medium")
    return {
      dprMin: pref === "medium" ? Math.min(dev, 1.25) : MOBILE ? 0.85 : 1,
      dprMax: Math.min(dev, pref === "medium" ? 1.25 : 1.4),
      shadowMap: 1024,
      reflScale: 0.33,
      reflEvery: 3,
      rain: 0.6,
      rooms: true,
      particles: 0.7,
      antialias: true,
    };
  return {
    dprMin: pref === "low" ? 1 : MOBILE ? 0.7 : 0.85,
    dprMax: 1,
    shadowMap: 0,
    reflScale: 0,
    reflEvery: 4,
    rain: 0.35,
    rooms: false,
    particles: 0.45,
    antialias: pref !== "low",
  };
}

function readPref(): QualityPref {
  if (typeof window === "undefined") return "auto";
  const q = new URLSearchParams(window.location.search).get("quality");
  if (q && (PREFS as string[]).includes(q)) return q as QualityPref;
  try {
    const v = localStorage.getItem(STORE_KEY);
    if (v && (PREFS as string[]).includes(v)) return v as QualityPref;
  } catch {
    /* private mode */
  }
  return "auto";
}

type State = { pref: QualityPref; tier: Tier; spec: QualitySpec };
const initialPref = readPref();
const initialTier: Tier = initialPref === "auto" ? (MOBILE ? "medium" : "high") : initialPref;
let state: State = { pref: initialPref, tier: initialTier, spec: specFor(initialTier, initialPref) };
let dprNow = Math.round(state.spec.dprMax * 100) / 100;
/** the resolution the governor picked (the Canvas's `dpr` prop) */
export function liveDpr() {
  return dprNow;
}
export function setLiveDpr(v: number) {
  dprNow = v;
}
/** A new map loading (shader compiles, textures, the pre-warm frame) is slow on purpose:
 * the governor ignores frames until this time (performance.now ms). */
let holdUntil = 0;
export function holdQuality(ms: number) {
  holdUntil = Math.max(holdUntil, (typeof performance === "undefined" ? 0 : performance.now()) + ms);
}
export function qualityHeld() {
  return performance.now() < holdUntil;
}
/** antialiasing is fixed when the WebGL context is made: the value the Canvas mounted with */
export const antialiasAtLoad = state.spec.antialias;

const subs = new Set<() => void>();
function emit() {
  subs.forEach((f) => f());
}
function subscribe(f: () => void) {
  subs.add(f);
  return () => subs.delete(f);
}

/** the live quality (read from frame loops without subscribing) */
export function quality(): State {
  return state;
}

export function setQualityPref(pref: QualityPref) {
  const tier: Tier = pref === "auto" ? state.tier : pref;
  state = { pref, tier, spec: specFor(tier, pref) };
  try {
    localStorage.setItem(STORE_KEY, pref);
  } catch {
    /* private mode */
  }
  emit();
}

/** AUTO only: the governor stepping the tier */
export function setAutoTier(tier: Tier) {
  if (state.pref !== "auto" || state.tier === tier) return;
  state = { pref: "auto", tier, spec: specFor(tier, "auto") };
  emit();
}

/** subscribe a component to quality changes (re-renders only when the tier/pref changes) */
export function useQuality(): State {
  return useSyncExternalStore(subscribe, quality, quality);
}

/** `?shadows=0` forces sun shadows off, `?shadows=1` keeps them at full size on every tier */
function shadowParam(): boolean | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("shadows");
  return v === "0" ? false : v === "1" ? true : null;
}
const shadowForced = shadowParam();

/**
 * A sun's shadow for the current tier: whether it casts, and its map size (at most `full`).
 * A new size frees the old shadow map so three makes the new one on the next frame.
 */
export function useSunShadow(ref: RefObject<THREE.DirectionalLight | null>, full = 2048) {
  const { spec } = useQuality();
  const size =
    shadowForced === false ? 0 : shadowForced === true ? full : Math.min(full, spec.shadowMap);
  useLayoutEffect(() => {
    const l = ref.current;
    if (!l || size === 0 || l.shadow.mapSize.x === size) return;
    l.shadow.mapSize.set(size, size);
    l.shadow.map?.dispose();
    l.shadow.map = null;
  }, [ref, size]);
  return { cast: size > 0, size: size || full };
}
