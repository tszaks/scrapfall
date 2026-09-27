// Behaviour hooks for Dry Gulch's own enemies, called from the game's enemy loop (Game.tsx)
// so every rule stays next to the others. Models live in enemies.tsx.

type Aim = (
  y: number,
  spd: number,
  spread: number,
  n: number,
  dmg: number,
  life?: number,
  size?: number,
) => void;
type Mob = { aux?: number; shot: number; cooldown: number };

/** Desperado: holds still while drawing (the telegraph), then fires two fast shots. */
export function desperadoDir(e: Mob, d: number) {
  if ((e.aux ?? 0) > 0) return 0;
  return d > 16 ? 1 : d < 9 ? -1 : 0;
}
export function desperadoTick(e: Mob, d: number, delta: number, ready: boolean, aim: Aim) {
  const a = e.aux ?? 0;
  if (a > 0) {
    const na = a - delta;
    if (a > 0.16 && na <= 0.16) aim(1.4, 30, 0.03, 1, 1, 2.2, 0.12);
    if (na <= 0) {
      aim(1.4, 30, 0.03, 1, 1, 2.2, 0.12);
      e.aux = 0;
      e.shot = 2.4;
    } else e.aux = na;
  } else if (ready && d < 26) e.aux = 0.85; // the quick-draw: 0.85 s of warning
}

/**
 * The Iron Marshal: bursts from the Gatling arm (spin up, 2.4 s of fire, cool down) and,
 * every so often, a lasso that yanks whoever it is after toward it. aux runs the lasso wind-up.
 */
export function marshalTick(
  e: Mob & { x: number; z: number },
  d: number,
  dx: number,
  dz: number,
  delta: number,
  aim: Aim,
  pull: (kx: number, kz: number) => void,
) {
  e.shot -= delta;
  const phase = ((e.cooldown % 4.4) + 4.4) % 4.4;
  void phase;
  if ((e.aux ?? 0) > 0) {
    e.aux = (e.aux ?? 0) - delta;
    if ((e.aux ?? 0) <= 0) {
      // the lasso lands: drag the target in (it stops a few metres short)
      const s = Math.min(18, d * 1.6);
      pull((-dx / d) * s, (-dz / d) * s);
      e.aux = 0;
      e.shot = Math.max(e.shot, 1.2);
    }
    return;
  }
  if (e.shot <= 0 && d < 34) {
    // the Gatling: a tight stream of rounds, with a little sweep
    e.shot = 0.09;
    const burst = ((e.cooldown % 4.4) + 4.4) % 4.4;
    if (burst < 2.4) aim(2.1, 20, 0.05, 1, 1, 2.6, 0.2);
    else e.shot = 0.3;
  }
  if (d > 7 && d < 20 && Math.random() < delta / 7) e.aux = 0.9;
}
