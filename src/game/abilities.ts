export type AbilityId =
  | "dash" | "pool" | "repulse" | "nova"
  | "flare" | "mortar" | "barrier" | "overdrive";

export type AbilityInfo = { name: string; desc: string; cd: number };

export const ABILITY_IDS: AbilityId[] = [
  "dash", "pool", "repulse", "nova", "flare", "mortar", "barrier", "overdrive",
];

export const ABILITIES: Record<AbilityId, AbilityInfo> = {
  dash: { name: "PHASE DASH", desc: "Burst forward and shrug off every hit for a moment.", cd: 6 },
  pool: { name: "NANITE POOL", desc: "Heals you 1 health a second for 3 seconds.", cd: 24 },
  repulse: { name: "REPULSOR WAVE", desc: "Shockwave throws nearby enemies back and deals 2.", cd: 12 },
  nova: { name: "CRYO NOVA", desc: "Freezes everything within 8 metres for 3.5 seconds.", cd: 15 },
  flare: { name: "DECOY FLARE", desc: "Stuns enemies around you for 4 seconds, then blasts them.", cd: 20 },
  mortar: { name: "CLUSTER MORTAR", desc: "Lobs a shell that splits into 5 bomblets.", cd: 14 },
  barrier: { name: "KINETIC BARRIER", desc: "Blocks all damage for 6 seconds.", cd: 22 },
  overdrive: { name: "ADRENALINE", desc: "4 seconds of double fire rate, more speed, free ammo.", cd: 25 },
};
