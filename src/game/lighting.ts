// Sky, fog and light settings per map, for the two times of day: night and sunset.
import * as THREE from "three";
import { CITY_SUNSET, arenaPalette, horizonHex } from "./sky";
import { installSkyFog } from "./skyFog";
import type { Theme } from "./themes";
import { WESTERN_LOOK, WESTERN_SUNSET } from "./western/look";

/** The game has two looks: night (the default) and a golden-hour sunset. */
export type TimeOfDay = "night" | "sunset";
export const TIMES: readonly TimeOfDay[] = ["night", "sunset"];

export type Look = {
  /** background colour (night arenas) and the horizon the haze should melt into */
  sky: string;
  fog: [number, number];
  /** fog colours are pre-compensated for tone mapping (see `untonemapped`) */
  fogColor: string;
  /** haze colour looking toward the sun, and how strongly it takes over (0 = plain fog) */
  fogSun: { color: string; k: number };
  hemi: [string, string, number];
  sun: { color: string; intensity: number; pos: [number, number, number] };
  /** extra flat fill so enemies stay readable in the dark */
  ambient: number;
  ambientColor: string;
  camFar: number;
};

/** blend two hex colours in sRGB (perceptual), not linear, so "84% toward navy" really reads dark */
export const mix = (a: string, b: string, t: number) => {
  const ca = new THREE.Color(a).getHex(THREE.SRGBColorSpace);
  const cb = new THREE.Color(b).getHex(THREE.SRGBColorSpace);
  let out = 0;
  for (const sh of [16, 8, 0]) {
    const va = (ca >> sh) & 255;
    const vb = (cb >> sh) & 255;
    out |= Math.round(va + (vb - va) * t) << sh;
  }
  return "#" + out.toString(16).padStart(6, "0");
};

// three.js ACES filmic (column-major, as in the shader)
const ACES_IN = new THREE.Matrix3().set(
  0.59719,
  0.35458,
  0.04823,
  0.076,
  0.90834,
  0.01566,
  0.0284,
  0.13383,
  0.83777,
);
const ACES_OUT = new THREE.Matrix3().set(
  1.60475,
  -0.53108,
  -0.07367,
  -0.10208,
  1.10813,
  -0.00605,
  -0.00327,
  -0.07276,
  1.07602,
);
const ACES_IN_INV = ACES_IN.clone().invert();
const ACES_OUT_INV = ACES_OUT.clone().invert();
/** inverse of the RRT/ODT curve: v such that (v^2 + a v - b) / (c v^2 + d v + e) = t */
const rrtInv = (t: number) => {
  const A = 1 - 0.983729 * t;
  const B = 0.0245786 - 0.432951 * t;
  const C = -(0.000090537 + 0.238081 * t);
  return A > 1e-6 ? (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A) : 60;
};
/**
 * The scene-linear colour that comes out of ACES tone mapping as `hex`. Fog colours go
 * through tone mapping but the sky behind them doesn't, so without this the haze on
 * distant towers never matches the horizon it should dissolve into.
 */
export function untonemapped(hex: string, exposure = 1) {
  const c = new THREE.Color(hex); // linear
  const v = new THREE.Vector3(Math.min(c.r, 0.97), Math.min(c.g, 0.97), Math.min(c.b, 0.97));
  v.applyMatrix3(ACES_OUT_INV);
  v.set(rrtInv(Math.max(v.x, 0)), rrtInv(Math.max(v.y, 0)), rrtInv(Math.max(v.z, 0)));
  v.applyMatrix3(ACES_IN_INV).multiplyScalar(0.6 / exposure);
  return new THREE.Color(Math.max(v.x, 0), Math.max(v.y, 0), Math.max(v.z, 0));
}

/** direction toward the sun (or moon) on the small arena maps */
export const ARENA_SUN: Record<TimeOfDay, [number, number, number]> = {
  night: [-18, 26, -10],
  sunset: [30, 8, 14],
};

const hexOf = (c: THREE.Color) => "#" + c.getHexString();
/** haze colours for a horizon colour pair (as displayed), compensated for tone mapping */
const haze = (away: string, toward: string, k: number) => ({
  fogColor: hexOf(untonemapped(away)),
  fogSun: { color: hexOf(untonemapped(toward)), k },
});

export function worldLook(theme: Theme, time: TimeOfDay, arena: number): Look {
  installSkyFog();
  if (theme.blockShape === "western") {
    // Dry Gulch: its own look table (western/look.ts); the sunset sky leans desert orange
    const w = WESTERN_LOOK[time];
    const P = WESTERN_SUNSET;
    const away = time === "sunset" ? horizonHex(P, false) : w.fog;
    const toward = time === "sunset" ? horizonHex(P, true) : mix(w.fog, "#3a4070", 0.5);
    return {
      sky: away,
      fog: w.fogRange,
      ...haze(away, toward, time === "sunset" ? 0.95 : 0.4),
      hemi: w.hemi,
      sun: { ...w.sun, pos: [0, 0, 0] },
      ambient: w.ambient,
      ambientColor: w.ambientColor,
      camFar: w.camFar,
    };
  }
  const city = theme.blockShape === "city";
  if (city) {
    // real-scale downtown: a long view with aerial haze so the skyline reads
    if (time === "night")
      return {
        sky: "#161a2a",
        fog: [120, 1650],
        ...haze("#1c1f30", "#2a2640", 0.5),
        hemi: ["#7088d0", "#3a3040", 0.75],
        sun: { color: "#a8bcff", intensity: 0.5, pos: [-45, 85, -30] },
        ambient: 0.22,
        ambientColor: "#9fb0e0",
        camFar: 1600,
      };
    // golden hour: the sun a few degrees over the sea, down the avenues. The haze is dusky
    // lavender away from the sun and burns gold toward it.
    const away = horizonHex(CITY_SUNSET, false);
    return {
      sky: away,
      fog: [60, 1450],
      ...haze(away, horizonHex(CITY_SUNSET, true), 0.95),
      hemi: ["#8a86d8", "#7a4c44", 0.95],
      sun: { color: "#ffa257", intensity: 3.4, pos: [0, 0, 0] },
      ambient: 0.1,
      ambientColor: "#c8a0c8",
      camFar: 1600,
    };
  }
  if (time === "sunset") {
    const P = arenaPalette(theme.sky, ARENA_SUN.sunset);
    const away = horizonHex(P, false);
    return {
      sky: away,
      fog: [14, arena + 6],
      ...haze(away, horizonHex(P, true), 0.9),
      hemi: [mix(theme.hemi[0], "#b096e0", 0.5), mix(theme.hemi[1], "#5a3030", 0.35), 0.95],
      sun: { color: "#ffa45c", intensity: 2.4, pos: ARENA_SUN.sunset },
      ambient: 0.08,
      ambientColor: "#d0a8c8",
      camFar: 120,
    };
  }
  // night on the classic maps: keep each theme's hue, pull it toward deep blue
  const sky = mix(theme.sky, "#060a1a", 0.84);
  return {
    sky,
    fog: [10, arena + 4],
    ...haze(sky, mix(theme.sky, "#101830", 0.7), 0.3),
    hemi: [mix(theme.hemi[0], "#8aa0e0", 0.5), mix(theme.hemi[1], "#05060c", 0.6), 0.7],
    sun: { color: "#a8bcff", intensity: 0.6, pos: ARENA_SUN.night },
    ambient: 0.22,
    ambientColor: "#9fb0e0",
    camFar: 120,
  };
}
