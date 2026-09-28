export type PerkId =
  | "dmg" | "rate" | "speed" | "maxhp" | "heal" | "magnet" | "greed" | "regen"
  | "crit" | "boom" | "knock" | "ammo" | "armor" | "thorns" | "ricochet" | "leech"
  | "burst" | "incend" | "magnum"
  | "extmag" | "shred" | "laser" | "comp" | "suppr" | "exec" | "holster" | "bounty"
  | "steal" | "mend"
  | "dodge" | "haste" | "pierce" | "freeroll"
  | "glass" | "plating" | "overclock" | "bloodpact" | "leadcore" | "spikes" | "greedp" | "valve" | "cluster";
export type Perks = Record<PerkId, number>;

/** flat adjustments a starter class layers on top of the perk maths */
export type StatMods = Partial<{
  dmg: number; rate: number; speed: number; maxHp: number; armor: number; knock: number;
  crit: number; pierce: number; magnet: number; greed: number; ammoMul: number; steal: number;
  boom: number; dodge: number; haste: number; freeRerolls: number; noRegen: boolean;
}>;

export const NO_PERKS: Perks = {
  dmg: 0, rate: 0, speed: 0, maxhp: 0, heal: 0, magnet: 0, greed: 0, regen: 0,
  crit: 0, boom: 0, knock: 0, ammo: 0, armor: 0, thorns: 0, ricochet: 0, leech: 0,
  burst: 0, incend: 0, magnum: 0,
  extmag: 0, shred: 0, laser: 0, comp: 0, suppr: 0, exec: 0, holster: 0, bounty: 0,
  steal: 0, mend: 0,
  dodge: 0, haste: 0, pierce: 0, freeroll: 0,
  glass: 0, plating: 0, overclock: 0, bloodpact: 0, leadcore: 0, spikes: 0, greedp: 0, valve: 0, cluster: 0,
};

export type PerkEntry = {
  name: string; desc: string; base: number; color: string;
  max?: number; trigger?: boolean;
  /** trade-off cards list their upside and downside separately */
  pros?: string[]; cons?: string[];
};

