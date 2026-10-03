// Run, sprint, tactical sprint and jump (Call of Duty style, Modern Warfare 2019 on).
//
//   RUN       the default speed
//   SPRINT    hold Shift / click the left stick / the touch SPRINT toggle: 1.5x, unlimited,
//             no firing while sprinting (a short sprint-to-fire delay when you pull the trigger)
//   TACTICAL  double-tap Shift / double-click the left stick / tap SPRINT twice: 1.9x for 3 s,
//             then back to a normal sprint; the burst recharges over 6 s (HUD meter)
//   JUMP      Space / A / the touch JUMP button: 1.45 m apex, ~0.8 s in the air
//
// Pure state: the game loop feeds it the inputs and the ground each frame and reads the speed
// multiplier, whether the trigger may fire, and the feet height. No React, no three.js.

// ---- THE SPEED TABLE -------------------------------------------------------------
// Every player movement speed in one place (m/s; entries marked "x" multiply the run).
// A middle ground between the original 7 m/s run and the slower 3.7 m/s revision:
// run 4.6, sprint 6.9, tactical 8.74. Class, terrain and aiming modifiers still apply.
// Changing player comfort speed must not quietly speed up the robots as well.
const BALANCE_RUN = 3.7;

export const SPEED = {
  run: 4.6,
  /** sprint, x run */
  sprintMul: 1.5,
  /** tactical sprint, x run */
  tacMul: 1.9,
  /** walking backwards / sidestepping, x run (1 = as fast as forward) */
  backpedal: 1,
  strafe: 1,
  /** aiming down sights, x run — the ADS branch sets this; wired in Game.tsx (1 = no slow) */
  ads: 1,
  /** the crawl while DOWN, x run */
  downed: 0.2,
  /** SPEED HOLSTER perk with the pistol out, x run */
  holster: 1.15,
  /** OVERDRIVE, x run */
  overdrive: 1.3,
  /** CRYO SURGE / HEAVY GRAVITY mutators, x run */
  cryo: 0.85,
  heavyGravity: 0.9,
  /** loose-ground drag (what each map's ground.speed returns): Pacific Pier, then Whiteout */
  sand: 0.75,
  wetSand: 0.88,
  surf: 0.55,
  snow: 0.78,
  forest: 0.8,
  rock: 0.85,
  piste: 0.95,
  /** the jump: a 1.45 m apex clears the authored 1.3 m fences; ~0.8 s in the air */
  jumpApex: 1.45,
  gravity: 17.96,
} as const;

/** Keep the existing hazard warning windows during player comfort tuning. */
export const HAZARD_WARNING_SCALE = 7 / BALANCE_RUN;

/** sprint / tactical top speeds in m/s (for tuning notes and HUD copy) */
export const SPRINT_MPS = SPEED.run * SPEED.sprintMul;
export const TACTICAL_MPS = SPEED.run * SPEED.tacMul;

/** Preserve the existing enemy chase pace when the player speed is adjusted.
 * Attack dashes and their warnings remain separate in enemyAI/Game. */
export const chase = (mps: number) => Math.round(((mps * BALANCE_RUN) / 7) * 100) / 100;

export const MOVE = {
  tacDur: 3.6,
  tacRecharge: 6,
  /** double-tap window (s) */
  doubleTap: 0.32,
  /** after the trigger breaks a sprint, the gun comes up in this long (s) */
  sprintToFire: 0.18,
  tacToFire: 0.28,
  /** a sprint needs the stick / keys pushed mostly forward */
  forwardMin: 0.35,
  jumpV: Math.sqrt(2 * SPEED.gravity * SPEED.jumpApex),
  /** how far a jump may climb onto (or drop off) a ledge the walk rules would refuse (m) */
  ledge: 1.5,
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
  /** highest feet height since leaving the ground (a fall's drop is measured from here) */
  fallTop: 0,
  /** set on the frame the feet land: how far they dropped (m); -1 otherwise */
  landed: -1,
  /** camera dip after a hard landing (m), easing back to 0 */
  dip: 0,
  /** gravity scale for the jump arc — overtime's HEAVY GRAVITY mutator pushes it past 1 */
  gravityMul: 1,
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
    gravityMul: 1,
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

/** the speed multiplier for this frame (run 1, sprint 1.5, tactical 1.9 — SPEED table) */
export function sprintMul() {
  return moveState.tactical ? SPEED.tacMul : moveState.sprinting ? SPEED.sprintMul : 1;
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
  s.fallTop = s.feet;
  s.jumps++;
  return true;
}

/** Leave the ground without a jump (stepping off a roof edge): gravity takes over. */
export function startFall() {
  const s = moveState;
  if (s.airborne) return;
  s.airborne = true;
  s.vy = 0;
  s.fallTop = s.feet;
}

/**
 * Vertical step: gravity while airborne; lands on whatever `ground` is under the feet
 * (terrain, a deck, a roof, an elevator car). Returns the feet height to put the eye on.
 */
export function stepJump(dt: number, ground: number) {
  const s = moveState;
  s.landed = -1;
  s.dip = Math.max(0, s.dip - dt * 1.6);
  if (!s.airborne) {
    s.feet = ground;
    s.vy = 0;
    s.lift = 0;
    return ground;
  }
  // Analytic constant-gravity integration: the same arc at 20, 30, 60 or 120 fps.
  const G = SPEED.gravity * s.gravityMul;
  if (s.vy > 0 && s.vy <= G * dt) s.fallTop = Math.max(s.fallTop, s.feet + (s.vy * s.vy) / (2 * G));
  s.feet += s.vy * dt - 0.5 * G * dt * dt;
  s.vy -= G * dt;
  s.fallTop = Math.max(s.fallTop, s.feet);
  if (s.feet <= ground && s.vy <= 0) {
    s.feet = ground;
    s.vy = 0;
    s.airborne = false;
    s.landed = Math.max(0, s.fallTop - ground);
    // a hard landing dips the view (a normal jump barely)
    if (s.landed > 2) s.dip = Math.min(0.55, 0.12 + s.landed * 0.02);
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
