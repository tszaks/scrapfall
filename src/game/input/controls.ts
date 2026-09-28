import {
  subscribeInputReset,
  installMappedInput,
  subscribeActions,
  controlSettings,
  controlState,
  emitControl,
  type ControlAction,
} from "./remap";
// The glue between every input device and the game loop (Game.tsx World's useFrame):
//
//   keyboard   Shift sprint (double-tap: tactical), Space jump, M big map
//   controller everything in bindings.ts PAD_BUTTON, read once per frame
//   touch      the JUMP / SPRINT buttons (touch.ts one-shots)
//
// One-shot actions the game already understands from the touch controls (ability, swap, use,
// ping, revive) are written into touchInput, so the game has one path for them. Movement,
// the trigger and the look are returned / applied here.
import { touchInput, resetTouchInput } from "../touch";
import { FULL_H, jumpBody, shotBlocked, shotStop } from "../level";
import { climbable, jumpClimb } from "../terrain";
import { loadPadSettings, padSettings } from "./bindings";
import {
  consumePress,
  inputDevice,
  installInputWatch,
  pollPad,
  rumble,
  shapeStick,
} from "./gamepad";
import { aimAssist, type AimTarget } from "./aimAssist";
import { MOVE, moveState, stepSprint, sprintMul } from "./movement";
import { FALL_TABLE, fallDamage, fallShare } from "./fall";

/** set by the Game component: pause the match (Start on the controller) */
export const padHooks: { pause: (() => void) | null } = { pause: null };

const kb = { shift: false, sprintPress: false, jump: false };
const pad = { jump: false, sprintPress: false, reviveHeld: false };
/** controller movement and trigger for this frame */
export const padOut = { moveX: 0, moveZ: 0, fire: false };

let installed = false;
/** keyboard listeners for sprint / jump / map, plus the device watch (once per page) */
export function installControls() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  loadPadSettings();
  installInputWatch();
  installMappedInput();
  subscribeInputReset(() => {
    clearControls();
    resetTouchInput();
    padOut.moveX = padOut.moveZ = 0;
    padOut.fire = false;
    pad.reviveHeld = false;
  });
  subscribeActions((a, down, repeat) => {
    if (a === "sprint") {
      if (down && !repeat) kb.sprintPress = true;
      kb.shift = down;
    }
    if (a === "jump" && down && !repeat) kb.jump = true;
    if (a === "map" && down && !repeat) toggleBigMap();
  });
  if (typeof window !== "undefined") {
    (window as unknown as { __controls?: unknown }).__controls = {
      moveState,
      MOVE,
      padSettings,
      padOut,
      inputDevice,
      pollPad,
      // (test handle: what a jump clears)
      jumpBody,
      jumpClimb,
      climbable,
      fall: { FALL_TABLE, fallDamage, fallShare },
      shot: { shotStop, shotBlocked, FULL_H },
    };
  }
}

/** Select / View: the minimap grows to a big map (and back) */
export function toggleBigMap() {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("rs-bigmap");
}

/** D-pad left/right in the shop break: walk the focus along the shop's buttons */
function shopFocus(dir: number) {
  const list = [...document.querySelectorAll<HTMLButtonElement>("[data-pad-shop] button")].filter(
    (b) => b.offsetParent !== null && !b.disabled,
  );
  if (list.length === 0) return false;
  const i = list.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    list[i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length]!;
  next.focus({ preventScroll: true });
  return true;
}
function shopActivate() {
  const el = document.activeElement as HTMLElement | null;
  if (el && el.closest("[data-pad-shop]")) {
    el.click();
    return true;
  }
  return false;
}

/**
 * The controller's buttons for one frame of play. `inCar`: standing in an elevator car (A and
 * X press its floor button; there is no jumping in a car).
 */
export function stepPadActions(env: { inCar: boolean }) {
  const p = pollPad();
  if (
    !p.connected ||
    controlSettings.mode === "kbm" ||
    controlState.capturing ||
    !controlState.active ||
    !controlState.focused
  ) {
    padOut.moveX = padOut.moveZ = 0;
    padOut.fire = false;
    if (pad.reviveHeld) touchInput.revive = pad.reviveHeld = false;
    return;
  }
  if (!controlState.padNeutral) {
    controlState.padNeutral = !p.down.some(Boolean) && Math.hypot(p.lx, p.ly, p.rx, p.ry) < 0.2;
    padOut.moveX = padOut.moveZ = 0;
    padOut.fire = false;
    for (let i = 0; i < p.pressed.length; i++) if (p.pressed[i]) consumePress(i);
    return;
  }
  const s = padSettings;
  const [mx, my] = shapeStick(
    controlSettings.swapSticks ? p.rx : p.lx,
    controlSettings.swapSticks ? p.ry : p.ly,
    s.deadzone,
    1,
  );
  padOut.moveX = mx;
  padOut.moveZ = -my;
  const index = (a: ControlAction) => controlSettings.pad[a];
  const held = (a: ControlAction) => {
    const b = index(a);
    return b !== undefined && p.down[b]!;
  };
  const hit = (a: ControlAction) => {
    const b = index(a);
    if (b === undefined || !p.pressed[b]) return false;
    consumePress(b);
    return true;
  };
  padOut.fire = held("fire");
  if (hit("jump")) {
    if (env.inCar) touchInput.use = true;
    else pad.jump = true;
  }
  if (hit("ability")) touchInput.ability = true;
  if (hit("use")) {
    if (env.inCar) touchInput.use = true;
    else shopActivate();
  }
  if (hit("ping")) touchInput.ping = true;
  if (hit("prevGun") && !shopFocus(-1)) touchInput.swap = -1;
  if (hit("nextGun") && !shopFocus(1)) touchInput.swap = 1;
  if (hit("sprint")) pad.sprintPress = true;
  if (hit("map")) toggleBigMap();
  if (hit("pause")) padHooks.pause?.();
  for (const a of [
    "camera",
    "time",
    "shop1",
    "shop2",
    "shop3",
    "shopReroll",
    "shopHeal",
  ] as ControlAction[])
    if (hit(a)) emitControl(a, true, false, index(a));
  const rs = held("revive");
  if (rs !== pad.reviveHeld) {
    pad.reviveHeld = rs;
    touchInput.revive = rs;
  }
}

