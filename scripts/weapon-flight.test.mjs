import test from "node:test";
import assert from "node:assert/strict";
import { rolldown } from "rolldown";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const build = await rolldown({
  input: "flight-test",
  plugins: [
    {
      name: "entry",
      resolveId(id) {
        if (id === "flight-test") return id;
      },
      load(id) {
        if (id === "flight-test")
          return `export * from '${root}src/game/weaponFlight.ts'; export * from '${root}src/game/ballistics.ts'; export * from '${root}src/game/projectileContact.ts'; export * from '${root}src/game/enemyProjectiles.ts'; export * from '${root}src/game/staticCollision.ts'; export { BoxGeometry } from 'three';`;
      },
    },
  ],
});
const { output } = await build.generate({ format: "esm", codeSplitting: false });
const p = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`
);
await build.close();
test("fast rounds hit a tiny hornet and stop at a thin wall at 20/30/60/120 fps", () => {
  for (const hz of [20, 30, 60, 120])
    for (const speed of [250, 300, 350, 400, 450, 600, 1170]) {
      p.resetStaticCollision();
      const wall = new p.BoxGeometry(0.02, 4, 4).translate(5, 2, 0);
      const dispose = p.registerStaticGeometry("map", [wall]);
      const from = { x: 0, y: 1.6, z: 0 },
        to = { x: speed / hz, y: 1.6, z: 0 };
      const t = p.firstWorldHit(from, to, () => false);
      if (to.x > 5) assert.ok(t > 0 && t < 1, `wall ${speed}/${hz}`);
      const enemy = { x: to.x / 2, z: 0, alive: true, kind: "hornet" };
      assert.ok(p.bodyContact(from, to, enemy, 0.35) > 0, `hornet ${speed}/${hz}`);
      if (to.x > 6)
        assert.equal(
          p.bodyContacts(from, to, [{ ...enemy, x: 6 }], () => 0.35, new Map(), t).length,
          0,
          "cover wins",
        );
      dispose();
      wall.dispose();
    }
});
test("Shredder reaches 60m in under 0.15s; rockets keep their original pace", () => {
  assert.ok(60 / p.FLIGHT.minigun.speed < 0.15);
  assert.equal(p.FLIGHT.cannon.speed, 13);
  assert.equal(p.FLIGHT.flak.speed, 16);
  for (const f of Object.values(p.FLIGHT))
    assert.ok(f.speed > 0 && f.life > 0 && f.speed * f.life <= 420);
});
test("600m/s Longshot retains a 50m zero and mild long-range drop", () => {
  const from = { x: 0, y: 1.6, z: 0 },
    target = { x: 0, y: 1.6, z: -50 },
    v = { x: 0, y: 0, z: 0 };
  p.ballisticDirection(v, from, target, p.FLIGHT.sniper.speed, p.bulletGravity(19));
  const speed = p.FLIGHT.sniper.speed;
  for (const distance of [50, 300]) {
    const t = distance / (-v.z * speed),
      pos = { ...from },
      velocity = { x: v.x * speed, y: v.y * speed, z: v.z * speed };
    p.advanceBallistic(pos, velocity, p.bulletGravity(19), t);
    if (distance === 50) assert.ok(Math.abs(pos.y - 1.6) < 1e-8);
    else assert.ok(pos.y < 1.6 && pos.y > 0.4);
  }
});
// slice.ts uses a browser-style MessageChannel; release its idle ports in Node.
test.after(() => {
  for (const h of process._getActiveHandles()) if (h.constructor.name === "MessagePort") h.unref();
});
