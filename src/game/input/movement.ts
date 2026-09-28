// Run, sprint, tactical sprint and jump (Call of Duty style, Modern Warfare 2019 on).
//
//   RUN       the default speed
//   SPRINT    hold Shift / click the left stick / the touch SPRINT toggle: 1.5x, unlimited,
//             no firing while sprinting (a short sprint-to-fire delay when you pull the trigger)
//   TACTICAL  double-tap Shift / double-click the left stick / tap SPRINT twice: 1.9x for 3 s,
//             then back to a normal sprint; the burst recharges over 6 s (HUD meter)
//   JUMP      Space / A / the touch JUMP button: ~1.1 m apex, ~0.7 s in the air
//
// Pure state: the game loop feeds it the inputs and the ground each frame and reads the speed
// multiplier, whether the trigger may fire, and the feet height. No React, no three.js.

export const MOVE = {
  sprintMul: 1.5,
  tacMul: 1.9,
  tacDur: 3,
  tacRecharge: 6,
  /** double-tap window (s) */
  doubleTap: 0.32,
  /** after the trigger breaks a sprint, the gun comes up in this long (s) */
  sprintToFire: 0.18,
  tacToFire: 0.28,
  /** a sprint needs the stick / keys pushed mostly forward */
  forwardMin: 0.35,
  // jump: v0 = 0.35 g gives 0.7 s airtime; apex v0^2 / 2g = 1.1 m -> g = 17.96 m/s^2
  gravity: 17.96,
  jumpV: 6.286,
  /** how far a jump may climb onto (or drop off) a ledge the walk rules would refuse (m) */
  ledge: 1.15,
} as const;

export const moveState = {
  sprinting: false,
  tactical: false,
  /** seconds of the current tactical burst left */
  tacLeft: 0,
  /** tactical recharge 0..1 (1 = a burst is ready) */
  tacCharge: 1,
  /** "hold" (keyboard Shift: ends on release) or "toggle" (stick click, touch button) */
  mode: "hold" as "hold" | "toggle",
  lastPress: -10,
  endedAt: -10,
  /** seconds until the gun can fire after a sprint */
  fireDelay: 0,
  /** eased 0..1 viewmodel pose: gun lowered (sprint) / raised (tactical) */
  pose: 0,
  tacPose: 0,
  airborne: false,
  /** absolute height of the feet (m) */
  feet: 0,
  vy: 0,
  /** feet above the ground under them (m): what low props are cleared by */
  lift: 0,
  jumps: 0,
  clock: 0,
};

export type MoveInput = {
  dt: number;
  /** forward input -1..1 (keys + stick + touch) */
  fwd: number;
  /** Shift (keyboard) held right now */
  sprintHeld: boolean;
  /** a sprint press this frame: keyboard Shift down, stick click, touch tap */
  sprintPress: "hold" | "toggle" | null;
  /** the touch SPRINT button toggles off on a single tap while sprinting */
  touchTap: boolean;
  fireHeld: boolean;
  /** sprinting is off the table right now (down, seated on the lift, reviving...) */
  noSprint: boolean;
};

export function resetMovement(feet = 0) {
  Object.assign(moveState, {
    sprinting: false,
    tactical: false,
    tacLeft: 0,
    tacCharge: 1,
    mode: "hold",
    lastPress: -10,
    endedAt: -10,
    fireDelay: 0,
    pose: 0,
    tacPose: 0,
    airborne: false,
    feet,
    vy: 0,
    lift: 0,
  });
}

function endTactical() {
  if (!moveState.tactical) return;
  moveState.tactical = false;
  moveState.tacLeft = 0;
}

