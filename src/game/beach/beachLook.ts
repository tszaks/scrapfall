// Every lighting and atmosphere number for Pacific Pier, per time of day (night / sunset).
// Sunset is the hero look: the sun a few degrees over the Pacific, right at the end of the
// pier. Night: the moon over the ocean, the pier and boardwalk lit.
import { untonemapped, type Look, type TimeOfDay } from "../lighting";
import { CITY_SUNSET, SUN_DIR, horizonHex, type SunsetPalette } from "../sky";

/** unit vector from a compass angle off +z (toward +x) and an elevation, in degrees */
function dirFrom(azDeg: number, elDeg: number): [number, number, number] {
  const a = (azDeg * Math.PI) / 180;
  const e = (elDeg * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
}
const norm = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** the sea is to the west (-x): the sun sets just south of the pier's line */
export const BEACH_SUN: Record<TimeOfDay, [number, number, number]> = {
  sunset: dirFrom(-97, 4.5),
  // the city's night sky already hangs its moon over -x/-z: over the ocean here
  night: norm(SUN_DIR.night),
};

/** the Vice City dusk palette, with its sun moved over the Pacific and fewer, wispier clouds */
export const BEACH_SUNSET: SunsetPalette = {
  ...CITY_SUNSET,
  sun: BEACH_SUN.sunset,
  cloudAmount: 0.44,
  seed: 5,
};
export const BEACH_SKY_KEY = "beach-sunset";

export type BeachLook = {
  look: Look;
  sunDir: [number, number, number];
  /** where the light comes from: the sunset's is a little higher than the disc, so the sand
   * catches warm light instead of only the violet sky */
  lightDir: [number, number, number];
  water: { color: string; roughness: number; metalness: number; foam: string; env: number };
  /** emissive multipliers */
  glow: number;
  signs: number;
  windows: number;
  dark: number;
  pools: number;
  env: number;
  wheel: number;
  /** marine layer (boss round): fog pulled in to this range, in this colour */
  hazardFog: [number, number];
  hazardCol: string;
};

const hexOf = (c: { getHexString: () => string }) => "#" + c.getHexString();
const haze = (away: string, toward: string, k: number) => ({
  fogColor: hexOf(untonemapped(away)),
  fogSun: { color: hexOf(untonemapped(toward)), k },
});

let cache: Partial<Record<TimeOfDay, BeachLook>> = {};
export function beachLook(time: TimeOfDay): BeachLook {
  const hit = cache[time];
  if (hit) return hit;
  let out: BeachLook;
  if (time === "sunset") {
    const away = horizonHex(BEACH_SUNSET, false);
    out = {
      look: {
        sky: away,
        fog: [80, 1700],
        ...haze(away, horizonHex(BEACH_SUNSET, true), 0.95),
        hemi: ["#dcb0a8", "#8a5a40", 0.85],
        sun: { color: "#ffa257", intensity: 3.4, pos: [0, 0, 0] },
        ambient: 0.1,
        ambientColor: "#c8a0c8",
        camFar: 3400,
      },
      sunDir: BEACH_SUN.sunset,
      lightDir: dirFrom(-97, 14),
      water: { color: "#241c3c", roughness: 0.18, metalness: 0.9, foam: "#ffe6d6", env: 1 },
      glow: 1.1,
      signs: 1.0,
      windows: 0.55,
      dark: 0.62,
      pools: 0.3,
      env: 1.15,
      wheel: 1.5,
      hazardFog: [6, 110],
      hazardCol: "#d8aaa6",
    };
  } else {
    out = {
      look: {
        sky: "#161a2a",
        fog: [90, 1500],
        ...haze("#1c1f30", "#2a2a48", 0.55),
        hemi: ["#6a80c8", "#3a3040", 0.72],
        sun: { color: "#a8bcff", intensity: 0.55, pos: [0, 0, 0] },
        ambient: 0.22,
        ambientColor: "#9fb0e0",
        camFar: 3400,
      },
      sunDir: BEACH_SUN.night,
      lightDir: BEACH_SUN.night,
      water: { color: "#10304a", roughness: 0.14, metalness: 0.3, foam: "#9ab0cc", env: 1 },
      glow: 1.4,
      signs: 1.25,
      windows: 0.95,
      dark: 0.2,
      pools: 0.95,
      env: 0.9,
      wheel: 2.4,
      hazardFog: [5, 80],
      hazardCol: "#202838",
    };
  }
  cache[time] = out;
  return out;
}
/** drop cached looks (tests / hot reload) */
export function resetBeachLook() {
  cache = {};
}
