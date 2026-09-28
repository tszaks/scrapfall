// Gamepad polling (the W3C Gamepad API, Chrome and Safari alike), which input device the
// player used last (for the on-screen glyphs), and rumble.
//
// The API has no button events: every frame we read navigator.getGamepads() and diff the
// buttons against the last read. pollPad() is safe to call from several loops in the same
// frame (the game loop and the menu loop): the first call reads, later calls in the same
// frame get the same snapshot, so a press is seen once per frame by everyone.
import { BTN, padSettings, padTypeOf, type PadType } from "./bindings";

const NB = 17;

export type PadFrame = {
  connected: boolean;
  type: PadType;
  /** the browser mapped it to the standard layout (false: best-guess fallback) */
  standard: boolean;
  id: string;
  /** sticks, -1..1 (y is +1 pulled toward you, as the API reports) */
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  /** triggers 0..1 */
  lt: number;
  rt: number;
  down: boolean[];
  /** went down on this poll */
  pressed: boolean[];
  /** went up on this poll */
  released: boolean[];
  /** moment (performance.now) of this poll */
  t: number;
};

const blank = (): PadFrame => ({
  connected: false,
  type: "generic",
  standard: true,
  id: "",
  lx: 0,
  ly: 0,
  rx: 0,
  ry: 0,
  lt: 0,
  rt: 0,
  down: new Array<boolean>(NB).fill(false),
  pressed: new Array<boolean>(NB).fill(false),
  released: new Array<boolean>(NB).fill(false),
  t: 0,
});
const frame = blank();
let activeIndex = -1;

// ---- which device did the player touch last (keyboard/mouse, controller, touch) ----
export type DeviceKind = "kbm" | "pad" | "touch";
export const inputDevice = {
  kind: "kbm" as DeviceKind,
  padType: "xbox" as PadType,
  padConnected: false,
};
const deviceListeners = new Set<() => void>();
let deviceVersion = 0;
function setDevice(kind: DeviceKind, padType = inputDevice.padType) {
  if (inputDevice.kind === kind && inputDevice.padType === padType) return;
  inputDevice.kind = kind;
  inputDevice.padType = padType;
  deviceVersion++;
  if (typeof document !== "undefined")
    document.documentElement.classList.toggle("pad-nav", kind === "pad");
  deviceListeners.forEach((f) => f());
}
export function subscribeDevice(f: () => void) {
  deviceListeners.add(f);
  return () => {
    deviceListeners.delete(f);
  };
}
export const deviceSnapshot = () => deviceVersion;

/** a phone / tablet (touch, no fine pointer), not a touchscreen laptop with a mouse */
const touchFirst = () =>
  navigator.maxTouchPoints > 0 && !window.matchMedia?.("(pointer: fine)").matches;

let watching = false;
/** Listen for keyboard, mouse and touch so the glyphs switch back from the controller. */
export function installInputWatch() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  if (touchFirst()) inputDevice.kind = "touch";
  const kb = (e: KeyboardEvent) => {
    if (!e.isTrusted && !(e as KeyboardEvent & { padShim?: boolean }).padShim) return;
    setDevice("kbm");
  };
  let mx = 0;
  const mouse = (e: MouseEvent) => {
    // ignore the tiny drift some mice report while the player holds a controller
    mx += Math.abs(e.movementX) + Math.abs(e.movementY);
    if (mx > 40) {
      mx = 0;
      setDevice("kbm");
    }
  };
  const ptr = (e: PointerEvent) => setDevice(e.pointerType === "touch" ? "touch" : "kbm");
  window.addEventListener("keydown", kb, true);
  window.addEventListener("mousemove", mouse, true);
  window.addEventListener("pointerdown", ptr, true);
  const conn = () => {
    inputDevice.padConnected = readPads().some(Boolean);
    deviceVersion++;
    deviceListeners.forEach((f) => f());
  };
  window.addEventListener("gamepadconnected", conn);
  window.addEventListener("gamepaddisconnected", () => {
    conn();
    // pad gone: hints go back to the keyboard's
    if (!inputDevice.padConnected) setDevice(touchFirst() ? "touch" : "kbm");
  });
}