export const PERK_INFO: Record<PerkId, PerkEntry> = {
  dmg: { name: "HOLLOW POINTS", desc: "+15% Firepower", base: 8, color: "#e8322a" },
  rate: { name: "HAIR TRIGGER", desc: "+15% Cycle Rate", base: 8, color: "#ff9d3b" },
  speed: { name: "LIGHT BOOTS", desc: "+20% Thruster Speed", base: 6, color: "#4fe3ff" },
  maxhp: { name: "IRON HEART", desc: "+2 Hull Integrity", base: 10, color: "#b3261e" },
  heal: { name: "PATCH KIT", desc: "Restore 5 Hull Integrity now", base: 5, color: "#7cff4f" },
  magnet: { name: "SHARD MAGNET", desc: "+1.5m Flux Magnet", base: 4, color: "#5ff6ff" },
  greed: { name: "PROSPECTOR", desc: "+25% Salvage Yield", base: 7, color: "#e7b25c" },
  regen: { name: "NANO MEND", desc: "+1 Nano-Regen", base: 12, color: "#a855f7" },
  steal: { name: "BLOOD SIPHON", desc: "+3% Life Siphon", base: 9, color: "#d6204f" },
  mend: { name: "FIELD MEDIC", desc: "+3 Hull Integrity after every wave", base: 8, color: "#4fd88a" },
  crit: { name: "EAGLE EYE", desc: "+15% Crit Protocol", base: 9, color: "#ffe14f" },
  boom: { name: "COMBUSTION", desc: "+10% Combustion (3 splash)", base: 10, color: "#ff5c1f" },
  knock: { name: "KINETIC FORCE", desc: "+20% Impact Force", base: 6, color: "#9ad0ff" },
  ammo: { name: "DEEP POCKETS", desc: "+25% Ammo Capacity", base: 7, color: "#c8b47a" },
  armor: { name: "NANITE PLATING", desc: "+15% Armor Plating", base: 11, color: "#8fa3b8" },
  thorns: { name: "SHOCK THORNS", desc: "+20% Shock Thorns (2 damage)", base: 9, color: "#7ce8ff" },
  ricochet: { name: "RUBBER BULLETS", desc: "+25% Ricochet", base: 8, color: "#7cff4f" },
  leech: { name: "VAMPIRIC LEECH", desc: "+8% chance a kill restores 1 Hull Integrity", base: 10, color: "#ff4f8b" },
  dodge: { name: "PHASE SHIFT", desc: "+6% Phase Shift", base: 10, color: "#b06bff" },
  haste: { name: "RECHARGE COILS", desc: "+12% Recharge Haste", base: 9, color: "#5f9bff" },
  pierce: { name: "PENETRATOR", desc: "+1 Piercing", base: 12, color: "#f2ead6" },
  freeroll: { name: "SUPPLY TOKENS", desc: "+1 Free Reroll every break", base: 10, color: "#c8f07a" },

  // ---- trade-off cards: real power, real cost ----
  glass: { name: "GLASS CANNON", desc: "", base: 11, color: "#e8322a", pros: ["+35% Firepower"], cons: ["-3 Hull Integrity"] },
  plating: { name: "HEAVY PLATING", desc: "", base: 11, color: "#8fa3b8", pros: ["+25% Armor Plating", "+10% Impact Force"], cons: ["-15% Thruster Speed"] },
  overclock: { name: "OVERCLOCK", desc: "", base: 11, color: "#ff9d3b", pros: ["+30% Cycle Rate"], cons: ["-20% Ammo Capacity"] },
  bloodpact: { name: "BLOOD PACT", desc: "", base: 12, color: "#d6204f", pros: ["+5% Life Siphon"], cons: ["-2 Hull Integrity", "-10% Armor Plating"] },
  leadcore: { name: "LEAD CORE", desc: "", base: 12, color: "#c8b47a", pros: ["+20% Firepower", "+1 Piercing"], cons: ["-15% Cycle Rate"] },
  spikes: { name: "SPRINTER SPIKES", desc: "", base: 9, color: "#4fe3ff", pros: ["+25% Thruster Speed"], cons: ["-10% Firepower"] },
  greedp: { name: "GREED PROTOCOL", desc: "", base: 10, color: "#e7b25c", pros: ["+50% Salvage Yield"], cons: ["-15% Armor Plating"] },
  valve: { name: "ADRENALINE VALVE", desc: "", base: 11, color: "#5f9bff", pros: ["+25% Recharge Haste"], cons: ["-10% Armor Plating"] },
  cluster: { name: "CLUSTER CHARGE", desc: "", base: 11, color: "#ff5c1f", pros: ["+25% Combustion"], cons: ["-10% Firepower"] },

  burst: { name: "BURST RECEIVER", desc: "Pistol fires a 3-round burst", base: 14, color: "#ffb347", max: 1, trigger: true },
  incend: { name: "INCENDIARY ROUNDS", desc: "Pistol hits burn for 1/sec over 3s", base: 14, color: "#ff7043", max: 1 },
  magnum: { name: "MAGNUM BREECH", desc: "Pistol: +1 Firepower, faster, +1 Piercing", base: 14, color: "#e8e2d4", max: 1 },
  extmag: { name: "EXTENDED MAG", desc: "Pistol Ammo Capacity: 220 rounds each wave instead of 140", base: 12, color: "#000", max: 1 },
  shred: { name: "SHREDDER ROUNDS", desc: "Pistol hits make enemies take +30% damage for 3s", base: 14, color: "#000", max: 1 },
  laser: { name: "LASER SIGHT", desc: "Pistol: red aiming laser, +25% Crit Protocol", base: 13, color: "#000", max: 1 },
  comp: { name: "HEAVY COMPENSATOR", desc: "Pistol: no recoil, +30% bullet speed, heavy Impact Force", base: 12, color: "#000", max: 1 },
  suppr: { name: "WHISPER SUPPRESSOR", desc: "Pistol: quiet shots, crits deal triple Firepower", base: 13, color: "#000", max: 1 },
  exec: { name: "EXECUTIONER HAMMER", desc: "Pistol: double Firepower vs enemies under half Hull Integrity", base: 14, color: "#000", max: 1 },
  holster: { name: "SPEED HOLSTER", desc: "+15% Thruster Speed while holding the pistol", base: 11, color: "#000", max: 1 },
  bounty: { name: "BOUNTY EXTRACTOR", desc: "Pistol kills: +1 shard, every 6th restores 1 Hull Integrity", base: 13, color: "#000", max: 1 },
};

export const PERK_IDS = Object.keys(PERK_INFO) as PerkId[];

export const perkCost = (id: PerkId, lvl: number) =>
  id === "heal" ? PERK_INFO.heal.base : Math.round(PERK_INFO[id].base * (1 + 0.5 * lvl));

export const perkMaxed = (id: PerkId, lvl: number) => {
  const max = PERK_INFO[id].max;
  return max !== undefined && lvl >= max;
};

