import test, { after } from "node:test";
// The world's sliced builder owns a browser MessageChannel. Close test-owned ports.
const NativeChannel = globalThis.MessageChannel;
const channels = [];
globalThis.MessageChannel = class extends NativeChannel {
  constructor() {
    super();
    channels.push(this);
  }
};
after(() => {
  for (const c of channels) {
    c.port1.close();
    c.port2.close();
  }
  globalThis.MessageChannel = NativeChannel;
});
import assert from "node:assert/strict";
import { rolldown } from "rolldown";
import { resolve } from "node:path";
const bundle = await rolldown({
  input: "natural-test",
  plugins: [
    {
      name: "natural-test",
      resolveId(id) {
        if (id === "natural-test") return "\0natural-test";
        if (id.startsWith("./src/")) return resolve(id + ".ts");
      },
      load(id) {
        if (id === "\0natural-test")
          return `
        export { spruceGeo, farSpruceGeo } from './src/game/alpine/forest';
        export { templates } from './src/game/western/mesh';
        export { Geo } from './src/game/cityGeo';
        export { setGeometryDetail } from './src/game/environment/detailQuality';`;
      },
      transform(code, id) {
        if (id.endsWith("/western/mesh.ts")) return code + "\nexport { templates };";
      },
    },
  ],
});
const { output } = await bundle.generate({ format: "esm", codeSplitting: false });
const env = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`
);
await bundle.close();

test("sagebrush stays rooted, non-colliding and within the old triangle budget across quality changes", () => {
  const template = env.templates().bush.d;
  assert.equal(template.count / 3, 100);
  assert.deepEqual(template.nonSolid, [[0, template.count]]);
  const g = new env.Geo();
  g.stamp(template, 0, 0, 0);
  const geometry = g.build(),
    positions = geometry.getAttribute("position");
  let minY = Infinity,
    maxY = -Infinity;
  for (let i = 0; i < positions.count; i++) {
    minY = Math.min(minY, positions.getY(i));
    maxY = Math.max(maxY, positions.getY(i));
    assert.ok(Number.isFinite(positions.getX(i) + positions.getY(i) + positions.getZ(i)));
  }
  assert.ok(minY < 0 && minY > -0.06);
  assert.ok(maxY > 0.3 && maxY < 0.7);
  for (const low of [false, true, false, true]) {
    env.setGeometryDetail(geometry, low);
    assert.equal(geometry.drawRange.count / 3, low ? 80 : 100);
    assert.equal(geometry.getAttribute("position"), positions);
  }
  geometry.dispose();
});

test("fuller spruce silhouette retains the existing near triangle budget and near/far crown scale", () => {
  const near = env.spruceGeo(),
    far = env.farSpruceGeo();
  assert.ok(near.getAttribute("position").count / 3 < 1100);
  const radius = (g) => {
    const p = g.getAttribute("position");
    let max = 0;
    for (let i = 0; i < p.count; i++) max = Math.max(max, Math.hypot(p.getX(i), p.getZ(i)));
    return max;
  };
  assert.ok(Math.abs(radius(near) - radius(far)) < 0.025);
  const trunk = env.spruceGeo(false, true);
  assert.equal(trunk.getAttribute("position").count / 3, 10);
  near.dispose();
  far.dispose();
  trunk.dispose();
});


test("needle spruce keeps finite UVs and geometry budgets across both quality tiers", () => {
  const near = env.spruceGeo(), far = env.farSpruceGeo();
  const position = near.getAttribute("position");
  const uv = near.getAttribute("uv");
  assert.equal(uv.count, position.count);
  for (const value of uv.array) assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
  assert.ok(position.count / 3 <= 380);
  assert.ok(far.getAttribute("position").count / 3 <= 110);
  for (const low of [true, false, true, false]) {
    env.setGeometryDetail(near, low);
    assert.equal(near.getAttribute("position"), position);
    assert.equal(near.getAttribute("uv"), uv);
    assert.equal(near.drawRange.count, near.userData.detailCounts[low ? "low" : "high"]);
    assert.ok(near.drawRange.count / 3 <= (low ? 280 : 380));
  }
  near.dispose(); far.dispose();
});
