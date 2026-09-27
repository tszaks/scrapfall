// Dry Gulch's light and atmosphere, one entry per time of day. The game is moving to two
// modes, NIGHT (default) and SUNSET; until the day/night toggle is replaced, `night = true`
// maps to "night" and `night = false` to "sunset" (see westernMode()).
import { SKY_DIR, type WMode } from "./textures";

export type WesternLook = {
  /** fog colour (the horizon haze) */
  fog: string;
  fogRange: [number, number];
  hemi: [string, string, number];
  sun: { color: string; intensity: number };
  ambient: number;
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

export const WESTERN_LOOK: Record<WMode, WesternLook> = {
  // the hero shot: a huge orange sun low over the mesas at the end of Main Street,
  // long shadows down the street, gold dust hanging in the air
  sunset: {
    fog: "#e79a66",
    fogRange: [160, 3400],
    hemi: ["#ffcf9e", "#7a4a34", 0.8],
    sun: { color: "#ffa45c", intensity: 3.1 },
    ambient: 0.06,
    camFar: 5200,
    windows: 0.22,
    flames: 0.7,
    pools: false,
    motes: "#ffd28a",
    env: 1.0,
    disc: { color: "#ffb45a", size: 330 },
    storm: "#b8763e",
  },
  // lanterns in the windows, the moon over the buttes, stars, a glowing saloon, a campfire
  night: {
    fog: "#1a2040",
    fogRange: [90, 2600],
    hemi: ["#6c80c8", "#2a2030", 0.62],
    sun: { color: "#9fb4ff", intensity: 0.55 },
    ambient: 0.16,
    camFar: 5200,
    windows: 1,
    flames: 1.45,
    pools: true,
    motes: "#8a9ad8",
    env: 0.7,
    disc: { color: "#e8eeff", size: 170 },
    storm: "#3a3448",
  },
};

export const westernMode = (night: boolean): WMode => (night ? "night" : "sunset");

/** sun (or moon) position for a directional light, `dist` metres from the target */
export const lightPos = (mode: WMode, dist: number): [number, number, number] => {
  const d = SKY_DIR[mode];
  return [d[0] * dist, d[1] * dist, d[2] * dist];
};
