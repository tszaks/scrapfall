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

const entry = `
export { Geo, L, rectPoly } from './src/game/cityGeo';
export { facadeDepth } from './src/game/environment/facadeDepth';
export { broadleafCrown } from './src/game/environment/foliage';
export { spruceGeo } from './src/game/alpine/forest';
export { surfaceDetail, setGeometryDetail } from './src/game/environment/detailQuality';
export { quality, setQualityPref, setAutoTier } from './src/game/quality';
export { generateBeach, X } from './src/game/beach/beachLayout';
export { beachMeshes } from './src/game/beach/beachMesh';
`;
const bundle = await rolldown({
  input: "detail-test",
  plugins: [
    {
      name: "test-entry",
      resolveId(id) {
        if (id === "detail-test") return "\0detail-test";
        if (id.startsWith("./src/")) return resolve(id + ".ts");
      },
      load(id) {
        if (id === "\0detail-test") return entry;
      },
    },
  ],
});
const { output } = await bundle.generate({ format: "esm", codeSplitting: false });
const env = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`
);
await bundle.close();

function transitions(geometry) {
  const positions = geometry.getAttribute("position");
  const colors = geometry.getAttribute("color");
  const index = geometry.index;
  let high;
  for (const pref of ["high", "low", "high", "auto"]) {
    env.setQualityPref(pref);
    for (const tier of pref === "auto" ? ["low", "high", "low", "high"] : [pref]) {
      if (pref === "auto") env.setAutoTier(tier);
      env.setGeometryDetail(geometry, env.quality().tier === "low");
      assert.equal(env.surfaceDetail.value, tier !== "low");
      if (tier === "high") {
        high ??= geometry.drawRange.count;
        assert.equal(geometry.drawRange.count, high);
      } else assert.ok(geometry.drawRange.count < high);
      assert.equal(geometry.getAttribute("position"), positions);
      assert.equal(geometry.getAttribute("color"), colors);
      assert.equal(geometry.index, index);
    }
  }
  assert.equal(high, index.count);
}

test("cached broadleaf templates recover detail after low-first construction and preserve collision exclusions", () => {
  env.setQualityPref("low");
  const template = new env.Geo();
  template.decoration(() => env.broadleafCrown(template, [0, 4, 0], [2, 2, 2], "#647c52"));
  const frozen = template.freeze();
  for (let rebuild = 0; rebuild < 2; rebuild++) {
    const chunk = new env.Geo();
    chunk.box(0, 0, 0, 1, 1, 1);
    const solidCount = chunk.n;
    chunk.stamp(frozen, 5, 0, 5);
    const geometry = chunk.build();
    assert.deepEqual(geometry.userData.nonSolid, [[solidCount, frozen.count]]);
    const low = geometry.userData.detailCounts.low;
    assert.ok(low >= solidCount);
    const first = Array.from(geometry.index.array).slice(0, solidCount);
    assert.deepEqual(
      first,
      Array.from({ length: solidCount }, (_, i) => i),
    );
    transitions(geometry);
    geometry.dispose();
  }
});

test("spruce quality transitions retain vertex colours and restore full branches without rebuilding instances", () => {
  for (const narrow of [false, true]) {
    env.setQualityPref("low");
    const geometry = env.spruceGeo(narrow);
    transitions(geometry);
    const colors = geometry.getAttribute("color");
    assert.ok(Array.from(colors.array).every(Number.isFinite));
    assert.ok(Array.from(colors.array).some((v) => v > 0));
    geometry.dispose();
  }
});

test("Pier sand scan flag excludes skate concrete, parking asphalt, and bluff terrain", () => {
  let seed = 7;
  const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const gen = env.generateBeach(random, 400, 400, false);
  let result;
  do {
    result = gen.next();
  } while (!result.done);
  const layout = result.value.layout;
  const built = env.beachMeshes(layout);
  const counts = { sand: 0, skate: 0, lot: 0, bluff: 0 };
  const inside = (x, z, r) => x > r.x0 + 2 && x < r.x1 - 2 && z > r.z0 + 2 && z < r.z1 - 2;
  for (const chunk of built.chunks) {
    if (!chunk.ground) continue;
    const p = chunk.ground.getAttribute("position"),
      f = chunk.ground.getAttribute("aFac");
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        z = p.getZ(i);
      const kind = inside(x, z, layout.beach.skate)
        ? "skate"
        : inside(x, z, layout.beach.lot)
          ? "lot"
          : x > env.X.bluff + 2 && x < env.X.top - 2
            ? "bluff"
            : x > -390 && x < 0 && Math.abs(z) > 180 && Math.abs(z) < 390
              ? "sand"
              : null;
      if (!kind) continue;
      assert.equal(f.getZ(i), kind === "sand" ? 1 : 0, `${kind} at ${x},${z}`);
      counts[kind]++;
    }
    for (const key of ["ground", "main", "detail", "glow", "signs", "pools"]) chunk[key]?.dispose();
  }
  for (const [kind, count] of Object.entries(counts)) assert.ok(count > 0, kind);
});

test("facade relief is bounded, optional, non-solid and leaves real room cutouts empty", () => {
  const g = new env.Geo();
  const room = { bounds: { x0: 3, x1: 9, z0: 0, z1: 5 }, base: 0, top: 12 };
  env.facadeDepth(
    g,
    env.rectPoly(0, 0, 18, 18),
    0,
    45,
    { layer: env.L.ribbon, tint: 0xaaaaaa, fh: 3, seed: 0.3, uOff: 0 },
    15,
    false,
    [room],
  );
  const geometry = g.build();
  const p = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");
  assert.ok(
    Array.from({ length: normals.count }, (_, i) => normals.getY(i)).some((y) => y < -0.99),
    "elevated trim needs closed undersides",
  );
  assert.ok(p.count > 0 && p.count / 3 < 6000);
  assert.deepEqual(geometry.userData.nonSolid, [[0, p.count]]);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    assert.ok(Number.isFinite(x + y + z));
    assert.ok(y >= 3.05 - 1e-5 && y <= 26 + 1e-5, `unsafe facade height ${y}`);
    assert.ok(!(x > 3.001 && x < 8.999 && z < 0 && y < 11.999), "trim covers a real opening");
    assert.ok(x >= -0.19 && x <= 18.19 && z >= -0.19 && z <= 18.19, "relief projects too far");
  }
  transitions(geometry);
  env.setGeometryDetail(geometry, true);
  assert.equal(geometry.drawRange.count, 0);
  geometry.dispose();
});

test("branched crowns stay under 2000 triangles per tree with reduced LOW detail", () => {
  const g = new env.Geo();
  env.broadleafCrown(g, [0, 4, 0], [2, 2, 2], "#647c52");
  const geometry = g.build();
  assert.ok(g.n / 3 < 2000, `crown budget ${g.n / 3}`);
  transitions(geometry);
  geometry.dispose();
});