/** a jump was asked for this frame (Space, A, the touch button) */
export function takeJump() {
  const j = kb.jump || pad.jump || touchInput.jump;
  kb.jump = pad.jump = touchInput.jump = false;
  return j;
}

/** Drop pending presses (entering a match, respawning): nothing queued fires later. */
export function clearControls() {
  kb.shift = kb.jump = kb.sprintPress = false;
  pad.jump = pad.sprintPress = false;
  touchInput.jump = touchInput.sprint = false;
}

/**
 * Sprint for this frame; returns the speed multiplier (run 1, sprint 1.5, tactical 1.9).
 * `fwd` is the forward input (-1..1), `noSprint` true while down, seated, in a car, reviving.
 */
export function stepMove(dt: number, fwd: number, fireHeld: boolean, noSprint: boolean) {
  const touchTap = touchInput.sprint;
  const press = kb.sprintPress ? "hold" : pad.sprintPress || touchTap ? "toggle" : null;
  kb.sprintPress = pad.sprintPress = touchInput.sprint = false;
  stepSprint({ dt, fwd, sprintHeld: kb.shift, sprintPress: press, touchTap, fireHeld, noSprint });
  return sprintMul();
}

/** full-deflection look speed (rad/s) at sensitivity 1: ~195 deg/s across, ~125 up/down */
const YAW_RATE = 3.4;
const PITCH_RATE = 2.2;
/** magnetism: fraction of the angle to the target closed per second while steering */
const PULL = 3.2;

/**
 * Right-stick look with the deadzone, the response curve, sensitivity, invert-Y and aim
 * assist. Mutates `look` (yaw / pitch, radians).
 */
export function padLook(
  dt: number,
  look: { yaw: number; pitch: number },
  cam: { x: number; y: number; z: number },
  targets: () => Iterable<AimTarget>,
  visible?: (t: AimTarget) => boolean,
) {
  const p = pollPad();
  if (
    !p.connected ||
    controlSettings.mode === "kbm" ||
    controlState.capturing ||
    !controlState.active ||
    !controlState.focused ||
    !controlState.padNeutral
  )
    return;
  const s = padSettings;
  const [x, y] = shapeStick(
    controlSettings.swapSticks ? p.lx : p.rx,
    controlSettings.swapSticks ? p.ly : p.ry,
    s.deadzone,
    s.curve,
  );
  const steering = x !== 0 || y !== 0 || Math.hypot(padOut.moveX, padOut.moveZ) > 0.2;
  let slow = 1;
  if (s.assist > 0 && (controlSettings.mode === "pad" || inputDevice.kind === "pad") && steering) {
    const a = aimAssist(cam, look.yaw, look.pitch, targets(), s.assist, visible);
    if (a.on) {
      slow = a.slow;
      const k = Math.min(1, PULL * s.assist * dt);
      look.yaw += a.dYaw * k * 0.6;
      look.pitch += a.dPitch * k * 0.4;
    }
  }
  if (x === 0 && y === 0) return;
  look.yaw -= x * YAW_RATE * s.sens * slow * dt;
  look.pitch -= y * PITCH_RATE * s.sens * slow * dt * (s.invertY ? -1 : 1);
  look.pitch = Math.max(-1.2, Math.min(1.2, look.pitch));
}

// ---- rumble moments ----
export const rumbleFor = {
  /** heavy guns kick the pad (light guns stay quiet) */
  fire(damage: number, count: number, blast: boolean) {
    const weight = damage * count + (blast ? 4 : 0);
    if (weight >= 4)
      rumble(Math.min(1, 0.25 + weight * 0.06), 0.35, 90 + Math.min(120, weight * 10));
  },
  hit() {
    rumble(0.55, 0.9, 170);
  },
  blast(k: number) {
    rumble(Math.min(1, 0.5 + k), 0.6, 320);
  },
  bump(shake: number) {
    rumble(Math.min(1, 0.4 + shake), 0.5, 240);
  },
};

/** the gun drops to the hip while sprinting and swings up for a tactical sprint */
export function sprintPose(v: {
  translateY(d: number): unknown;
  rotateX(a: number): unknown;
  rotateY(a: number): unknown;
  rotateZ(a: number): unknown;
}) {
  const sp = moveState.pose;
  const tp = moveState.tacPose;
  if (sp < 0.01 && tp < 0.01) return;
  v.translateY(-0.1 * sp + 0.06 * tp);
  v.rotateX(-0.45 * sp + 0.95 * tp);
  v.rotateY(0.55 * sp + 0.2 * tp);
  v.rotateZ(0.3 * tp);
}