function readPads(): (Gamepad | null)[] {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return [];
  try {
    return Array.from(navigator.getGamepads() ?? []);
  } catch {
    return []; // blocked by a permissions policy
  }
}

const btnVal = (gp: Gamepad, i: number) => {
  const b = gp.buttons[i];
  if (!b) return 0;
  return typeof b === "number" ? (b as number) : b.pressed ? Math.max(b.value, 0.9) : b.value;
};

/** read one pad into [buttons 0..16 as 0..1, lx, ly, rx, ry] with a fallback for pads the
 * browser didn't map to the standard layout (Firefox on macOS, some Bluetooth pads) */
function readOne(gp: Gamepad): { b: number[]; ax: [number, number, number, number] } {
  const b = new Array<number>(NB).fill(0);
  const a = gp.axes;
  if (gp.mapping === "standard") {
    for (let i = 0; i < NB; i++) b[i] = btnVal(gp, i);
    return { b, ax: [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, a[3] ?? 0] };
  }
  // non-standard: face buttons and shoulders are almost always 0-5 in standard order; the
  // right stick is axes 2/3 (or 2/5 when 3/4 are the triggers); triggers may be axes 3/4 or
  // 4/5 in -1..1; the d-pad may be buttons 12-15 or a hat on axis 9 (or 6/7 as two axes)
  for (let i = 0; i < Math.min(NB, gp.buttons.length); i++) b[i] = btnVal(gp, i);
  let rx = a[2] ?? 0;
  let ry = a[3] ?? 0;
  if (a.length >= 6 && gp.buttons.length < 8) {
    // (DualShock on Firefox/mac: 3 and 4 are L2/R2 resting at -1)
    ry = a[5] ?? 0;
    b[BTN.LT] = Math.max(b[BTN.LT]!, ((a[3] ?? -1) + 1) / 2);
    b[BTN.RT] = Math.max(b[BTN.RT]!, ((a[4] ?? -1) + 1) / 2);
  }
  if (a.length > 9 && gp.buttons.length < 13) {
    const h = a[9]!;
    if (h >= -1.05 && h <= 1.05) {
      // 8 hat positions from -1 (up) clockwise in steps of 2/7
      const k = Math.round((h + 1) / (2 / 7)) % 8;
      if (k === 7 || k === 0 || k === 1) b[BTN.UP] = 1;
      if (k >= 1 && k <= 3) b[BTN.RIGHT] = 1;
      if (k >= 3 && k <= 5) b[BTN.DOWN] = 1;
      if (k >= 5 && k <= 7) b[BTN.LEFT] = 1;
    }
  } else if (a.length >= 8 && gp.buttons.length < 13) {
    if ((a[7] ?? 0) < -0.5) b[BTN.UP] = 1;
    if ((a[7] ?? 0) > 0.5) b[BTN.DOWN] = 1;
    if ((a[6] ?? 0) < -0.5) b[BTN.LEFT] = 1;
    if ((a[6] ?? 0) > 0.5) b[BTN.RIGHT] = 1;
  }
  rx = Math.abs(rx) > 1.05 ? 0 : rx;
  ry = Math.abs(ry) > 1.05 ? 0 : ry;
  return { b, ax: [a[0] ?? 0, a[1] ?? 0, rx, ry] };
}

