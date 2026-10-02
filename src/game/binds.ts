// Remappable keyboard bindings + controller options, saved in the browser.
export type Action = "jump" | "run" | "fire" | "ability" | "use" | "ping" | "scope" | "prev" | "next";
export const ACTION_LABEL: Record<Action, string> = {
  jump: "JUMP", run: "RUN", fire: "FIRE", ability: "ABILITY", use: "USE / ELEVATOR",
  ping: "PING", scope: "AIM / SCOPE", prev: "PREV WEAPON", next: "NEXT WEAPON",
};
const DEFAULTS: Record<Action, string> = {
  jump: "Space", run: "ShiftLeft", fire: "Enter", ability: "KeyF", use: "KeyE",
  ping: "KeyZ", scope: "KeyX", prev: "KeyQ", next: "KeyE",
};
export const binds: Record<Action, string> = { ...DEFAULTS };
export const padOpts = { assist: true, sens: 1 };
let loaded = false;
export function loadBinds() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    Object.assign(binds, JSON.parse(localStorage.getItem("scrapfall-binds") ?? "{}"));
    Object.assign(padOpts, JSON.parse(localStorage.getItem("scrapfall-pad") ?? "{}"));
  } catch { /* fresh defaults */ }
}
export function saveBinds() {
  localStorage.setItem("scrapfall-binds", JSON.stringify(binds));
  localStorage.setItem("scrapfall-pad", JSON.stringify(padOpts));
}
export function resetBinds() { Object.assign(binds, DEFAULTS); saveBinds(); }
const ALT: Partial<Record<string, string>> = { ShiftLeft: "ShiftRight", Enter: "NumpadEnter" };
export const is = (a: Action, code: string) => binds[a] === code || ALT[binds[a]] === code;
export const held = (a: Action, keys: Set<string>) => keys.has(binds[a]) || (!!ALT[binds[a]] && keys.has(ALT[binds[a]]!));
export const keyName = (code: string) =>
  code.replace(/^Key/, "").replace(/^Digit/, "").replace("ShiftLeft", "SHIFT").replace("ShiftRight", "R-SHIFT").replace("ControlLeft", "CTRL").toUpperCase();
