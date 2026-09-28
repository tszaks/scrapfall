// Dry Gulch's weather: dust storms. A pure function of the shared train clock (train.ts),
// so the host and every guest agree on when the wall of dust rolls in.
import { matchEnvironment } from "../matchEnvironment";
import { trainClock } from "./trainSim";

let forced: number | null = null;
if (typeof window !== "undefined") {
  const v = new URLSearchParams(window.location.search).get("storm");
  if (v === "1") forced = 1;
  else if (v === "0") forced = 0;
}

/** storm strength 0..1 at time t, and the wind (blowing out of the west, gusting) */
export function stormAt(t: number = trainClock.t) {
  // Ordinary matches keep their chosen weather; the dust override is for visual tests.
  let k = (matchEnvironment.allowOverrides ? forced : null) ?? 0;
  k = k * k * (3 - 2 * k);
  const gust = 0.75 + 0.25 * Math.sin(t * 0.9) * Math.sin(t * 0.37 + 1);
  const a = 0.28 + 0.15 * Math.sin(t * 0.05);
  return { k, wx: Math.cos(a) * gust, wz: Math.sin(a) * gust };
}
