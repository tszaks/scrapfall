// Pacific Pier's WAVE SURGE (a map event, see events/mapEvents.ts and events/mapHooks.ts).
//
// A telegraphed rogue wave: the banner and a foghorn, then a swell visibly rises on the
// horizon and rolls in; it breaks at the shoreline and a wall of surf runs up the sand to a
// line just short of the boardwalk. Anyone caught on the sand is knocked landward and lightly
// hurt (once), and carried a little while the water is still running; small enemies are
// swept along with it. The pier deck, its upper stairs, the lifeguard towers' surroundings
// above the waterline and the boardwalk are high ground. Then the water drains back to the
// sea, leaving glossy wet sand and foam.
//
// Everything is a function of the event clock (ctx.t), so every co-op client runs the same
// surge from the host's start message; each client shoves its own player, the host alone
// touches enemies.
import { setAmbienceWeather } from "../ambience";
import type { EventCtx } from "../events/mapEvents";
import type { MapEventHooks } from "../events/mapHooks";
import { playHorn, playRumble } from "../events/sfx";
import { groundY } from "../terrain";
import { X, isBeach } from "./beachLayout";

/** timeline, seconds from the start */
export const SURGE = {
  /** the swell starts to rise far offshore */
  rise: 3,
  /** it breaks on the shoreline */
  breaks: 11,
  /** the run-up reaches its high-water line */
  peak: 15.5,
  /** holding at the top */
  hold: 17,
  /** back down to the shoreline */
  drained: 24,
  /** the wet sheen and foam are gone */
  dry: 30,
  /** where the swell appears, and the high-water line on the sand (just short of the park
   * strip and boardwalk, which stay dry) */
  farX: -280,
  shoreX: X.wet,
  topX: X.strip - 8,
} as const;

const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** Where the leading edge of the water is at time t (x, metres), and how tall the swell is. */
export function surgeAt(t: number) {
  const S = SURGE;
  // the swell: rises and rolls in from the horizon, steepening, until it breaks
  if (t < S.breaks) {
    const k = clamp01((t - S.rise) / (S.breaks - S.rise));
    const x = S.farX + (S.shoreX - S.farX) * (1 - Math.pow(1 - k, 1.4));
    const h = t < S.rise ? 0 : 3.5 + 8 * ease(k);
    return { swellX: x, swellH: h, front: S.shoreX, running: false, wet: 0 };
  }
  // the run-up: fast at first, slowing as it climbs the beach
  if (t < S.peak) {
    const k = clamp01((t - S.breaks) / (S.peak - S.breaks));
    const f = S.shoreX + (S.topX - S.shoreX) * (1 - Math.pow(1 - k, 2));
    return {
      swellX: S.shoreX + (f - S.shoreX) * 0.35,
      swellH: 11.5 * Math.pow(1 - k, 2),
      front: f,
      running: true,
      wet: 1,
    };
  }
  if (t < S.hold) return { swellX: S.shoreX, swellH: 0, front: S.topX, running: false, wet: 1 };
  // draining back to the sea
  if (t < S.drained) {
    const k = clamp01((t - S.hold) / (S.drained - S.hold));
    return {
      swellX: S.shoreX,
      swellH: 0,
      front: S.topX + (S.shoreX - S.topX) * ease(k),
      running: false,
      wet: 1,
    };
  }
  const k = clamp01((t - S.drained) / (S.dry - S.drained));
  return { swellX: S.shoreX, swellH: 0, front: S.shoreX, running: false, wet: 1 - k };
}

/** Is (x, z) exposed to the surge? Natural sand and surf only: decks, the upper stairs, the
 * park strip and the boardwalk are high ground. */
export function inSurgeZone(x: number, z: number) {
  if (x >= SURGE.topX || x < X.surf) return false;
  return groundY(x, z) < 0.9;
}

/** live state the renderer reads (the same on every client) */
export const surge = {
  on: false,
  t: 0,
  front: SURGE.shoreX as number,
  swellX: SURGE.farX as number,
  swellH: 0,
  wet: 0,
};

