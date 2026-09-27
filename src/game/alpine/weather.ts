// Whiteout Pass weather and lift clock. The host runs the schedule (calm spells broken by
// blizzards, and a blizzard for the whole boss round) and ships it to guests in the world
// snapshot, so everyone sees the same whiteout and the same chairs on the cable.
import { wind } from "../terrain";
import { setMuffle, setWindNoise } from "../audio";

export const alpine = {
  active: false,
  /** shared clock (seconds): drives the chairlift and the gusts */
  t: 0,
  /** current blizzard strength 0..1 (eased), and where it is heading */
  blizzard: 0,
  target: 0,
  /** set by the game on the host: the boss round always brings a blizzard */
  boss: false,
  /** direction the wind blows towards (radians, 0 = +z) */
  windDir: 2.4,
  /** host: seconds until the weather turns */
  next: 75,
  /** guests: last snapshot clock, for smoothing */
  remoteT: -1,
};

export function resetAlpine(active: boolean) {
  alpine.active = active;
  alpine.t = 0;
  alpine.blizzard = 0;
  alpine.target = 0;
  alpine.boss = false;
  alpine.windDir = 2.4;
  alpine.next = 75;
  alpine.remoteT = -1;
  wind.x = 0;
  wind.z = 0;
  setMuffle(0);
  setWindNoise(0);
}

/** `?blizzard=1` pins the storm on, `?blizzard=0` keeps it calm (testing / screenshots). */
function forced(): number | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("blizzard");
  return v === "1" ? 1 : v === "0" ? 0 : null;
}
const FORCED = forced();

export function tickAlpine(delta: number, isHost: boolean, playing: boolean) {
  if (!alpine.active) return;
  alpine.t += delta;
  if (isHost) {
    if (playing) alpine.next -= delta;
    if (alpine.next <= 0) {
      const storm = alpine.target < 0.5;
      alpine.target = storm ? 1 : 0;
      alpine.next = storm ? 32 + Math.random() * 18 : 70 + Math.random() * 45;
      alpine.windDir = 2.4 + (Math.random() - 0.5) * 1.2;
    }
    if (alpine.boss) alpine.target = 1;
    if (FORCED !== null) alpine.target = FORCED;
  }
  const rate = alpine.target > alpine.blizzard ? 0.16 : 0.11;
  alpine.blizzard +=
    Math.sign(alpine.target - alpine.blizzard) *
    Math.min(Math.abs(alpine.target - alpine.blizzard), rate * delta);
  if (FORCED !== null && alpine.t < 1) alpine.blizzard = FORCED;
  // gusty wind that shoves walkers downwind during a blizzard
  const b = alpine.blizzard;
  const gust = 0.55 + 0.45 * Math.sin(alpine.t * 0.9) * Math.sin(alpine.t * 0.37 + 1.3);
  const str = b * b * 1.9 * gust;
  wind.x = Math.sin(alpine.windDir) * str;
  wind.z = Math.cos(alpine.windDir) * str;
  setMuffle(b);
  setWindNoise(b * (0.5 + 0.5 * gust));
}

export function encodeAlpine(): number[] | null {
  if (!alpine.active) return null;
  return [
    Math.round(alpine.t * 100) / 100,
    Math.round(alpine.blizzard * 1000) / 1000,
    alpine.target,
    Math.round(alpine.windDir * 1000) / 1000,
  ];
}

export function decodeAlpine(a: number[]) {
  if (!alpine.active || a.length < 4) return;
  const [t, b, target, dir] = a as [number, number, number, number];
  // snap big clock differences (join / hitch), otherwise nudge towards the host
  if (Math.abs(t - alpine.t) > 2) alpine.t = t;
  else alpine.t += (t - alpine.t) * 0.2;
  alpine.blizzard += (b - alpine.blizzard) * 0.3;
  alpine.target = target;
  alpine.windDir = dir;
}
