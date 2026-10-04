import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { PerspectiveCamera, Vector3 } from "three";
const source = await readFile(new URL("../src/game/vehicleCamera.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { VehicleCamera } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText.replace('from "three"', `from ${JSON.stringify(import.meta.resolve("three"))}`)).toString("base64")}`
);
const clear = () => undefined;
const car = (half = 2.25, width = 0.9, height = 1.5) => ({
  id: "one",
  x: 0,
  z: 0,
  yaw: 0,
  half,
  width,
  height,
});
const logical = (aspect = 16 / 9) => {
  const camera = new PerspectiveCamera(75, aspect, 0.05, 1000);
  camera.position.set(0, 1.95, 0.25);
  camera.rotation.order = "YXZ";
  camera.rotation.y = Math.PI;
  camera.updateMatrixWorld();
  return camera;
};
test("compact, sedan and bus hulls fit landscape and portrait without changing logical eye/lens", () => {
  for (const [half, width, height] of [
    [1.8, 0.825, 1.4],
    [2.25, 0.9, 1.5],
    [6, 1.3, 3.6],
  ]) {
    for (const aspect of [16 / 9, 4 / 3, 9 / 16]) {
      const eye = logical(aspect),
        saved = eye.clone(),
        c = car(half, width, height);
      const cam = new VehicleCamera().update(eye, c, 0, 1 / 60, clear);
      assert.equal(cam.fov, 83);
      for (const x of [-width, width])
        for (const y of [0, height])
          for (const z of [-half, half]) {
            const p = new Vector3(x, y, z).project(cam);
            assert.ok(
              Math.abs(p.x) < 0.85 && Math.abs(p.y) < 0.85 && p.z < 1,
              `hull corner ${p.toArray()}`,
            );
          }
      assert.deepEqual(eye.position.toArray(), saved.position.toArray());
      assert.deepEqual(eye.quaternion.toArray(), saved.quaternion.toArray());
      assert.equal(eye.fov, saved.fov);
    }
  }
});
test("vehicle heading follows smoothly while independent look remains usable", () => {
  const rig = new VehicleCamera(),
    eye = logical(),
    c = car();
  const first = rig.update(eye, c, 0, 1 / 60, clear).position.clone();
  c.yaw = Math.PI / 2;
  rig.update(eye, c, 0, 1 / 60, clear);
  assert.ok(rig.camera.position.distanceTo(first) < 1);
  for (let i = 0; i < 120; i++) rig.update(eye, c, 0, 1 / 60, clear);
  assert.ok(rig.camera.position.x < -4, "camera follows turning car behind +X heading");
  eye.rotation.y += Math.PI / 2;
  for (let i = 0; i < 120; i++) rig.update(eye, c, 0, 1 / 60, clear);
  assert.ok(rig.camera.position.z > 4, "look input orbits independently");
});
test("thin walls retract the camera body immediately and clearing eases it back", () => {
  const rig = new VehicleCamera(),
    eye = logical(),
    c = car();
  rig.update(eye, c, 0, 1 / 60, clear);
  const wall = (a, b) => (b.z < -3 ? (-3 - a.z) / (b.z - a.z) : undefined);
  rig.update(eye, c, 0, 1 / 60, wall);
  assert.ok(rig.camera.position.z > -2.76);
  const close = rig.camera.position.clone();
  rig.update(eye, c, 0, 1 / 60, clear);
  assert.ok(rig.camera.position.distanceTo(close) < 1);
});
test("ground intersections retract, reset/reentry does not retain an old follow pose", () => {
  const rig = new VehicleCamera(),
    eye = logical(),
    c = car();
  let probes = 0;
  rig.update(eye, c, 0, 1 / 60, () => {
    probes++;
    return 0.3;
  });
  assert.equal(probes, 7, "bounded sweep count");
  rig.reset();
  c.x = 80;
  const cam = rig.update(eye, c, 4, 1 / 60, clear);
  assert.ok(Math.abs(cam.position.x - 80) < 1);
  assert.ok(cam.position.y > 4 + c.height);
});

test("already-wide user FOV is preserved and reset starts a fresh orbit", () => {
  const rig = new VehicleCamera(),
    eye = logical(),
    c = car();
  eye.fov = 105;
  assert.equal(rig.update(eye, c, 0, 1 / 60, clear).fov, 105);
  eye.rotation.y += Math.PI / 2;
  rig.update(eye, c, 0, 1 / 60, clear);
  rig.reset();
  eye.rotation.y = Math.PI;
  assert.ok(Math.abs(rig.update(eye, c, 0, 1 / 60, clear).position.x) < 0.001);
});

test("projection follows lens/viewport changes while unchanged frames reuse it", () => {
  const rig = new VehicleCamera(),
    eye = logical(),
    c = car();
  rig.update(eye, c, 0, 1 / 60, clear);
  let rebuilds = 0;
  const update = rig.camera.updateProjectionMatrix.bind(rig.camera);
  rig.camera.updateProjectionMatrix = () => {
    rebuilds++;
    update();
  };
  rig.update(eye, c, 0, 1 / 60, clear);
  assert.equal(rebuilds, 0);
  eye.aspect = 9 / 16;
  eye.near = 0.1;
  eye.far = 300;
  eye.updateProjectionMatrix();
  rig.update(eye, c, 0, 1 / 60, clear);
  assert.equal(rebuilds, 1);
  assert.equal(rig.camera.aspect, 9 / 16);
  assert.equal(rig.camera.near, 0.1);
  assert.equal(rig.camera.far, 300);
  eye.layers.set(2);
  rig.update(eye, c, 0, 1 / 60, clear);
  assert.equal(rig.camera.layers.mask, eye.layers.mask);
  eye.fov = 90;
  eye.updateProjectionMatrix();
  rig.update(eye, c, 0, 1 / 60, clear);
  assert.equal(rig.camera.fov, 98);
  assert.equal(rebuilds, 2);
  const replacement = logical(4 / 3);
  rig.update(replacement, c, 0, 1 / 60, clear);
  assert.equal(rig.camera.fov, 83);
  assert.equal(rig.camera.aspect, 4 / 3);
  assert.equal(rebuilds, 3);
});

test("later body sweeps only inspect the prefix before known cover", () => {
  const rig = new VehicleCamera(),
    eye = logical(),
    c = car();
  const lengths = [];
  rig.update(eye, c, 0, 1 / 60, (a, b) => {
    lengths.push(a.distanceTo(b));
    return lengths.length === 1 ? 0.4 : lengths.length === 2 ? 0.5 : undefined;
  });
  assert.equal(lengths.length, 7, "all body offsets remain checked");
  assert.ok(Math.abs(lengths[1] - lengths[0] * 0.4) < 1e-8);
  for (const length of lengths.slice(2)) assert.ok(Math.abs(length - lengths[0] * 0.2) < 1e-8);
  const roofAnchor = new Vector3(c.x, c.height + 0.6, c.z);
  assert.ok(
    Math.abs(rig.camera.position.distanceTo(roofAnchor) - (lengths[0] * 0.2 - 0.08)) < 1e-8,
  );
});

test("shorter boom keeps every hull corner framed at pitch and orbit extremes", () => {
  for (const [half, width, height] of [
    [1.8, 0.825, 1.4],
    [2.25, 0.9, 1.5],
    [6, 1.3, 3.6],
  ]) {
    for (const aspect of [16 / 9, 9 / 16]) {
      for (const pitch of [-1.2, 0, 1.2]) {
        for (const yaw of [0, Math.PI / 4, Math.PI / 2]) {
          const eye = logical(aspect),
            c = car(half, width, height);
          eye.rotation.x = pitch;
          eye.rotation.y += yaw;
          eye.updateMatrixWorld();
          const cam = new VehicleCamera().update(eye, c, 0, 1 / 60, clear);
          for (const x of [-width, width])
            for (const y of [0, height])
              for (const z of [-half, half]) {
                const p = new Vector3(x, y, z).project(cam);
                assert.ok(
                  Math.abs(p.x) < 0.85 && Math.abs(p.y) < 0.85 && p.z < 1,
                  `hull ${half}/${width}/${height}, aspect ${aspect}, pitch ${pitch}, yaw ${yaw}: ${p.toArray()}`,
                );
              }
        }
      }
    }
  }
});