const hitMe = { done: false };
const hitEnemies = new Set<number>();
const SMALL = new Set(["drifter", "runner", "hornet", "specter"]);
/** knockback given to a player caught by the front (m/s, decays in ~0.3 s: about 4 m) */
export const SURGE_KNOCK = 24;
/** how fast the running water carries you landward while you stand in it, m/s */
export const SURGE_CARRY = 3.2;

function solidAt(ctx: EventCtx, x: number, z: number) {
  const c = ctx.city;
  if (!c) return true;
  const i = Math.floor((x + c.half) / 2);
  const j = Math.floor((z + c.half) / 2);
  return i < 0 || j < 0 || i >= c.cells || j >= c.cells || c.solid[i * c.cells + j] === 1;
}

export const waveSurge: MapEventHooks = {
  start(ctx) {
    hitMe.done = false;
    hitEnemies.clear();
    surge.on = true;
    surge.t = ctx.t;
    ctx.banner("WAVE SURGE", "A ROGUE WAVE · GET OFF THE SAND", "#1c5a8a");
  },
  step(ctx) {
    if (!isBeach(ctx.city)) return;
    const t = ctx.t;
    const s = surgeAt(t);
    surge.on = true;
    surge.t = t;
    surge.front = s.front;
    surge.swellX = s.swellX;
    surge.swellH = s.swellH;
    surge.wet = s.wet;
    // a second foghorn blast as the swell stands up; the roar builds as it comes in and breaks
    const prev = t - ctx.dt;
    if (prev < 5 && t >= 5) playHorn(0.24, true);
    if (prev < SURGE.breaks - 1.5 && t >= SURGE.breaks - 1.5) playRumble(9, 0.55);
    const roar =
      t < SURGE.rise
        ? 0
        : t < SURGE.breaks
          ? 0.3 + 0.5 * ((t - SURGE.rise) / (SURGE.breaks - SURGE.rise))
          : t < SURGE.hold
            ? 1
            : Math.max(0, 1 - (t - SURGE.hold) / 9);
    setAmbienceWeather(roar);

    const me = ctx.player;
    const wetHere = (x: number, z: number) => x < s.front && inSurgeZone(x, z);
    // the front: knocked landward and hurt, once; the running water carries you on
    if (me.alive && wetHere(me.x, me.z) && t >= SURGE.breaks && t < SURGE.hold) {
      if (!hitMe.done && (s.front - me.x < 9 || me.x < SURGE.shoreX)) {
        hitMe.done = true;
        ctx.hurtPlayer(1, SURGE_KNOCK, 0, 1.1);
        ctx.banner("WASHED UP", "GET TO HIGH GROUND", "#1c5a8a");
      }
      if (s.running) ctx.movePlayer(SURGE_CARRY * ctx.dt, 0);
    }
    // the drain pulls a little back toward the sea
    if (me.alive && wetHere(me.x, me.z) && t >= SURGE.hold && t < SURGE.drained)
      ctx.movePlayer(-1.2 * ctx.dt, 0);

    if (!ctx.host) return;
    ctx.enemies.forEach((e, i) => {
      if (!e.alive || !wetHere(e.x, e.z) || t < SURGE.breaks || t >= SURGE.drained) return;
      // tide crawlers are at home in the surf
      if (e.kind === "special" && ctx.theme.special.type === "crawler") return;
      const small = SMALL.has(e.kind);
      if (!hitEnemies.has(i) && (s.front - e.x < 9 || e.x < SURGE.shoreX) && t < SURGE.hold) {
        hitEnemies.add(i);
        ctx.hurtEnemy(i, small ? 3 : 2, 1, 0);
      }
      // small ones are swept along with the running water, then dragged by the drain
      if (small) {
        const v = s.running ? 9 : t >= SURGE.hold ? -3 : 0;
        const nx = Math.min(e.x + v * ctx.dt, s.front - 0.5);
        if (!solidAt(ctx, nx, e.z)) e.x = nx;
      }
    });
  },
  end() {
    surge.on = false;
    surge.wet = 0;
    surge.front = SURGE.shoreX;
    surge.swellH = 0;
    setAmbienceWeather(0);
  },
};