/** Advance the sprint state machine one frame. */
export function stepSprint(i: MoveInput) {
  const s = moveState;
  s.clock += i.dt;
  s.fireDelay = Math.max(0, s.fireDelay - i.dt);
  const canStart = !i.noSprint && i.fwd >= MOVE.forwardMin && !i.fireHeld;
  if (i.sprintPress) {
    const quick = s.clock - s.lastPress < MOVE.doubleTap;
    s.lastPress = s.clock;
    // (keyboard: the first tap's sprint ended when Shift came up; it still counts)
    const recent = s.sprinting || s.clock - s.endedAt < MOVE.doubleTap;
    if (i.touchTap && s.sprinting && !quick) {
      s.sprinting = false; // touch toggle: a single tap turns it off
      endTactical();
      s.endedAt = s.clock;
    } else if (quick && recent && canStart && !s.tactical && s.tacCharge >= 1) {
      s.sprinting = true;
      s.tactical = true;
      s.tacLeft = MOVE.tacDur;
      s.tacCharge = 0;
      s.mode = i.sprintPress;
    } else if (!s.sprinting && canStart) {
      s.sprinting = true;
      s.mode = i.sprintPress;
    }
  }
  // keyboard: holding Shift and then pushing forward starts the sprint too
  if (!s.sprinting && i.sprintHeld && canStart) {
    s.sprinting = true;
    s.mode = "hold";
  }
  // what ends a sprint: letting go of Shift (hold mode), stopping or backing up, the trigger
  if (s.sprinting) {
    const stop =
      i.noSprint || i.fwd < MOVE.forwardMin || (s.mode === "hold" && !i.sprintHeld) || i.fireHeld;
    if (stop) {
      if (i.fireHeld) s.fireDelay = s.tactical ? MOVE.tacToFire : MOVE.sprintToFire;
      s.sprinting = false;
      s.endedAt = s.clock;
      endTactical();
    }
  }
  if (s.tactical) {
    s.tacLeft -= i.dt;
    if (s.tacLeft <= 0) endTactical(); // back to a normal sprint
  } else if (s.tacCharge < 1) {
    s.tacCharge = Math.min(1, s.tacCharge + i.dt / MOVE.tacRecharge);
  }
  const k = Math.min(1, i.dt * 10);
  s.pose += ((s.sprinting && !s.tactical ? 1 : 0) - s.pose) * k;
  s.tacPose += ((s.tactical ? 1 : 0) - s.tacPose) * k;
}

/** the speed multiplier for this frame (run 1, sprint 1.5, tactical 1.9) */
export function sprintMul() {
  return moveState.tactical ? MOVE.tacMul : moveState.sprinting ? MOVE.sprintMul : 1;
}

/** can the trigger fire this frame (not sprinting, sprint-to-fire delay done) */
export function canFire() {
  return !moveState.sprinting && moveState.fireDelay <= 0;
}

/** Start a jump if standing (returns true when it left the ground). */
export function tryJump(canJump: boolean) {
  const s = moveState;
  if (!canJump || s.airborne) return false;
  s.airborne = true;
  s.vy = MOVE.jumpV;
  s.jumps++;
  return true;
}

/**
 * Vertical step: gravity while airborne; lands on whatever `ground` is under the feet
 * (terrain, a deck, a roof, an elevator car). Returns the feet height to put the eye on.
 */
export function stepJump(dt: number, ground: number) {
  const s = moveState;
  if (!s.airborne) {
    s.feet = ground;
    s.vy = 0;
    s.lift = 0;
    return ground;
  }
  s.vy -= MOVE.gravity * dt;
  s.feet += s.vy * dt;
  if (s.feet <= ground && s.vy <= 0) {
    s.feet = ground;
    s.vy = 0;
    s.airborne = false;
  } else if (s.feet < ground) {
    // rising past a step up (a deck edge): the ground carries you
    s.feet = ground;
  }
  s.lift = Math.max(0, s.feet - ground);
  return s.feet;
}

/** cancel a jump (teleport, respawn, boarding the lift, stepping into an elevator car) */
export function cancelJump(ground: number) {
  moveState.airborne = false;
  moveState.vy = 0;
  moveState.feet = ground;
  moveState.lift = 0;
}
