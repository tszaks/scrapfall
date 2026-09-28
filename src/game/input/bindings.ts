// Controller layout, glyphs and the player's controller settings.
//
// Buttons are named by their position on the pad (the W3C "standard" mapping), so one table
// serves Xbox, PlayStation and Switch Pro pads; only the printed glyph differs.

/** W3C standard-mapping button indices */
export const BTN = {
  A: 0, // bottom face (Xbox A, PlayStation Cross, Switch B)
  B: 1, // right face (Xbox B, Circle, Switch A)
  X: 2, // left face (Xbox X, Square, Switch Y)
  Y: 3, // top face (Xbox Y, Triangle, Switch X)
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  VIEW: 8, // Xbox View / PS Create (Share) / Switch minus
  START: 9, // Xbox Menu / PS Options / Switch plus
  LS: 10,
  RS: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
  HOME: 16,
} as const;
export type ButtonName = keyof typeof BTN;

export type PadType = "xbox" | "ps" | "switch" | "generic";

/** Guess the pad family from its id string (Chrome: "Xbox Wireless Controller (STANDARD GAMEPAD
 * Vendor: 045e Product: 0b13)", Safari: "DualSense Wireless Controller", Firefox: "054c-0ce6-..."). */
export function padTypeOf(id: string): PadType {
  const s = id.toLowerCase();
  // (Xbox first: "Xbox Wireless Controller" must not read as Sony's "Wireless Controller")
  if (/045e|xbox|xinput|microsoft/.test(s)) return "xbox";
  if (/057e|nintendo|pro controller|joy-con|switch/.test(s)) return "switch";
  if (/054c|dualsense|dualshock|playstation|ps4|ps5/.test(s)) return "ps";
  // Safari names a DualShock 4 just "Wireless Controller"
  if (s.startsWith("wireless controller")) return "ps";
  return "generic";
}

/** What each button is printed as, per pad family. */
const GLYPHS: Record<"xbox" | "ps" | "switch", Record<ButtonName, string>> = {
  xbox: {
    A: "A",
    B: "B",
    X: "X",
    Y: "Y",
    LB: "LB",
    RB: "RB",
    LT: "LT",
    RT: "RT",
    VIEW: "VIEW",
    START: "MENU",
    LS: "LS",
    RS: "RS",
    UP: "D-PAD ▲",
    DOWN: "D-PAD ▼",
    LEFT: "D-PAD ◀",
    RIGHT: "D-PAD ▶",
    HOME: "XBOX",
  },
  ps: {
    A: "✕",
    B: "○",
    X: "□",
    Y: "△",
    LB: "L1",
    RB: "R1",
    LT: "L2",
    RT: "R2",
    VIEW: "CREATE",
    START: "OPTIONS",
    LS: "L3",
    RS: "R3",
    UP: "D-PAD ▲",
    DOWN: "D-PAD ▼",
    LEFT: "D-PAD ◀",
    RIGHT: "D-PAD ▶",
    HOME: "PS",
  },
  // (Switch prints A/B and X/Y swapped relative to their position)
  switch: {
    A: "B",
    B: "A",
    X: "Y",
    Y: "X",
    LB: "L",
    RB: "R",
    LT: "ZL",
    RT: "ZR",
    VIEW: "−",
    START: "+",
    LS: "L-STICK",
    RS: "R-STICK",
    UP: "D-PAD ▲",
    DOWN: "D-PAD ▼",
    LEFT: "D-PAD ◀",
    RIGHT: "D-PAD ▶",
    HOME: "HOME",
  },
};
export function glyph(b: ButtonName, t: PadType) {
  return GLYPHS[t === "generic" ? "xbox" : t][b];
}

/** Game actions that show a hint somewhere on screen. */
export type Action =
  | "move"
  | "look"
  | "fire"
  | "jump"
  | "sprint"
  | "tactical"
  | "ability"
  | "use"
  | "ping"
  | "revive"
  | "prevGun"
  | "nextGun"
  | "pause"
  | "map"
  | "shopPick"
  | "shopBuy";

/** keyboard + mouse labels */
export const KEY_LABEL: Record<Action, string> = {
  move: "WASD",
  look: "MOUSE",
  fire: "LEFT CLICK",
  jump: "SPACE",
  sprint: "SHIFT",
  tactical: "SHIFT ×2",
  ability: "F",
  use: "E",
  ping: "G",
  revive: "HOLD R",
  prevGun: "Q",
  nextGun: "E",
  pause: "P",
  map: "M",
  shopPick: "Z X C",
  shopBuy: "Z X C",
};

/** controller buttons per action */
export const PAD_BUTTON: Record<Action, ButtonName | "LSTICK" | "RSTICK"> = {
  move: "LSTICK",
  look: "RSTICK",
  fire: "RT",
  jump: "A",
  sprint: "LS",
  tactical: "LS",
  ability: "B",
  use: "X",
  ping: "Y",
  revive: "RS",
  prevGun: "LB",
  nextGun: "RB",
  pause: "START",
  map: "VIEW",
  shopPick: "LEFT",
  shopBuy: "X",
};

export function padLabel(a: Action, t: PadType): string {
  const b = PAD_BUTTON[a];
  if (b === "LSTICK") return t === "switch" ? "L-STICK" : "LEFT STICK";
  if (b === "RSTICK") return t === "switch" ? "R-STICK" : "RIGHT STICK";
  if (a === "tactical") return `${glyph("LS", t)} ×2`;
  if (a === "revive") return `HOLD ${glyph("RS", t)}`;
  if (a === "shopPick") return "D-PAD ◀ ▶";
  return glyph(b, t);
}

// ---- controller settings (Settings panel, saved in localStorage) ----

export type PadSettings = {
  /** right-stick look speed multiplier */
  sens: number;
  invertY: boolean;
  /** stick deadzone (0..0.4) */
  deadzone: number;
  /** response curve exponent: 1 linear, 2 "classic" (fine aim near the centre), 3 steep */
  curve: number;
  /** aim assist strength 0 (off) .. 1 */
  assist: number;
  rumble: boolean;
};
export const PAD_DEFAULTS: PadSettings = {
  sens: 1,
  invertY: false,
  deadzone: 0.12,
  curve: 2,
  assist: 0.5,
  rumble: true,
};
const STORE = "scrapfall-pad";

export const padSettings: PadSettings = { ...PAD_DEFAULTS };
const listeners = new Set<() => void>();
let loaded = false;
export function loadPadSettings() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const v = JSON.parse(window.localStorage.getItem(STORE) ?? "{}") as Partial<PadSettings>;
    for (const k of Object.keys(PAD_DEFAULTS) as (keyof PadSettings)[]) {
      if (typeof v[k] === typeof PAD_DEFAULTS[k])
        (padSettings as Record<string, unknown>)[k] = v[k];
    }
  } catch {
    /* corrupt or blocked storage: defaults */
  }
}
export function setPadSettings(patch: Partial<PadSettings>) {
  Object.assign(padSettings, patch);
  try {
    window.localStorage.setItem(STORE, JSON.stringify(padSettings));
  } catch {
    /* private mode */
  }
  listeners.forEach((f) => f());
}
export function subscribePadSettings(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}
