export type AbilityId =
  | "dash" | "well" | "repulse" | "nova"
  | "storm" | "warp" | "barrier" | "strike";

export type AbilityInfo = { name: string; desc: string; cd: number };

export const ABILITY_IDS: AbilityId[] = [
  "dash", "well", "repulse", "nova", "storm", "warp", "barrier", "strike",
];

export const ABILITIES: Record<AbilityId, AbilityInfo> = {
  dash: { name: "PHASE DASH", desc: "Burst forward and shrug off every hit for a moment.", cd: 6 },
  well: { name: "GRAVITY WELL", desc: "Yanks every enemy within 13 metres into one spot ahead of you and slows them.", cd: 16 },
  repulse: { name: "REPULSOR WAVE", desc: "Shockwave throws nearby enemies back and deals 2.", cd: 12 },
  nova: { name: "CRYO NOVA", desc: "Freezes everything within 8 metres for 3.5 seconds.", cd: 15 },
  storm: { name: "CHAIN STORM", desc: "Lightning strikes the 6 closest enemies for 4 damage each.", cd: 14 },
  warp: { name: "TIME WARP", desc: "Slows every enemy on the map for 5 seconds.", cd: 24 },
  barrier: { name: "KINETIC BARRIER", desc: "Blocks all damage for 6 seconds.", cd: 22 },
  strike: { name: "ORBITAL STRIKE", desc: "Marks a spot 10 metres ahead; a beam hits it for 7 a second later.", cd: 18 },
};
