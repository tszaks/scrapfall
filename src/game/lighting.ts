// Sky, fog and light settings per map, for day and night.
import * as THREE from "three";
import type { Theme } from "./themes";
import { beachLook } from "./beach/beachLook";

export type Look = {
  sky: string;
  fog: [number, number];
  hemi: [string, string, number];
  sun: { color: string; intensity: number; pos: [number, number, number] };
  /** extra flat fill so enemies stay readable at night */
  ambient: number;
  camFar: number;
};

/** blend two hex colours in sRGB (perceptual), not linear, so "84% toward navy" really reads dark */
const mix = (a: string, b: string, t: number) => {
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

export function worldLook(theme: Theme, night: boolean, arena: number): Look {
  // Pacific Pier keeps its whole look table (night + sunset) in beach/beachLook.ts
  if (theme.blockShape === "beach") return beachLook(night).look;
  const city = theme.blockShape === "city";
  if (city) {
    // real-scale downtown: a long view with aerial haze so the skyline reads, a low warm
    // sun (long tower shadows) by day, sodium and LED street light by night
    return night
      ? {
          sky: "#161a2a",
          fog: [120, 1650],
          hemi: ["#7088d0", "#3a3040", 0.75],
          sun: { color: "#a8bcff", intensity: 0.5, pos: [-45, 85, -30] },
          ambient: 0.22,
          camFar: 1600,
        }
      : {
          sky: "#c9d7df",
          fog: [140, 1750],
          hemi: ["#dce8f4", "#6b6255", 0.6],
          sun: { color: "#ffd9a8", intensity: 2.6, pos: [48, 85, 30] },
          ambient: 0,
          camFar: 1600,
        };
  }
  if (!night) {
    return {
      sky: theme.sky,
      fog: [12, arena + 4],
      hemi: [theme.hemi[0], theme.hemi[1], 1.1],
      sun: { color: "#ffffff", intensity: 1.5, pos: [18, 26, 10] },
      ambient: 0,
      camFar: 120,
    };
  }
  // night on the classic maps: keep each theme's hue, pull it toward deep blue
  return {
    sky: mix(theme.sky, "#060a1a", 0.84),
    fog: [10, arena + 4],
    hemi: [mix(theme.hemi[0], "#8aa0e0", 0.5), mix(theme.hemi[1], "#05060c", 0.6), 0.7],
    sun: { color: "#a8bcff", intensity: 0.6, pos: [-18, 26, -10] },
    ambient: 0.22,
    camFar: 120,
  };
}
