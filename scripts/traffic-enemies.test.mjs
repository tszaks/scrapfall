import test from "node:test";
import assert from "node:assert/strict";
import { rolldown } from "rolldown";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const build = await rolldown({
  input: "traffic-test",
  plugins: [
    {
      name: "entry",
      resolveId(id) {
        if (id === "traffic-test") return id;
      },
      load(id) {
        if (id === "traffic-test")
          return `export * from '${root}src/game/trafficSim.ts'; export {makeVehicle} from '${root}src/game/vehicles.ts';`;
      },
    },
  ],
});
const { output } = await build.generate({ format: "esm", codeSplitting: false });
const sim = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`
);
await build.close();
test.after(() => {
  for (const h of process._getActiveHandles()) if (h.constructor.name === "MessagePort") h.unref();
});
function fixture(radius = 0.6) {
  const road = { c: 0, cls: "side" },
    cross = [
      { c: -200, cls: "side" },
      { c: 200, cls: "side" },
    ];
  const car = sim.makeCar(
    sim.makeVehicle(() => 0.2, Infinity, ["sedan"]),
    1.8,
    road,
    0,
    1,
    0,
    0,
    -60,
    22,
    1,
  );
  car.speed = 22;
  const enemy = { x: -20, z: car.z, alive: true, r: radius, big: false };
  let contacts = 0;
  const env = {
    roadX: cross,
    roadZ: [road],
    rand: () => 0.5,
    players: [],
    enemies: [enemy],
    onEnemyContact: () => contacts++,
  };
  return { car, enemy, env, contacts: () => contacts };
}
for (const dt of [1 / 60, 4 / 60])
  test(`traffic yields to a small robot and resumes when it clears (step${dt})`, () => {
    const { car, enemy, env, contacts } = fixture();
    for (let t = 0; t < 6; t += dt) sim.stepCars([car], env, dt, t);
    assert.ok(car.speed < 0.1, `stopped, speed${car.speed}`);
    assert.ok(car.x + car.v.len / 2 < enemy.x - enemy.r, "stopped before enemy");
    assert.equal(contacts(), 0, "brakes before collision");
    const stopped = car.x;
    enemy.z += 5;
    for (let t = 6; t < 9; t += dt) sim.stepCars([car], env, dt, t);
    assert.ok(car.speed > 5, "resumes promptly");
    assert.ok(car.x > stopped + 5, "no persistent brake latch");
  });
test("flyers and dead enemies do not stop traffic", () => {
  for (const kind of ["flying", "dead"]) {
    const { car, enemy, env } = fixture(kind === "flying" ? -99 : 0.6);
    if (kind === "dead") enemy.alive = false;
    for (let t = 0; t < 3; t += 1 / 60) sim.stepCars([car], env, 1 / 60, t);
    assert.ok(car.x > enemy.x, "passes without braking");
  }
});
test("player-controlled vehicles remain outside ambient simulation", () => {
  const { car, env } = fixture();
  car.driven = true;
  const before = { x: car.x, speed: car.speed };
  sim.stepCars([car], env, 1 / 60, 0);
  assert.deepEqual({ x: car.x, speed: car.speed }, before);
});
