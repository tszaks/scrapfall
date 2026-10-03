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
