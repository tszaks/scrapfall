/** Total ammunition includes the loaded magazine. Reload moves no total ammo. */
export const MAGAZINE: Record<string, number> = {
  pistol: 12,
  scatter: 6,
  smg: 30,
  rail: 4,
  cannon: 1,
  rebound: 10,
  harpoon: 4,
  cryo: 30,
  flak: 2,
  tesla: 20,
  revolver: 6,
  minigun: 60,
  crossbow: 1,
  plasma: 12,
  voidorb: 3,
  shatter: 4,
  sniper: 4,
};
export const supply = {
  loaded: {} as Record<string, number>,
  weapon: "pistol",
  remaining: 0,
  reloading: "",
  text: "",
  buy: 0,
  melee: false,
};
export function resetSupply() {
  supply.loaded = {};
  supply.remaining = 0;
  supply.reloading = "";
  supply.buy = 0;
  supply.melee = false;
}
export function magazine(w: string, total: number) {
  return (supply.loaded[w] = Math.min(
    total,
    supply.loaded[w] ?? Math.min(MAGAZINE[w] ?? 12, total),
  ));
}
export function beginReload(w: string, total: number) {
  const loaded = magazine(w, total);
  if (supply.remaining > 0 || loaded >= Math.min(MAGAZINE[w] ?? 12, total)) return false;
  supply.reloading = w;
  supply.remaining = w === "minigun" ? 2.4 : w === "pistol" ? 1.1 : 1.6;
  return true;
}
export function tickReload(dt: number, w: string, total: number) {
  if (supply.reloading && supply.reloading !== w) {
    supply.reloading = "";
    supply.remaining = 0;
  }
  if (supply.remaining > 0) {
    supply.remaining = Math.max(0, supply.remaining - dt);
    if (!supply.remaining) {
      supply.loaded[w] = Math.min(MAGAZINE[w] ?? 12, total);
      supply.reloading = "";
    }
  }
  supply.weapon = w;
  supply.text =
    supply.remaining > 0
      ? `RELOADING · ${supply.remaining.toFixed(1)}s`
      : `${magazine(w, total)} / ${Math.max(0, total - magazine(w, total))} · RELOAD`;
}
export const AMMO_COST = 8;
