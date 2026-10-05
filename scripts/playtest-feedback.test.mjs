import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
async function pure(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
const sync = await pure("../src/game/enemySync.ts");
test("dead enemy snapshots preserve each death location for guest money drops", () => {
  for (const [x, z] of [
    [75, 34],
    [-120, 88],
    [32, -62],
  ]) {
    const e = { kind: "drifter", alive: false, x, z, swing: 0, flash: 0 };
    const decoded = sync.unpackEnemy(sync.packEnemy(e, ["drifter"]), 0, ["drifter"]);
    assert.equal(decoded.alive, false);
    assert.equal(decoded.x, x);
    assert.equal(decoded.z, z);
  }
});
const ammo = await pure("../src/game/weaponSupply.ts");
test("reload fills a magazine from remaining ammo without creating ammo", () => {
  ammo.resetSupply();
  assert.equal(ammo.magazine("smg", 120), 30);
  ammo.supply.loaded.smg = 0;
  assert.equal(ammo.beginReload("smg", 90), true);
  ammo.tickReload(2, "smg", 90);
  assert.equal(ammo.magazine("smg", 90), 30);
  assert.equal(ammo.supply.remaining, 0);
  ammo.supply.loaded.smg = 0;
  ammo.beginReload("smg", 7);
  ammo.tickReload(2, "smg", 7);
  assert.equal(ammo.magazine("smg", 7), 7);
  ammo.supply.loaded.smg = 0;
  assert.equal(ammo.beginReload("smg", 0), false);
});
test("changing weapon cancels the prior reload", () => {
  ammo.resetSupply();
  ammo.supply.loaded.smg = 0;
  ammo.beginReload("smg", 90);
  ammo.tickReload(0.1, "pistol", 40);
  assert.equal(ammo.supply.reloading, "");
  assert.equal(ammo.supply.remaining, 0);
  assert.equal(ammo.magazine("smg", 90), 0);
});
const ledger = await pure("../src/game/shardLedger.ts");
test("two squad members cannot award the same shared money twice", () => {
  const taken = new Set();
  ledger.shardLedger.set("3-2-0", { value: 5, x: 30, z: 60 });
  assert.equal(ledger.claimShard("3-2-0", taken), 5);
  assert.equal(ledger.claimShard("3-2-0", taken), 0);
  assert.equal(ledger.claimShard("unknown", taken), 0);
});
const revive = await pure("../src/game/revive.ts");
test("recovery distinguishes downed revives from fully dead wave respawns", () => {
  const { UP, DOWN, DEAD, playerLifeState } = revive;
  assert.equal(playerLifeState(false, false), UP);
  assert.equal(playerLifeState(true, true), DOWN);
  assert.equal(playerLifeState(true, false), DEAD);
  // Health can arrive before a stale downed flag clears; health wins.
  assert.equal(playerLifeState(false, true), UP);
});

test("host and guest revives use the current floor and survive repeated downs", () => {
  for (const target of ["host", "guest"]) {
    revive.resetRevive();
    const helper = target === "host" ? "guest" : "host";
    const players = [
      { id: target, x: 52, y: 12.4, z: -18, hp: 0, bledOut: false },
      { id: helper, x: 53, y: 12.4, z: -18, hp: 10, bledOut: false },
    ];
    const wants = new Map([[helper, target]]);
    for (let cycle = 0; cycle < 2; cycle++) {
      players[0].hp = 0;
      revive.hostReviveStep(0, players, wants);
      assert.equal(revive.squad.get(target).st, revive.DOWN);
      const before = players.map((p) => ({ ...p }));
      assert.deepEqual(revive.hostReviveStep(2, players, wants).revived, [target]);
      assert.equal(revive.squad.get(target).st, revive.UP);
      assert.deepEqual(players, before, "revive authority does not replace the current pose");
      players[0].hp = 6;
      revive.hostReviveStep(2, players, new Map());
    }
  }
});

test("bleed-out stays dead until wave health returns, including mirrored squad state", () => {
  revive.resetRevive();
  const players = [{ id: "guest", x: 52, y: 12.4, z: -18, hp: 0, bledOut: false }];
  assert.deepEqual(revive.hostReviveStep(revive.BLEED_TIME, players, new Map()).bled, ["guest"]);
  const snapshot = revive.squadMsg();
  revive.resetRevive();
  revive.applySquadMsg(snapshot);
  assert.equal(revive.squad.get("guest").st, revive.DEAD);
  assert.deepEqual(revive.hostReviveStep(2, players, new Map()).revived, []);
  assert.equal(revive.squad.get("guest").st, revive.DEAD);
  players[0].hp = 16;
  revive.hostReviveStep(0, players, new Map());
  assert.equal(revive.squad.get("guest").st, revive.UP);
});

test("a held revive survives damage and finishes in two seconds", () => {
  revive.resetRevive();
  revive.myRevive.target = "guest";
  const players = [
      { id: "host", x: 0, z: 0, hp: 10, bledOut: false },
      { id: "guest", x: 1, z: 0, hp: 0, bledOut: false },
    ],
    wants = new Map([["host", "guest"]]);
  revive.hostReviveStep(1, players, wants);
  assert.equal(revive.squad.get("guest").prog, 0.5);
  players[0].hp = 8;
  assert.equal(revive.reviveInterrupted(), false);
  assert.equal(revive.myRevive.mustRelease, false);
  assert.deepEqual(revive.hostReviveStep(1, players, wants).revived, ["guest"]);
});

const warm = await pure("../src/game/warmInstances.ts");
test("empty combat pools participate in warm-up and retain their hidden state", () => {
  const empty = {
      isInstancedMesh: true,
      count: 0,
      instanceMatrix: { count: 100 },
      geometry: { isInstancedBufferGeometry: true, instanceCount: 0 },
    },
    active = { isInstancedMesh: true, count: 12, instanceMatrix: { count: 100 } };
  warm.withWarmInstances([empty, active], () => {
    assert.equal(empty.count, 1);
    assert.equal(empty.geometry.instanceCount, 1);
    assert.equal(active.count, 12);
  });
  assert.equal(empty.count, 0);
  assert.equal(empty.geometry.instanceCount, 0);
  assert.throws(() =>
    warm.withWarmInstances([empty], () => {
      throw new Error("compile failed");
    }),
  );
  assert.equal(empty.count, 0);
});

test("ammo purchases preserve upgraded or above-capacity reserves", () => {
  assert.equal(ammo.refillAmmo(200, 220), 220);
  assert.equal(ammo.refillAmmo(180, 140), 180);
  assert.equal(ammo.refillAmmo(0, 120), 60);
});

const controls = await pure("../src/game/input/remap.ts");
test("an old empty Field Dressing binding gets a free key without stealing a custom key", () => {
  const oldWindow = globalThis.window,
    oldStorage = globalThis.localStorage;
  try {
    globalThis.window = {};
    globalThis.localStorage = {
      getItem: () => JSON.stringify({ keys: { shopHeal: [], forward: ["KeyH"] } }),
    };
    controls.loadControls();
    assert.deepEqual(controls.controlSettings.keys.forward, ["KeyH"]);
    assert.deepEqual(controls.controlSettings.keys.shopHeal, ["KeyI"]);
  } finally {
    if (oldWindow === undefined) delete globalThis.window;
    else globalThis.window = oldWindow;
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
  }
});

test("only a new wave grants recovery across repeated and reordered syncs", () => {
  const state = { seed: 11, wave: 0 };
  assert.equal(
    revive.advanceRecoveryWave(state, 1, 11, true),
    false,
    "world initialization is not a wave start",
  );
  assert.equal(state.wave, 0);
  assert.equal(revive.advanceRecoveryWave(state, 1, 11), true);
  assert.equal(revive.advanceRecoveryWave(state, 1, 11), false, "same-wave reconnect");
  assert.equal(revive.advanceRecoveryWave(state, 3, 11), true, "missed waves during reconnect");
  assert.equal(
    revive.advanceRecoveryWave(state, 2, 11),
    false,
    "late status cannot roll progress back",
  );
  assert.equal(
    revive.advanceRecoveryWave(state, 3, 11),
    false,
    "batched or repeated current status",
  );
  assert.equal(state.wave, 3);
  // Host transfer retains this run's tracker; only a new run starts a new one.
  assert.equal(revive.advanceRecoveryWave(state, 3, 11), false);
  assert.equal(revive.advanceRecoveryWave({ seed: 12, wave: 0 }, 1, 12), true);
  const nextRun = { seed: 12, wave: 0 };
  assert.equal(
    revive.advanceRecoveryWave(nextRun, 10, 11),
    false,
    "old world callback during rebuild",
  );
  assert.equal(nextRun.wave, 0);
  assert.equal(revive.advanceRecoveryWave(nextRun, 1, 12), true);
  for (const invalid of [0, -1, NaN, Infinity, 3.5])
    assert.equal(revive.advanceRecoveryWave(state, invalid, 11), false);
  assert.equal(state.wave, 3);
});

test("the shared Game status callback recovers health only once per real wave", async () => {
  const source = await readFile(new URL("../src/game/Game.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile(
    "Game.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let callback;
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(tree) === "onStatus")
      callback = node.initializer.expression.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(callback, "World recovery callback is present");
  const compiled = ts.transpileModule(`return (${callback});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const tracker = { current: { seed: 11, wave: 0 } },
    built = { seed: 11 };
  let health = 0;
  const perks = { current: { mend: 1 } };
  const onStatus = new Function(
    "advanceRecoveryWave",
    "recoveryWave",
    "built",
    "setStatus",
    "setBanner",
    "perksRef",
    "maxHp",
    "multiplayer",
    "setHealth",
    compiled,
  )(
    revive.advanceRecoveryWave,
    tracker,
    built,
    () => {},
    () => {},
    perks,
    16,
    true,
    (change) => {
      health = change(health);
    },
  );
  onStatus(1, 0, false, true, true);
  assert.equal(health, 0, "initialization must not revive");
  onStatus(1, 5, false, true);
  assert.equal(health, 16);
  health = 0;
  onStatus(1, 5, false, true);
  assert.equal(health, 0, "same-wave status must not revive");
  onStatus(2, 5, false, false);
  assert.equal(health, 16, "missed banner still recovers at the next wave");
  health = 0;
  onStatus(1, 5, false, true);
  onStatus(2, 5, false, true);
  assert.equal(health, 0, "reordered and duplicate callbacks do not revive again");
  health = 5;
  onStatus(2, 5, false, true);
  assert.equal(health, 5, "same-wave reconnect must not grant Mend");
  onStatus(3, 5, false, true);
  assert.equal(health, 8);
  tracker.current = { seed: 12, wave: 0 };
  health = 0;
  onStatus(10, 5, false, true);
  assert.equal(health, 0, "old world cannot recover a new run while rebuilding");
  assert.equal(tracker.current.wave, 0);
  built.seed = 12;
  onStatus(1, 5, false, true);
  assert.equal(health, 16);
});
