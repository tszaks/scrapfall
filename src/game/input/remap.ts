// One saved action map for keyboard, mouse and controller. Physical inputs never synthesize
// keyboard events: every gameplay consumer receives the same action and release lifecycle.
export const ACTIONS = {
  forward: ["Move forward", "KeyW"],
  back: ["Move backward", "KeyS"],
  left: ["Strafe left", "KeyA"],
  right: ["Strafe right", "KeyD"],
  lookLeft: ["Look left", "ArrowLeft"],
  lookRight: ["Look right", "ArrowRight"],
  lookUp: ["Look up", "ArrowUp"],
  lookDown: ["Look down", "ArrowDown"],
  fire: ["Shoot", "Enter"],
  aim: ["Aim down sights", "Mouse2"],
  jump: ["Jump", "Space"],
  sprint: ["Sprint / double-tap tactical", "ShiftLeft"],
  ability: ["Ability", "KeyF"],
  use: ["Interact / elevator", "KeyE"],
  prevGun: ["Previous weapon", "KeyQ"],
  nextGun: ["Next weapon", "KeyE"],
  ping: ["Ping", "KeyG"],
  revive: ["Hold to revive", "KeyR"],
  reload: ["Reload", "KeyR"],
  melee: ["Melee strike", "KeyB"],
  shopAmmo: ["Buy ammo", "KeyK"],
  camera: ["First / third person", "KeyV"],
  map: ["Big map", "KeyM"],
  time: ["Match weather (fixed)", ""],
  pause: ["Pause", "KeyP"],
  shop1: ["Buy shop item 1", "KeyZ"],
  shop2: ["Buy shop item 2", "KeyX"],
  shop3: ["Buy shop item 3", "KeyC"],
  shopReroll: ["Reroll shop", "KeyR"],
  shopHeal: ["Field dressing", "KeyH"],
  shopRevive: ["Buy self revive", "KeyJ"],
  slot1: ["Weapon slot 1", "Digit1"],
  slot2: ["Weapon slot 2", "Digit2"],
  slot3: ["Weapon slot 3", "Digit3"],
  slot4: ["Weapon slot 4", "Digit4"],
  slot5: ["Weapon slot 5", "Digit5"],
  slot6: ["Weapon slot 6", "Digit6"],
  slot7: ["Weapon slot 7", "Digit7"],
  slot8: ["Weapon slot 8", "Digit8"],
  slot9: ["Weapon slot 9", "Digit9"],
  slot10: ["Weapon slot 10", "Digit0"],
} as const;
export type ControlAction = keyof typeof ACTIONS;
export type ControlDevice = "kbm" | "pad";
export type InputMode = "auto" | ControlDevice;
const ids = Object.keys(ACTIONS) as ControlAction[];
export const KEY_DEFAULTS = Object.fromEntries(ids.map((a) => [a, [ACTIONS[a][1]]])) as Record<
  ControlAction,
  string[]
>;
KEY_DEFAULTS.fire = ["Mouse0", "Enter", "NumpadEnter"];
KEY_DEFAULTS.ping = ["KeyG", "Mouse1"];
KEY_DEFAULTS.sprint = ["ShiftLeft", "ShiftRight"];
export const PAD_DEFAULTS_MAP: Partial<Record<ControlAction, number>> = {
  fire: 7,
  jump: 0,
  sprint: 10,
  ability: 1,
  use: 2,
  prevGun: 4,
  nextGun: 5,
  ping: 3,
  revive: 11,
  reload: 2,
  melee: 11,
  map: 8,
  pause: 9,
  aim: 6,
  shop1: 14,
  shop2: 12,
  shop3: 15,
  shopReroll: 13,
};
const STORE = "scrapfall-controls-v1";
export const controlSettings = {
  mode: "auto" as InputMode,
  swapSticks: false,
  aimMode: "toggle" as "hold" | "toggle",
  keys: structuredClone(KEY_DEFAULTS),
  pad: { ...PAD_DEFAULTS_MAP },
};
export const controlState = {
  active: false,
  capturing: false,
  captureMenu: false,
  focused: true,
  padNeutral: false,
};
export const heldCodes = new Set<string>();
const physical = new Set<string>(),
  held = new Set<ControlAction>();
type Handler = (a: ControlAction, down: boolean, repeat: boolean, source?: string | number) => void;
const resets = new Set<() => void>();
export function subscribeInputReset(f: () => void) {
  resets.add(f);
  return () => {
    resets.delete(f);
  };
}
const handlers = new Set<Handler>(),
  listeners = new Set<() => void>();
