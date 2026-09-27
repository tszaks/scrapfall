// Dry Gulch's light and atmosphere, one entry per time of day (NIGHT, the default, and
// SUNSET, the map's hero shot). lighting.ts turns an entry into the game's Look.
import type { TimeOfDay } from "../lighting";
import { lin, ramp, type SunsetPalette } from "../sky";
import { SKY_DIR } from "./textures";

export type WesternLook = {
  /** fog colour (the horizon haze) */
  fog: string;
  fogRange: [number, number];
  hemi: [string, string, number];
  sun: { color: string; intensity: number };
  ambient: number;
  ambientColor: string;
  camFar: number;
  /** how strongly lamp-lit windows glow (0..1) */
  windows: number;
  /** lantern flames and fires, a multiplier on their colour */
  flames: number;
  /** light pools on the ground under lanterns */
  pools: boolean;
  /** colour of the drifting dust motes in the air */
  motes: string;
  /** reflections on window glass */
  env: number;
  /** the big disc in the sky: sun or moon */
  disc: { color: string; size: number };
  /** dust storm tint (fog and the wall of dust) */
  storm: string;
};

export const WESTERN_LOOK: Record<TimeOfDay, WesternLook> = {
  // the hero shot: a huge orange sun low over the mesas at the end of Main Street,
  // long shadows down the street, gold dust hanging in the air
  sunset: {
    fog: "#e79a66",
    fogRange: [160, 3400],
    // warm sun, cool violet sky fill: shaded faces go dusky purple, never black
    hemi: ["#c8b0e0", "#9a6448", 1.35],
    sun: { color: "#ffa45c", intensity: 3.0 },
    ambient: 0.12,
    ambientColor: "#d0a8c0",
    camFar: 5200,
    windows: 0.22,
    flames: 0.7,
    pools: false,
    motes: "#ffd28a",
    env: 1.0,
    disc: { color: "#ffffff", size: 760 },
    storm: "#b8763e",
  },
  // lanterns in the windows, the moon over the buttes, stars, a glowing saloon, a campfire
  night: {
    fog: "#1a2040",
    fogRange: [90, 2600],
    hemi: ["#6c80c8", "#2a2030", 0.62],
    sun: { color: "#9fb4ff", intensity: 0.55 },
    ambient: 0.16,
    ambientColor: "#9fb0e0",
    camFar: 5200,
    windows: 1,
    flames: 1.45,
    pools: true,
    motes: "#8a9ad8",
    env: 0.7,
    disc: { color: "#e8eeff", size: 320 },
    storm: "#3a3448",
  },
};

/** the sky colour the palette leans toward at sunset (a desert orange, less city pink) */
export const WESTERN_SUNSET_SKY = "#ff7410";

/** A desert sunset: molten gold and tangerine along the western horizon, salmon and dusty
 * rose above, violet to a deep blue zenith; a dusky rose belt opposite the sun. */
const n = Math.hypot(...SKY_DIR.sunset);
export const WESTERN_SUNSET: SunsetPalette = {
  sun: [SKY_DIR.sunset[0] / n, SKY_DIR.sunset[1] / n, SKY_DIR.sunset[2] / n],
  toward: ramp([
    [-6, "#d88a52"],
    [0, "#ffc070"],
    [2.5, "#ffa84e"],
    [6, "#ff8c40"],
    [11, "#f27448"],
    [19, "#d8645a"],
    [30, "#a85a78"],
    [46, "#6c5290"],
    [66, "#3c3c7c"],
    [90, "#20285e"],
  ]),
  away: ramp([
    [-6, "#8a6468"],
    [0, "#c48a86"],
    [3, "#b08a92"],
    [9, "#d8948e"],
    [17, "#b88aa4"],
    [30, "#8074a8"],
    [50, "#4c4e92"],
    [90, "#20285e"],
  ]),
  glow: lin("#d88a3c"),
  halo: lin("#d8603a"),
  disc: lin("#ffe2a0"),
  cloudGold: lin("#ffb058"),
  cloudPink: lin("#ec7a70"),
  cloudCore: lin("#7a4a6a"),
  cloudAmount: 0.46,
  seed: 29,
};
/** direction toward the sun (sunset) or the moon (night) */
export const WESTERN_SUN = SKY_DIR;
