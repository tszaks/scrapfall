// Dry Gulch's weather: dust storms. A pure function of the shared train clock (train.ts),
// so the host and every guest agree on when the wall of dust rolls in.
import { trainClock } from "./trainSim";

/** first storm after this many seconds, then one every CYCLE seconds */
const FIRST = 170;
const CYCLE = 250;
const RAMP = 9;
const HOLD = 46;

let forced: number | null = null;
if (typeof window !== "undefined") {
  const v = new URLSearchParams(window.location.search).get("storm");
  if (v === "1") forced = 1;
  else if (v === "0") forced = 0;
}

/** storm strength 0..1 at time t, and the wind (blowing out of the west, gusting) */
export function stormAt(t: number = trainClock.t) {
  let k = 0;
  if (t > FIRST) {
    const u = (t - FIRST) % CYCLE;
    if (u < RAMP) k = u / RAMP;
    else if (u < RAMP + HOLD) k = 1;
    else if (u < RAMP * 2 + HOLD) k = 1 - (u - RAMP - HOLD) / RAMP;
  }
  if (forced !== null) k = forced;
  k = k * k * (3 - 2 * k);
  const gust = 0.75 + 0.25 * Math.sin(t * 0.9) * Math.sin(t * 0.37 + 1);
  const a = 0.28 + 0.15 * Math.sin(t * 0.05);
  return { k, wx: Math.cos(a) * gust, wz: Math.sin(a) * gust };
}
