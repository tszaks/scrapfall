import test from "node:test";
import assert from "node:assert/strict";
import { rolldown } from "rolldown";
import { resolve } from "node:path";
const bundle = await rolldown({
  input: "occupants-test",
  plugins: [
    {
      name: "occupants-test",
      resolveId(id) {
        if (id === "occupants-test") return "\0occupants-test";
      },
      load(id) {
        if (id === "\0occupants-test")
          return `
        export {CarBatch,vehicleModel} from '${resolve("src/game/art/cars.ts")}';
        export {driverGeometry} from '${resolve("src/game/art/vehicleOccupants.ts")}';
        export {makeVehicle,SPECS} from '${resolve("src/game/vehicles.ts")}';
        export {setQualityPref} from '${resolve("src/game/quality.ts")}';
        export {PerspectiveCamera,Matrix4,Box3,Vector3} from 'three';`;
      },
    },
  ],
});
const { output } = await bundle.generate({ format: "esm", codeSplitting: false });
const api = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`
);
await bundle.close();
test.after(() => {
  for (const h of process._getActiveHandles()) if (h.constructor.name === "MessagePort") h.unref();
});
const vehicle = (type = "sedan") => api.makeVehicle(() => 0.2, Infinity, [type]);
const camera = (z = 8) => {
  const c = new api.PerspectiveCamera(60, 1.6, 0.1, 500);
  c.position.set(0, 2, z);
  c.lookAt(0, 1, 0);
  c.updateProjectionMatrix();
  return c;
};
test("shared driver geometry stays bounded and below every cabin roof", () => {
  const g = api.driverGeometry();
  assert.equal(api.driverGeometry(), g);
  assert.ok(g.getAttribute("position").count / 3 <= 360);
  for (const a of Object.values(g.attributes))
    for (const v of a.array) assert.ok(Number.isFinite(v));
  g.computeBoundingBox();
  for (const type of Object.keys(api.SPECS)) {
    const md = api.vehicleModel(type),
      s = api.SPECS[type];
    const b = g.boundingBox.clone().applyMatrix4(md.driverSeat);
    assert.ok(b.min.x > 0, `${type} stays in the driver's seat`);
    assert.ok(b.max.x < s.wid / 2 - 0.05, `${type} stays inside side glass`);
    assert.ok(b.min.z > -s.len / 2 && b.max.z < s.len / 2, `${type} stays inside cabin length`);
    const roof =
      type === "bus" ? s.ride + s.body : type === "van" ? s.ride + 2.05 : s.ride + s.body + s.cabH;
    assert.ok(b.max.y < roof - 0.035, `${type} head stays below roof`);
  }
});
test("occupants default empty, toggle without collision changes, and follow car transforms", () => {
  const batch = new api.CarBatch([vehicle(), vehicle()], 1),
    c = camera();
  const mesh = batch.group.getObjectByName("ambient-drivers");
  batch.place(0, 0, 0, 0, 0);
  batch.place(1, 3, 0, 0, 0);
  batch.commit(c);
  assert.equal(mesh.count, 0);
  const before = batch.contactBounds(0).clone();
  batch.place(0, 0, 0, 0, 0, { driver: true });
  batch.commit(c);
  assert.equal(mesh.count, 1);
  assert.ok(
    batch.contactBounds(0).equals(before),
    "visual occupant never changes collision bounds",
  );
  const m = new api.Matrix4();
  mesh.getMatrixAt(0, m);
  assert.ok(
    new api.Vector3().setFromMatrixPosition(m).x > 0,
    "driver follows the +x steering-wheel side",
  );
  batch.place(0, 0, 0, 0, Math.PI, { driver: true });
  batch.commit(c);
  mesh.getMatrixAt(0, m);
  assert.ok(new api.Vector3().setFromMatrixPosition(m).x < 0, "seat turns with the vehicle");
  batch.place(0, 0, 0, 0, 0, { driver: false });
  batch.commit(c);
  assert.equal(mesh.count, 0);
  batch.dispose();
});
test("live quality distance and wreck state reuse the same occupant buffers", () => {
  const batch = new api.CarBatch([vehicle()]),
    c = camera(28);
  const mesh = batch.group.getObjectByName("ambient-drivers"),
    matrix = mesh.instanceMatrix,
    geometry = mesh.geometry;
  batch.place(0, 0, 0, 0, 0, { driver: true });
  for (const [tier, count] of [
    ["high", 1],
    ["low", 0],
    ["medium", 1],
    ["high", 1],
  ]) {
    api.setQualityPref(tier);
    batch.commit(c);
    assert.equal(mesh.count, count);
    assert.equal(mesh.instanceMatrix, matrix);
    assert.equal(mesh.geometry, geometry);
  }
  batch.setWreck(0);
  batch.place(0, 0, 0, 0, 0, { driver: true });
  batch.commit(c);
  assert.equal(mesh.count, 0);
  batch.dispose();
});
