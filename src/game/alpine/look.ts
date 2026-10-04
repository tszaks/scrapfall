import { matchEnvironment } from "../matchEnvironment";
// Whiteout Pass lighting and atmosphere, one entry per time of day (night is the default,
// sunset is the alpenglow hero look). Everything the alpine scene needs to change between
// the two lives here.
import type { Look, TimeOfDay } from "../lighting";
import { blendTable } from "../lookBlend";

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
    ambientColor: "#bac6d4",
    hemi: ["#b8c8d6", "#8a929b", 1.05],
    sun: { color: "#ffb07a", intensity: 1.7, pos: [-60, 12, 55] },
    ambient: 0.16,
    camFar: 12000,
    // low in the south-west, the way the winter sun sets in the Alps
    sunDir: [-0.72, 0.13, 0.68],
    skyTop: "#2c4a86",
    skyMid: "#8a8fc4",
    skyHorizon: "#f6b48e",
    sunGlow: "#ffd09a",
    peakLit: "#f4c4a4",
    peakShade: "#7b8a9b",
    haze: "#b9bbc4",
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
    // strong cold moonlight for crisp highlights and real shadows; a dim sky fill
    hemi: ["#93a8dc", "#2a3452", 0.9],
    sun: { color: "#d4deff", intensity: 2.2, pos: [40, 60, -50] },
    ambient: 0.07,
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

/** the look part-way from sunset (k = 0) to night (k = 1): the waves carry the match into night */
const blended = new Map<number, AlpineLook>();
const DAY_LOOKS: Record<"sunny" | "rain", AlpineLook> = Object.fromEntries(
  (["sunny", "rain"] as const).map((kind) => {
    const rain = kind === "rain";
    return [
      kind,
      {
        ...ALPINE_LOOKS.sunset,
        sky: rain ? "#8b9ba8" : "#75b6eb",
        fog: [180, rain ? 1900 : 3600],
        fogColor: rain ? "#aab6c1" : "#d4e6ef",
        fogSun: { color: "#d4e6ef", k: 0.04 },
        sunDir: [-0.5, 0.82, 0.28],
        skyTop: rain ? "#6f8295" : "#287bc3",
        skyMid: rain ? "#94a3ae" : "#7bbcf0",
        skyHorizon: rain ? "#bbc5cc" : "#d4e6ef",
        sunGlow: "#fff4dc",
        peakLit: "#fff9e8",
        peakShade: "#8cb4d1",
        haze: rain ? "#adb8c1" : "#c5dcea",
        windows: rain ? 0.5 : 0.08,
        lamps: rain ? 0.45 : 0.05,
        aurora: 0,
        snow: "#eff7ff",
        blizzard: "#b9c6d1",
      },
    ];
  }),
) as Record<"sunny" | "rain", AlpineLook>;
export function alpineLookAt(k: number): AlpineLook {
  if (matchEnvironment.kind === "sunny" || matchEnvironment.kind === "rain")
    return DAY_LOOKS[matchEnvironment.kind];
  if (k <= 0) return ALPINE_LOOKS.sunset;
  if (k >= 1) return ALPINE_LOOKS.night;
  const key = Math.round(k * 256);
  let l = blended.get(key);
  if (!l) {
    if (blended.size > 300) blended.clear();
    l = blendTable(ALPINE_LOOKS.sunset, ALPINE_LOOKS.night, key / 256);
    blended.set(key, l);
  }
  return l;
}
