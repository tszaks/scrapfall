// Dry Gulch's TRAIN ROBBERY (a map event, see events/mapEvents.ts): the payroll train, the
// armoured stopping run the Iron Marshal rides in on the boss wave, is called in early. It
// rolls out of the north canyon and stands at the platform; as it stops a gang of
// desperados and gunmen jumps off and holds the station until it pulls out again.
// The train itself is synced like the boss train (the host's bossAt goes out in snapshots);
// the gang comes through the normal wave machinery, so guests see it like any enemy.
import type { EventCtx } from "../events/mapEvents";
import type { MapEventHooks } from "../events/mapHooks";
import { bossSpot, callBossTrain, trainClock } from "./trainSim";

const state = { standsAt: -1, gang: false, calledAt: 0 };

export const trainRobbery: MapEventHooks = {
  start(ctx: EventCtx) {
    state.gang = false;
    state.calledAt = trainClock.t;
    // the host calls the train; it tells us when it will stand at the platform
    state.standsAt = ctx.host ? ctx.t + callBossTrain(trainClock.t) : -1;
    ctx.banner("TRAIN ROBBERY", "THE PAYROLL TRAIN IS COMING IN · HOLD THE STATION", "#8a4a1c");
  },
  step(ctx: EventCtx) {
    if (!ctx.host) {
      // guests: the synced train clock says when it stands; show the banner then (the host
      // spawns the gang, which reaches guests like any enemy)
      if (!state.gang && trainClock.bossAt > state.calledAt && trainClock.t >= trainClock.bossAt) {
        state.gang = true;
        ctx.banner("BANDITS AT THE STATION", "THE GANG IS OFF THE TRAIN", "#8a4a1c");
      }
      return;
    }
    if (state.gang || state.standsAt < 0 || ctx.t < state.standsAt) return;
    state.gang = true;
    const p = bossSpot();
    // the gang: desperados off the roof, gunmen out of the box car
    ctx.spawnEnemies("special", 3, p.x, p.z);
    ctx.spawnEnemies("shooter", 3, p.x + 2, p.z - 10);
    ctx.spawnEnemies("runner", 2, p.x - 1, p.z + 8);
    ctx.banner("BANDITS AT THE STATION", "THE GANG IS OFF THE TRAIN", "#8a4a1c");
  },
  end() {
    state.standsAt = -1;
  },
};