let version = 0,
  loaded = false,
  installed = false;
export const controlSnapshot = () => version;
export function subscribeControls(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}
export function subscribeActions(f: Handler) {
  handlers.add(f);
  return () => {
    handlers.delete(f);
  };
}
export function emitControl(
  a: ControlAction,
  down = true,
  repeat = false,
  source?: string | number,
) {
  for (const f of handlers) f(a, down, repeat, source);
}
export function inputHeld(a: ControlAction) {
  return held.has(a);
}
export const supportedToken = (s: unknown): s is string =>
  typeof s === "string" &&
  /^(Key[A-Z]|Digit[0-9]|Numpad(?:[0-9]|Enter|Add|Subtract|Multiply|Divide|Decimal)|Arrow(?:Up|Down|Left|Right)|Delete|Insert|Home|End|PageUp|PageDown|F(?:[1-9]|1[0-2])|Space|Shift(?:Left|Right)|Control(?:Left|Right)|Alt(?:Left|Right)|Tab|Backspace|CapsLock|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Enter|Mouse[0-4])$/.test(
    s,
  );
export function loadControls() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const d = JSON.parse(localStorage.getItem(STORE) || "{}");
    if (["auto", "kbm", "pad"].includes(d.mode)) controlSettings.mode = d.mode;
    if (typeof d.swapSticks === "boolean") controlSettings.swapSticks = d.swapSticks;
    if (d.aimMode === "hold" || d.aimMode === "toggle") controlSettings.aimMode = d.aimMode;
    for (const a of ids) {
      if (Array.isArray(d.keys?.[a]) && d.keys[a].length <= 4 && d.keys[a].every(supportedToken))
        controlSettings.keys[a] = [...new Set(d.keys[a])];
      const b = d.pad?.[a];
      if (Number.isInteger(b) && b >= 0 && b < 16) controlSettings.pad[a] = b;
      else if (b === null) delete controlSettings.pad[a];
    }
    // Old default LT changed camera; it is now the conventional aim trigger.
    // Non-default custom mappings keep priority over a newly introduced action.
    if (!d.pad || !("aim" in d.pad)) {
      if (controlSettings.pad.camera === 6) delete controlSettings.pad.camera;
      if (Object.entries(controlSettings.pad).some(([a, b]) => a !== "aim" && b === 6))
        delete controlSettings.pad.aim;
    }
    if (!d.keys || !("aim" in d.keys)) {
      if (ids.some((a) => a !== "aim" && controlSettings.keys[a].includes("Mouse2")))
        controlSettings.keys.aim = [];
    }
  } catch {
    /* defaults survive blocked or corrupt storage */
  }
}
function save() {
  clearInput();
  try {
    localStorage.setItem(
      STORE,
      JSON.stringify({
        ...controlSettings,
        pad: Object.fromEntries(ids.map((a) => [a, controlSettings.pad[a] ?? null])),
      }),
    );
  } catch {
    /* session settings still work */
  }
  version++;
  for (const f of listeners) f();
}
export function setAimMode(mode: "hold" | "toggle") {
  controlSettings.aimMode = mode;
  save();
}
export function setInputMode(mode: InputMode) {
  controlSettings.mode = mode;
  save();
}
export function setSwapSticks(v: boolean) {
  controlSettings.swapSticks = v;
  save();
}
export function bindControl(
  device: ControlDevice,
  a: ControlAction,
  token: string | number,
  replace = false,
) {
  if (
    device === "kbm"
      ? !supportedToken(token)
      : !Number.isInteger(token) || Number(token) < 0 || Number(token) > 15
  )
    return;
  const conflicts = bindingConflicts(device, a, token);
  if (conflicts.length && !replace) return;
  for (const other of conflicts) {
    if (device === "kbm")
      controlSettings.keys[other] = controlSettings.keys[other].filter((t) => t !== token);
    else delete controlSettings.pad[other];
  }
  if (device === "kbm") controlSettings.keys[a] = [String(token)];
  else controlSettings.pad[a] = Number(token);
  save();
}
export function unbindControl(device: ControlDevice, a: ControlAction) {
  if (device === "kbm") controlSettings.keys[a] = [];
  else delete controlSettings.pad[a];
  save();
}
export function bindingConflicts(device: ControlDevice, a: ControlAction, token: string | number) {
  return ids.filter(
    (b) =>
      b !== a &&
      (device === "kbm"
        ? controlSettings.keys[b].includes(String(token))
        : controlSettings.pad[b] === token),
  );
}
export function resetBindings(device: ControlDevice) {
  if (device === "kbm") controlSettings.keys = structuredClone(KEY_DEFAULTS);
  else {
    controlSettings.pad = { ...PAD_DEFAULTS_MAP };
    controlSettings.swapSticks = false;
  }
  save();
}
export function keyLabel(a: ControlAction) {
  loadControls();
  return (controlSettings.keys[a] ?? []).map(tokenLabel).join(" / ") || "UNBOUND";
}
export function tokenLabel(s: string) {
  return (
    (
      {
        Mouse0: "LEFT CLICK",
        Mouse1: "MIDDLE CLICK",
        Mouse2: "RIGHT CLICK",
        Mouse3: "MOUSE 4",
        Mouse4: "MOUSE 5",
        Space: "SPACE",
        ShiftLeft: "LEFT SHIFT",
        ShiftRight: "RIGHT SHIFT",
        ArrowUp: "↑",
        ArrowDown: "↓",
        ArrowLeft: "←",
        ArrowRight: "→",
      } as Record<string, string>
    )[s] ||
    s
      .replace(/^Key|^Digit/, "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toUpperCase()
  );
}
export function clearInput() {
  physical.clear();
  heldCodes.clear();
  const old = [...held];
  held.clear();
  for (const a of old) emitControl(a, false);
  controlState.padNeutral = false;
  for (const f of resets) f();
}
export function setInputActive(active: boolean) {
  if (controlState.active !== active) clearInput();
  controlState.active = active;
}
export function setCapturing(v: boolean) {
  controlState.capturing = v;
  clearInput();
}
export const editing = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || !!t.closest("input,textarea,select,[data-binding-capture]"));
function update(token: string, down: boolean, repeat = false) {
  if (down) physical.add(token);
  else physical.delete(token);
  for (const a of ids) {
    const on = controlSettings.keys[a].some((t) => physical.has(t)),
      was = held.has(a);
    if (on !== was) {
      if (on) held.add(a);
      else held.delete(a);
      emitControl(a, on, repeat, token);
    }
  }
  heldCodes.clear();
  for (const a of held) heldCodes.add(ACTIONS[a][1]);
}
export function installMappedInput() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  loadControls();
  const allowed = () =>
    controlState.active &&
    !controlState.capturing &&
    controlSettings.mode !== "pad" &&
    controlState.focused;
  window.addEventListener("keydown", (e) => {
    if (
      !allowed() ||
      editing(e.target) ||
      e.metaKey ||
      ((e.ctrlKey || e.altKey) &&
        !/^(Control|Alt)/.test(e.code) &&
        !["ControlLeft", "ControlRight", "AltLeft", "AltRight"].some((t) => physical.has(t)))
    )
      return;
    if (e.repeat && !physical.has(e.code)) return;
    if (ids.some((a) => controlSettings.keys[a].includes(e.code))) {
      e.preventDefault();
      update(e.code, true, e.repeat);
    }
  });
  window.addEventListener("keyup", (e) => update(e.code, false));
  window.addEventListener("mousedown", (e) => {
    if (!allowed() || editing(e.target)) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest("button,a,[role=button]")) return;
    if (!document.pointerLockElement && t?.tagName !== "CANVAS") return;
    const token = `Mouse${e.button}`;
    if (ids.some((a) => controlSettings.keys[a].includes(token))) {
      e.preventDefault();
      update(token, true);
    }
  });
  window.addEventListener("mouseup", (e) => update(`Mouse${e.button}`, false));
  window.addEventListener("contextmenu", (e) => {
    if (
      allowed() &&
      (document.pointerLockElement || (e.target as HTMLElement)?.tagName === "CANVAS")
    )
      e.preventDefault();
  });
  window.addEventListener("blur", () => {
    controlState.focused = false;
    clearInput();
  });
  window.addEventListener("focus", () => {
    controlState.focused = true;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearInput();
  });
  document.addEventListener("pointerlockchange", () => {
    if (!document.pointerLockElement) clearInput();
  });
}

export function sourceIsBound(a: ControlAction, source?: string | number) {
  return typeof source === "number"
    ? controlSettings.pad[a] === source
    : source !== undefined && controlSettings.keys[a].includes(source);
}
