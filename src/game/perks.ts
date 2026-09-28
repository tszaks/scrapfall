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
  dmg: { name: "HOLLOW POINTS", desc: "+15% damage, every gun", base: 8, color: "#e8322a" },
  rate: { name: "HAIR TRIGGER", desc: "+15% fire rate, every gun", base: 8, color: "#ff9d3b" },
  speed: { name: "LIGHT BOOTS", desc: "+20% move speed", base: 6, color: "#4fe3ff" },
  maxhp: { name: "IRON HEART", desc: "+2 max health", base: 10, color: "#b3261e" },
  heal: { name: "PATCH KIT", desc: "Restore 5 health now", base: 5, color: "#7cff4f" },
  magnet: { name: "SHARD MAGNET", desc: "Pull shards from farther away", base: 4, color: "#5ff6ff" },
  greed: { name: "PROSPECTOR", desc: "+25% shards from kills", base: 7, color: "#e7b25c" },
  regen: { name: "NANO MEND", desc: "Slowly regenerate health", base: 12, color: "#a855f7" },
  steal: { name: "BLOOD SIPHON", desc: "+3% life steal on all damage you deal", base: 9, color: "#d6204f" },
  mend: { name: "FIELD MEDIC", desc: "+3 health after every wave", base: 8, color: "#4fd88a" },
  crit: { name: "EAGLE EYE", desc: "+15% chance to hit for double damage", base: 9, color: "#ffe14f" },
  boom: { name: "COMBUSTION", desc: "+10% chance kills explode for 3 splash", base: 10, color: "#ff5c1f" },
  knock: { name: "KINETIC FORCE", desc: "+20% knockback on every hit", base: 6, color: "#9ad0ff" },
  ammo: { name: "DEEP POCKETS", desc: "+25% ammo in guns you pick up", base: 7, color: "#c8b47a" },
  armor: { name: "NANITE PLATING", desc: "+15% less damage taken", base: 11, color: "#8fa3b8" },
  thorns: { name: "SHOCK THORNS", desc: "+20% chance to zap attackers for 2", base: 9, color: "#7ce8ff" },
  ricochet: { name: "RUBBER BULLETS", desc: "+25% chance shots bounce off walls", base: 8, color: "#7cff4f" },
  leech: { name: "VAMPIRIC LEECH", desc: "+8% chance a kill restores 1 health", base: 10, color: "#ff4f8b" },
  dodge: { name: "PHASE SHIFT", desc: "+6% chance an enemy hit passes right through you", base: 10, color: "#b06bff" },
  haste: { name: "RECHARGE COILS", desc: "-12% ability cooldown", base: 9, color: "#5f9bff" },
  pierce: { name: "PENETRATOR", desc: "Your shots punch through 1 more enemy", base: 12, color: "#f2ead6" },
  freeroll: { name: "SUPPLY TOKENS", desc: "+1 free shop reroll every break", base: 10, color: "#c8f07a" },

  // ---- trade-off cards: real power, real cost ----
  glass: { name: "GLASS CANNON", desc: "", base: 11, color: "#e8322a", pros: ["+35% Firepower"], cons: ["-3 Max HP"] },
  plating: { name: "HEAVY PLATING", desc: "", base: 11, color: "#8fa3b8", pros: ["+25% Armor", "+10% Knockback"], cons: ["-15% Move Speed"] },
  overclock: { name: "OVERCLOCK", desc: "", base: 11, color: "#ff9d3b", pros: ["+30% Fire Rate"], cons: ["-20% Ammo Capacity"] },
  bloodpact: { name: "BLOOD PACT", desc: "", base: 12, color: "#d6204f", pros: ["+5% Life Steal"], cons: ["-2 Max HP", "-10% Armor"] },
  leadcore: { name: "LEAD CORE", desc: "", base: 12, color: "#c8b47a", pros: ["+20% Firepower", "+1 Piercing"], cons: ["-15% Fire Rate"] },
  spikes: { name: "SPRINTER SPIKES", desc: "", base: 9, color: "#4fe3ff", pros: ["+25% Move Speed"], cons: ["-10% Firepower"] },
  greedp: { name: "GREED PROTOCOL", desc: "", base: 10, color: "#e7b25c", pros: ["+50% Shard Yield"], cons: ["-15% Armor"] },
  valve: { name: "ADRENALINE VALVE", desc: "", base: 11, color: "#5f9bff", pros: ["-25% Ability Cooldown"], cons: ["-10% Armor"] },
  cluster: { name: "CLUSTER CHARGE", desc: "", base: 11, color: "#ff5c1f", pros: ["+25% Combustion chance"], cons: ["-10% Firepower"] },

  burst: { name: "BURST RECEIVER", desc: "Pistol fires a 3-round burst", base: 14, color: "#ffb347", max: 1, trigger: true },
  incend: { name: "INCENDIARY ROUNDS", desc: "Pistol hits burn for 1/sec over 3s", base: 14, color: "#ff7043", max: 1 },
  magnum: { name: "MAGNUM BREECH", desc: "Pistol: +1 damage, faster, pierces 1", base: 14, color: "#e8e2d4", max: 1 },
  extmag: { name: "EXTENDED MAG", desc: "Pistol: 220 rounds each wave instead of 140", base: 12, color: "#000", max: 1 },
  shred: { name: "SHREDDER ROUNDS", desc: "Pistol hits make enemies take +30% damage for 3s", base: 14, color: "#000", max: 1 },
  laser: { name: "LASER SIGHT", desc: "Pistol: red aiming laser, +25% crit chance", base: 13, color: "#000", max: 1 },
  comp: { name: "HEAVY COMPENSATOR", desc: "Pistol: no recoil, +30% bullet speed, heavy knockback", base: 12, color: "#000", max: 1 },
  suppr: { name: "WHISPER SUPPRESSOR", desc: "Pistol: quiet shots, crits deal triple damage", base: 13, color: "#000", max: 1 },
  exec: { name: "EXECUTIONER HAMMER", desc: "Pistol: double damage to enemies under half health", base: 14, color: "#000", max: 1 },
  holster: { name: "SPEED HOLSTER", desc: "+15% move speed while holding the pistol", base: 11, color: "#000", max: 1 },
  bounty: { name: "BOUNTY EXTRACTOR", desc: "Pistol kills: +1 shard, every 6th heals 1", base: 13, color: "#000", max: 1 },
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
    case "dmg": return `DMG +${pct(0.15)}`;
    case "rate": return `RATE +${pct(0.15)}`;
    case "speed": return `SPEED +${pct(0.2)}`;
    case "maxhp": return `MAX HP +${lvl * 2}`;
    case "magnet": return `MAGNET x${lvl}`;
    case "greed": return `SHARDS +${pct(0.25)}`;
    case "regen": return `REGEN x${lvl}`;
    case "steal": return `LIFESTEAL ${pct(0.03)}`;
    case "mend": return `WAVE HEAL +${lvl * 3}`;
    case "crit": return `CRIT ${pct(0.15, 0.75)}`;
    case "boom": return `COMBUST ${pct(0.1, 0.6)}`;
    case "knock": return `KNOCK +${pct(0.2)}`;
    case "ammo": return `AMMO +${pct(0.25)}`;
    case "armor": return `ARMOR ${pct(0.15, 0.6)}`;
    case "thorns": return `THORNS ${pct(0.2, 0.8)}`;
    case "ricochet": return `BOUNCE ${pct(0.25, 0.75)}`;
    case "leech": return `LEECH ${pct(0.08, 0.5)}`;
    case "dodge": return `DODGE ${pct(0.06, 0.5)}`;
    case "haste": return `HASTE ${pct(0.12, 0.6)}`;
    case "pierce": return `PIERCE +${lvl}`;
    case "freeroll": return `FREE REROLL x${lvl}`;
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
