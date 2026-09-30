import type { Theme } from "./themes";

/** What happens when a hazard prop is shot open. */
export type HazardEffect = "fire" | "freeze" | "toxic" | "shock" | "root" | "pull";

export type HazardDef = {
  name: string;
  effect: HazardEffect;
  /** outer body colour */
  shell: string;
  /** glowing core / blast colour */
  core: string;
  /** blast radius in metres */
  radius: number;
  /** direct damage dealt to everything caught in the blast */
  damage: number;
  /** visual family, matched to the map's own props */
  look: "drum" | "pod" | "condenser" | "relay" | "geyser" | "vat";
};

const BY_SHAPE: Record<Theme["blockShape"], HazardDef> = {
  // deserts and badlands: scavenged fuel drums
  monument: { name: "FUEL DRUM", effect: "fire", shell: "#b4653f", core: "#ff8c2a", radius: 6, damage: 14, look: "drum" },
  butte: { name: "FUEL DRUM", effect: "fire", shell: "#9a5530", core: "#ffb02a", radius: 6, damage: 14, look: "drum" },
  // volcanic: pressurised magma vents
  basalt: { name: "MAGMA VENT", effect: "fire", shell: "#4a3c38", core: "#ff5a1a", radius: 6.5, damage: 16, look: "geyser" },
  // ice: cryo condensers flash-freeze the area
  crystal: { name: "CRYO CONDENSER", effect: "freeze", shell: "#8fc4dc", core: "#9ff0ff", radius: 7, damage: 6, look: "condenser" },
  berg: { name: "CRYO CONDENSER", effect: "freeze", shell: "#b0d0ec", core: "#7fe8ff", radius: 7, damage: 6, look: "condenser" },
  // forests: bursting pods tangle everything nearby
  tree: { name: "SPORE POD", effect: "root", shell: "#6a4a7a", core: "#d4ff3a", radius: 6, damage: 8, look: "pod" },
  pagoda: { name: "BRAMBLE POD", effect: "root", shell: "#b03a5a", core: "#ff9ac0", radius: 6, damage: 8, look: "pod" },
  // deep sea: a vent that drags everything into it before it pops
  coral: { name: "BRINE GEYSER", effect: "pull", shell: "#1f6a7a", core: "#5affd8", radius: 8, damage: 9, look: "geyser" },
  // neon city: capacitors arc between targets
  server: { name: "EMP RELAY", effect: "shock", shell: "#5a5e68", core: "#3a8aff", radius: 7.5, damage: 11, look: "relay" },
  // industrial: caustic sludge
  vat: { name: "SLUDGE VAT", effect: "toxic", shell: "#8a6a2a", core: "#9aff3a", radius: 6.5, damage: 10, look: "vat" },
  // Vice Heights: fuel drums stashed by the gas station pumps
  city: { name: "FUEL DRUM", effect: "fire", shell: "#b4653f", core: "#ff8c2a", radius: 6, damage: 14, look: "drum" },
  // Dry Gulch: mining powder kegs
  western: { name: "POWDER KEG", effect: "fire", shell: "#6a4a2a", core: "#ffb02a", radius: 6, damage: 15, look: "drum" },
  // Pacific Pier: boat gas canisters
  beach: { name: "GAS CANISTER", effect: "fire", shell: "#b43a2a", core: "#ff8c2a", radius: 6, damage: 13, look: "drum" },
  // Whiteout Pass: snow cannons around the village square flash-freeze the run (Toby 1.0.6)
  alpine: { name: "SNOW CANNON", effect: "freeze", shell: "#c8302a", core: "#bff4ff", radius: 7.5, damage: 7, look: "condenser" },
  // Nuketown is being rebuilt; a def exists so the type is total but none spawn there
  nuketown: { name: "WASTE DRUM", effect: "toxic", shell: "#5a6a2a", core: "#9aff3a", radius: 6.5, damage: 10, look: "drum" },
};

export function hazardFor(theme: Theme): HazardDef {
  return BY_SHAPE[theme.blockShape];
}

/** Maps that get no hazard props at all (Nuketown is being rebuilt). */
export function hazardsEnabled(theme: Theme): boolean {
  return theme.blockShape !== "nuketown";
}

/**
 * Whether the four big maps (Vice Heights, Dry Gulch, Pacific Pier, Whiteout Pass) spawn
 * shootable landmark hazards — drums at the gas station, kegs at the mine, and so on.
 * Toby's arenas always get theirs; this single switch decides ours either way.
 */
export const BIG_MAP_HAZARDS = true;

/** How many hazard props an arena gets. */
export const HAZARD_COUNT = 5;
/** Big maps are huge — a few more props so some actually sit near the fights. */
export const HAZARD_COUNT_BIG = 8;
