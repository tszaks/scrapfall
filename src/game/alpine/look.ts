// Whiteout Pass lighting and atmosphere, one entry per time of day (night is the default,
// sunset is the alpenglow hero look). Everything the alpine scene needs to change between
// the two lives here.
import type { Look, TimeOfDay } from "../lighting";

export type AlpineMode = TimeOfDay;

export type AlpineLook = Look & {
  /** direction towards the sun (or moon), normalised later */
  sunDir: [number, number, number];
  /** sky gradient: zenith, mid, horizon, and the glow around the sun */
  skyTop: string;
  skyMid: string;
  skyHorizon: string;
  sunGlow: string;
  /** light on the high peaks (alpenglow) and the shadowed valley tint */
  peakLit: string;
  peakShade: string;
  /** distant haze colour (aerial perspective) */
  haze: string;
  /** chalet windows: 0 dark .. 1 all lit */
  windows: number;
  /** street lamps and floodlights on */
  lamps: number;
  /** aurora strength (night only) */
  aurora: number;
  /** falling-snow colour (catches the light) */
  snow: string;
  /** blizzard fog colour */
  blizzard: string;
};

export const ALPINE_LOOKS: Record<AlpineMode, AlpineLook> = {
  sunset: {
    // the sun has just dipped behind the western ridge: the valley is in cold blue shadow,
    // the high snow burns pink and orange, windows are starting to glow
    sky: "#e7a58e",
    fog: [160, 2400],
    fogColor: "#b99aac",
    fogSun: { color: "#e8a07a", k: 0.6 },
    ambientColor: "#9fb0e0",
    hemi: ["#9fb4e6", "#6a6c8c", 0.95],
    sun: { color: "#ffb27a", intensity: 1.55, pos: [-60, 22, -30] },
    ambient: 0.08,
    camFar: 12000,
    sunDir: [-0.82, 0.16, -0.55],
    skyTop: "#2c4a86",
    skyMid: "#8a8fc4",
    skyHorizon: "#f6b48e",
    sunGlow: "#ffd09a",
    peakLit: "#ff9e84",
    peakShade: "#6d79ad",
    haze: "#c9a3b4",
    windows: 0.6,
    lamps: 0.75,
    aurora: 0,
    snow: "#f3e6ea",
    blizzard: "#b9bfd4",
  },
  night: {
    // moonlit blue snow, stars, warm amber windows and lamps, the lit run and a faint aurora
    sky: "#0d1630",
    fog: [120, 2200],
    fogColor: "#141c36",
    fogSun: { color: "#2a3558", k: 0.3 },
    ambientColor: "#8fa4e0",
    hemi: ["#6f88c8", "#1a2138", 0.8],
    sun: { color: "#aebfff", intensity: 0.62, pos: [40, 60, -50] },
    ambient: 0.18,
    camFar: 12000,
    sunDir: [0.42, 0.58, -0.7],
    skyTop: "#050a1c",
    skyMid: "#0c1734",
    skyHorizon: "#1d2b52",
    sunGlow: "#8ea4e0",
    peakLit: "#b7c6f2",
    peakShade: "#3a4a78",
    haze: "#22305a",
    windows: 1,
    lamps: 1,
    aurora: 1,
    snow: "#dfe8ff",
    blizzard: "#3e4a6a",
  },
};

export function alpineLook(time: TimeOfDay): AlpineLook {
  return ALPINE_LOOKS[time];
}
