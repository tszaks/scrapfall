export type PerkId =
  | "dmg" | "rate" | "speed" | "maxhp" | "heal" | "magnet" | "greed" | "regen"
  | "crit" | "boom" | "knock" | "ammo" | "armor" | "thorns" | "ricochet" | "leech"
  | "burst" | "incend" | "magnum";
export type Perks = Record<PerkId, number>;

export const NO_PERKS: Perks = {
  dmg: 0, rate: 0, speed: 0, maxhp: 0, heal: 0, magnet: 0, greed: 0, regen: 0,
  crit: 0, boom: 0, knock: 0, ammo: 0, armor: 0, thorns: 0, ricochet: 0, leech: 0,
  burst: 0, incend: 0, magnum: 0,
};

export const PERK_INFO: Record<PerkId, { name: string; desc: string; base: number; color: string; max?: number }> = {
  dmg: { name: "HOLLOW POINTS", desc: "+15% damage, every gun", base: 8, color: "#e8322a" },
  rate: { name: "HAIR TRIGGER", desc: "+15% fire rate, every gun", base: 8, color: "#ff9d3b" },
  speed: { name: "LIGHT BOOTS", desc: "+20% move speed", base: 6, color: "#4fe3ff" },
  maxhp: { name: "IRON HEART", desc: "+2 max health", base: 10, color: "#b3261e" },
  heal: { name: "PATCH KIT", desc: "Restore 5 health now", base: 5, color: "#7cff4f" },
  magnet: { name: "SHARD MAGNET", desc: "Pull shards from farther away", base: 4, color: "#5ff6ff" },
  greed: { name: "PROSPECTOR", desc: "+25% shards from kills", base: 7, color: "#e7b25c" },
  regen: { name: "NANO MEND", desc: "Slowly regenerate health", base: 12, color: "#a855f7" },
  crit: { name: "EAGLE EYE", desc: "+15% chance to hit for double damage", base: 9, color: "#ffe14f" },
  boom: { name: "COMBUSTION", desc: "+10% chance kills explode for 3 splash", base: 10, color: "#ff5c1f" },
  knock: { name: "KINETIC FORCE", desc: "+20% knockback on every hit", base: 6, color: "#9ad0ff" },
  ammo: { name: "DEEP POCKETS", desc: "+25% ammo in guns you pick up", base: 7, color: "#c8b47a" },
  armor: { name: "NANITE PLATING", desc: "+15% less damage taken", base: 11, color: "#8fa3b8" },
  thorns: { name: "SHOCK THORNS", desc: "+20% chance to zap attackers for 2", base: 9, color: "#7ce8ff" },
  ricochet: { name: "RUBBER BULLETS", desc: "+25% chance shots bounce off walls", base: 8, color: "#7cff4f" },
  leech: { name: "VAMPIRIC LEECH", desc: "+8% chance a kill restores 1 health", base: 10, color: "#ff4f8b" },
  burst: { name: "BURST RECEIVER", desc: "Pistol fires a 3-round burst", base: 14, color: "#ffb347", max: 1 },
  incend: { name: "INCENDIARY ROUNDS", desc: "Pistol hits burn for 1/sec over 3s", base: 14, color: "#ff7043", max: 1 },
  magnum: { name: "MAGNUM BREECH", desc: "Pistol: +1 damage, faster, pierces 1", base: 14, color: "#e8e2d4", max: 1 },
};

export const PERK_IDS = Object.keys(PERK_INFO) as PerkId[];

export const perkCost = (id: PerkId, lvl: number) =>
  id === "heal" ? PERK_INFO.heal.base : Math.round(PERK_INFO[id].base * (1 + 0.5 * lvl));

export const perkMaxed = (id: PerkId, lvl: number) => {
  const max = PERK_INFO[id].max;
  return max !== undefined && lvl >= max;
};

export const derive = (p: Perks) => ({
  dmg: 1 + 0.15 * p.dmg,
  rate: 1 + 0.15 * p.rate,
  speed: 1 + 0.2 * p.speed,
  maxHp: 10 + 2 * p.maxhp,
  magnet: 2 + 1.5 * p.magnet,
  greed: 1 + 0.25 * p.greed,
  regen: p.regen,
  crit: Math.min(0.75, 0.15 * p.crit),
  boom: Math.min(0.6, 0.1 * p.boom),
  knock: 0.2 * p.knock,
  ammoMul: 1 + 0.25 * p.ammo,
  armor: Math.min(0.6, 0.15 * p.armor),
  thorns: Math.min(0.8, 0.2 * p.thorns),
  ricochet: Math.min(0.75, 0.25 * p.ricochet),
  leech: Math.min(0.5, 0.08 * p.leech),
  burst: p.burst > 0,
  incend: p.incend > 0,
  magnum: p.magnum > 0,
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
    case "crit": return `CRIT ${pct(0.15, 0.75)}`;
    case "boom": return `COMBUST ${pct(0.1, 0.6)}`;
    case "knock": return `KNOCK +${pct(0.2)}`;
    case "ammo": return `AMMO +${pct(0.25)}`;
    case "armor": return `ARMOR ${pct(0.15, 0.6)}`;
    case "thorns": return `THORNS ${pct(0.2, 0.8)}`;
    case "ricochet": return `BOUNCE ${pct(0.25, 0.75)}`;
    case "leech": return `LEECH ${pct(0.08, 0.5)}`;
    case "burst": return "BURST";
    case "incend": return "INCENDIARY";
    case "magnum": return "MAGNUM";
    default: return null;
  }
};

export const PISTOL_MODS: PerkId[] = ["burst", "incend", "magnum"];

