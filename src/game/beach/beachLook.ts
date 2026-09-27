// Every lighting and atmosphere number for Pacific Pier, per time of day. The game still has
// one boolean (`night`); night = true -> "night", night = false -> "sunset" (the hero look:
// the sun setting into the Pacific right at the end of the pier). Remap here, nowhere else.
import type { Look } from "../lighting";

export type BeachMode = "night" | "sunset";
export const beachMode = (night: boolean): BeachMode => (night ? "night" : "sunset");

export type BeachLook = {
  look: Look;
  /** direction towards the sun (sunset) or the moon (night) */
  sunDir: [number, number, number];
  sky: {
    zenith: string;
    mid: string;
    /** horizon colour towards the sun and away from it */
    horizonSun: string;
    horizonAway: string;
    /** the band just above the horizon */
    band: string;
    below: string;
    /** the disc and its halo */
    disc: string;
    halo: string;
    clouds: string;
    cloudLit: string;
  };
  water: { deep: string; shallow: string; foam: string; glint: string; glintK: number };
  /** sand albedo multiplier, wet-sand sheen colour */
  sand: string;
  /** emissive multipliers */
  neon: number;
  windows: number;
  lamps: number;
  pools: number;
  wheel: number;
  /** marine layer (boss round): fog pulled in to this range, in this colour */
  hazardFog: [number, number];
  hazardCol: string;
  shadows: boolean;
};

export const BEACH_LOOK: Record<BeachMode, BeachLook> = {
  sunset: {
    look: {
      sky: "#ef9f86",
      fog: [70, 1500],
      hemi: ["#c9b0e0", "#8a5a44", 0.95],
      sun: { color: "#ffb070", intensity: 2.5, pos: [-400, 50, 60] },
      ambient: 0.1,
      camFar: 3200,
    },
    sunDir: [-0.985, 0.075, 0.155],
    sky: {
      zenith: "#23306a",
      mid: "#6c5096",
      horizonSun: "#ffc060",
      horizonAway: "#f2a08c",
      band: "#ff8a6a",
      below: "#4a3040",
      disc: "#fff2c0",
      halo: "#ffb050",
      clouds: "#7a5a8a",
      cloudLit: "#ffb088",
    },
    water: { deep: "#23365e", shallow: "#3f6a82", foam: "#ffe8d8", glint: "#ffd890", glintK: 1.6 },
    sand: "#e8c8a0",
    neon: 0.9,
    windows: 0.55,
    lamps: 1.0,
    pools: 0.35,
    wheel: 1.1,
    hazardFog: [6, 95],
    hazardCol: "#c8a8a8",
    shadows: true,
  },
  night: {
    look: {
      sky: "#0b1226",
      fog: [60, 1300],
      hemi: ["#5a70b8", "#2a2234", 0.62],
      sun: { color: "#a8c0ff", intensity: 0.55, pos: [-300, 190, -140] },
      ambient: 0.2,
      camFar: 3200,
    },
    sunDir: [-0.74, 0.46, -0.49],
    sky: {
      zenith: "#02040c",
      mid: "#0a1330",
      horizonSun: "#2a3560",
      horizonAway: "#22203c",
      band: "#3a2c48",
      below: "#060812",
      disc: "#f4f6ff",
      halo: "#8898d0",
      clouds: "#141a30",
      cloudLit: "#3a4468",
    },
    water: { deep: "#050c1c", shallow: "#0c1e34", foam: "#8aa0c0", glint: "#d8e4ff", glintK: 1.2 },
    sand: "#8a8aa0",
    neon: 1.45,
    windows: 1.0,
    lamps: 1.5,
    pools: 1.0,
    wheel: 1.7,
    hazardFog: [5, 70],
    hazardCol: "#1a2030",
    shadows: false,
  },
};

export const beachLook = (night: boolean) => BEACH_LOOK[beachMode(night)];