/** Read the controller once per frame (later calls in the same frame reuse the read). */
export function pollPad(): PadFrame {
  const now = performance.now();
  if (now - frame.t < 4) return frame;
  frame.t = now;
  const pads = readPads().filter((p): p is Gamepad => !!p && p.connected !== false);
  const prev = frame.down.slice();
  frame.pressed.fill(false);
  frame.released.fill(false);
  if (pads.length === 0) {
    const was = frame.connected;
    Object.assign(frame, { ...blank(), t: now });
    activeIndex = -1;
    if (was) inputDevice.padConnected = false;
    for (let i = 0; i < NB; i++) frame.released[i] = prev[i]!;
    return frame;
  }
  // the pad in use: the last one that did something (a phantom "gamepad" some mice and
  // keyboards expose must not steer the player)
  const reads = pads.map((p) => ({ p, r: readOne(p) }));
  for (const { p, r } of reads) {
    const busy = r.b.some((v) => v > 0.5) || r.ax.some((v) => Math.abs(v) > 0.6);
    if (busy && p.index !== activeIndex) activeIndex = p.index;
  }
  const cur = reads.find((x) => x.p.index === activeIndex) ?? reads[0]!;
  const { p, r } = cur;
  frame.connected = true;
  frame.id = p.id;
  frame.type = padTypeOf(p.id);
  frame.standard = p.mapping === "standard";
  [frame.lx, frame.ly, frame.rx, frame.ry] = r.ax;
  frame.lt = r.b[BTN.LT]!;
  frame.rt = r.b[BTN.RT]!;
  for (let i = 0; i < NB; i++) {
    // triggers count as "down" past a third of their travel
    const d = i === BTN.LT || i === BTN.RT ? r.b[i]! > 0.35 : r.b[i]! > 0.5;
    frame.down[i] = d;
    frame.pressed[i] = d && !prev[i];
    frame.released[i] = !d && prev[i]!;
  }
  inputDevice.padConnected = true;
  const active =
    frame.pressed.some(Boolean) ||
    Math.hypot(frame.lx, frame.ly) > 0.5 ||
    Math.hypot(frame.rx, frame.ry) > 0.5 ||
    frame.rt > 0.5;
  if (active) setDevice("pad", frame.type);
  else if (inputDevice.kind === "pad" && inputDevice.padType !== frame.type)
    setDevice("pad", frame.type);
  return frame;
}

/** Mark a press as handled so another reader this frame doesn't act on it too. */
export function consumePress(b: number) {
  frame.pressed[b] = false;
}

/** Radial deadzone plus response curve: stick (x, y) -> (x, y) with magnitude 0..1. */
export function shapeStick(x: number, y: number, dead: number, curve = 1): [number, number] {
  const m = Math.hypot(x, y);
  if (m <= dead) return [0, 0];
  const n = Math.min(1, (m - dead) / (1 - dead));
  const s = Math.pow(n, curve) / m;
  return [x * s, y * s];
}

// ---- rumble ----
type Actuator = {
  playEffect?: (
    t: string,
    p: { duration: number; startDelay?: number; strongMagnitude: number; weakMagnitude: number },
  ) => Promise<unknown>;
  pulse?: (v: number, ms: number) => Promise<unknown>;
};
let rumbleUntil = 0;
let rumbleLevel = 0;
/** Shake the controller (Chrome: dual-rumble; Firefox: haptic pulse; Safari: whatever it
 * supports, silently nothing otherwise). Weaker requests don't cut off a stronger one. */
export function rumble(strong: number, weak: number, ms: number) {
  if (!padSettings.rumble || inputDevice.kind !== "pad" || activeIndex < 0) return;
  const now = performance.now();
  const lvl = Math.max(strong, weak);
  if (now < rumbleUntil && lvl <= rumbleLevel) return;
  rumbleUntil = now + ms;
  rumbleLevel = lvl;
  rumbleLog.push({ t: Math.round(now), strong, weak, ms });
  if (rumbleLog.length > 50) rumbleLog.shift();
  const gp = readPads()[activeIndex];
  if (!gp) return;
  try {
    const va = (gp as unknown as { vibrationActuator?: Actuator }).vibrationActuator;
    if (va?.playEffect) {
      va.playEffect("dual-rumble", {
        duration: ms,
        startDelay: 0,
        strongMagnitude: Math.min(1, strong),
        weakMagnitude: Math.min(1, weak),
      })?.catch?.(() => {});
      return;
    }
    const ha = (gp as unknown as { hapticActuators?: Actuator[] }).hapticActuators?.[0];
    ha?.pulse?.(Math.min(1, lvl), ms)?.catch?.(() => {});
  } catch {
    /* unsupported: no rumble */
  }
}
/** recent rumble requests (test handle) */
export const rumbleLog: { t: number; strong: number; weak: number; ms: number }[] = [];
