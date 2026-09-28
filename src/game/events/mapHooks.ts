// Map events whose set pieces belong to maps that build them: the Dry Gulch TRAIN ROBBERY
// and the beach pier WAVE SURGE. The event framework (mapEvents.ts) does the scheduling,
// the banner, the siren, the co-op sync and the timing; the map fills in what happens.
//
// Dry Gulch provides "train-robbery" from western/robbery.ts (the payroll train rolls in on
// the timetable's stopping run and a gang jumps off at the platform).
// Pacific Pier provides "wave-surge" from beach/waveSurge.ts (a rogue swell rises on the
//   horizon, breaks, runs up the sand to just short of the boardwalk, shoves and hurts anyone
//   caught, sweeps small enemies, then drains away; the deck and the boardwalk stay dry).
//
// Until a map provides its hooks, its event never fires. Everything a hook does should be
// a function of (ctx.seed, ctx.t) so every co-op client shows the same thing.
import type { Theme } from "../themes";
import type { EventCtx, MapEventDef } from "./mapEvents";

export type MapEventHooks = {
  start?: (ctx: EventCtx) => void;
  step?: (ctx: EventCtx) => void;
  end?: (ctx: EventCtx) => void;
};

const hooks = new Map<string, MapEventHooks>();
export function provideEventHooks(id: string, h: MapEventHooks | null) {
  if (h) hooks.set(id, h);
  else hooks.delete(id);
}
export function eventHooks(id: string) {
  return hooks.get(id);
}

const isLayout = (t: Theme, names: string[]) => {
  const layout = (t as Theme & { layout?: string }).layout ?? "";
  const n = t.name.toLowerCase();
  return names.some((w) => layout === w || n.includes(w));
};

export const TRAIN_ROBBERY_EVENT: MapEventDef = {
  id: "train-robbery",
  title: "TRAIN ROBBERY",
  sub: "THE 3:10 IS UNDER ATTACK",
  color: "#8a4a1c",
  applies: (t) => isLayout(t, ["western", "dry gulch"]) && hooks.has("train-robbery"),
  waves: [3, 10],
  chance: 0.45,
  cooldown: 4,
  guarantee: 7,
  delay: [8, 20],
  duration: 58,
  sound: "whistle",
  start: (ctx) => hooks.get("train-robbery")?.start?.(ctx),
  step: (ctx) => hooks.get("train-robbery")?.step?.(ctx),
  end: (ctx) => hooks.get("train-robbery")?.end?.(ctx),
};

export const WAVE_SURGE_EVENT: MapEventDef = {
  id: "wave-surge",
  title: "WAVE SURGE",
  sub: "GET TO HIGH GROUND",
  color: "#1c5a8a",
  applies: (t) => isLayout(t, ["beach", "pier"]) && hooks.has("wave-surge"),
  waves: [4, 11],
  chance: 0.45,
  cooldown: 4,
  guarantee: 7,
  delay: [8, 20],
  duration: 30,
  sound: "horn",
  start: (ctx) => hooks.get("wave-surge")?.start?.(ctx),
  step: (ctx) => hooks.get("wave-surge")?.step?.(ctx),
  end: (ctx) => hooks.get("wave-surge")?.end?.(ctx),
};