export const derive = (p: Perks, m: StatMods = {}) => ({
  dmg: Math.max(0.3, 1 + 0.15 * p.dmg + 0.35 * p.glass + 0.2 * p.leadcore - 0.1 * p.spikes - 0.1 * p.cluster + (m.dmg ?? 0)),
  rate: Math.max(0.4, 1 + 0.15 * p.rate + 0.3 * p.overclock - 0.15 * p.leadcore + (m.rate ?? 0)),
  speed: Math.max(0.5, 1 + 0.2 * p.speed + 0.25 * p.spikes - 0.15 * p.plating + (m.speed ?? 0)),
  maxHp: Math.max(3, 10 + 2 * p.maxhp - 3 * p.glass - 2 * p.bloodpact + (m.maxHp ?? 0)),
  magnet: Math.max(0.5, 2 + 1.5 * p.magnet + (m.magnet ?? 0)),
  greed: 1 + 0.25 * p.greed + 0.5 * p.greedp + (m.greed ?? 0),
  regen: m.noRegen ? 0 : p.regen,
  steal: 0.03 * p.steal + 0.05 * p.bloodpact + (m.steal ?? 0),
  crit: Math.min(0.75, 0.15 * p.crit + (m.crit ?? 0)),
  boom: Math.min(0.6, 0.1 * p.boom + 0.25 * p.cluster + (m.boom ?? 0)),
  knock: 0.2 * p.knock + 0.1 * p.plating + (m.knock ?? 0),
  ammoMul: Math.max(0.4, 1 + 0.25 * p.ammo - 0.2 * p.overclock + (m.ammoMul ?? 0)),
  armor: Math.max(0, Math.min(0.6, 0.15 * p.armor + 0.25 * p.plating - 0.1 * p.bloodpact - 0.15 * p.greedp - 0.1 * p.valve + (m.armor ?? 0))),
  dodge: Math.min(0.5, 0.06 * p.dodge + (m.dodge ?? 0)),
  pierce: p.pierce + p.leadcore + (m.pierce ?? 0),
  haste: Math.min(0.6, 0.12 * p.haste + 0.25 * p.valve + (m.haste ?? 0)),
  freeRerolls: p.freeroll + (m.freeRerolls ?? 0),
  thorns: Math.min(0.8, 0.2 * p.thorns),
  ricochet: Math.min(0.75, 0.25 * p.ricochet),
  leech: Math.min(0.5, 0.08 * p.leech),
  burst: p.burst > 0,
  incend: p.incend > 0,
  magnum: p.magnum > 0,
  extmag: p.extmag > 0,
  shred: p.shred > 0,
  laser: p.laser > 0,
  comp: p.comp > 0,
  suppr: p.suppr > 0,
  exec: p.exec > 0,
  holster: p.holster > 0,
  bounty: p.bounty > 0,
});
export type Derived = ReturnType<typeof derive>;

// short HUD label for a purchased perk, e.g. "DMG +30%"
export const perkBadge = (id: PerkId, lvl: number): string | null => {
  if (lvl <= 0) return null;
  const pct = (per: number, cap?: number) => {
    const v = cap !== undefined ? Math.min(cap, per * lvl) : per * lvl;
    return `${Math.round(v * 100)}%`;
  };
  switch (id) {
    case "dmg": return `FIREPOWER +${pct(0.15)}`;
    case "rate": return `CYCLE RATE +${pct(0.15)}`;
    case "speed": return `THRUSTER SPEED +${pct(0.2)}`;
    case "maxhp": return `HULL INTEGRITY +${lvl * 2}`;
    case "magnet": return `FLUX MAGNET +${(lvl * 1.5).toFixed(1)}m`;
    case "greed": return `SALVAGE YIELD +${pct(0.25)}`;
    case "regen": return `NANO-REGEN +${lvl}`;
    case "steal": return `LIFE SIPHON ${pct(0.03)}`;
    case "mend": return `WAVE REPAIR +${lvl * 3}`;
    case "crit": return `CRIT PROTOCOL ${pct(0.15, 0.75)}`;
    case "boom": return `COMBUSTION ${pct(0.1, 0.6)}`;
    case "knock": return `IMPACT FORCE +${pct(0.2)}`;
    case "ammo": return `AMMO CAPACITY +${pct(0.25)}`;
    case "armor": return `ARMOR PLATING ${pct(0.15, 0.6)}`;
    case "thorns": return `SHOCK THORNS ${pct(0.2, 0.8)}`;
    case "ricochet": return `RICOCHET ${pct(0.25, 0.75)}`;
    case "leech": return `LEECH ${pct(0.08, 0.5)}`;
    case "dodge": return `PHASE SHIFT ${pct(0.06, 0.5)}`;
    case "haste": return `RECHARGE HASTE ${pct(0.12, 0.6)}`;
    case "pierce": return `PIERCING +${lvl}`;
    case "freeroll": return `FREE REROLLS +${lvl}`;
    case "burst": return "BURST";
    case "incend": return "INCENDIARY";
    case "magnum": return "MAGNUM";
    default: return `${PERK_INFO[id].name}${lvl > 1 ? ` x${lvl}` : ""}`;
  }
};

export const PISTOL_MODS: PerkId[] = ["burst", "incend", "magnum", "extmag", "shred", "laser", "comp", "suppr", "exec", "holster", "bounty"];
export const MOD_SLOTS = 3;
export const modsEquipped = (p: Perks) => PISTOL_MODS.filter((id) => p[id] > 0).length;

// what the shop may offer: pistol mods vanish once all 3 slots are filled,
// and only one mod that changes how the pistol fires is ever allowed
export const perkAvailable = (id: PerkId, p: Perks) => {
  if (perkMaxed(id, p[id])) return false;
  if (!PISTOL_MODS.includes(id)) return true;
  if (modsEquipped(p) >= MOD_SLOTS) return false;
  if (PERK_INFO[id].trigger && PISTOL_MODS.some((m) => PERK_INFO[m].trigger && p[m] > 0)) return false;
  return true;
};
