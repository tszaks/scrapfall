import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const out = process.env.OUT ?? "output/enemy-pursuit";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
try {
  await page.goto(
    `${process.env.BASE ?? "http://localhost:5321"}/game/?map=gulch&seed=7&debug=1&quality=low`,
  );
  await page.getByRole("button", { name: /^start$/i }).click({ timeout: 90000 });
  await page.getByRole("button", { name: /enter arena/i }).click({ timeout: 90000 });
  await page.waitForFunction(() => window.__rs?.enemies.some((e) => e.alive), null, {
    timeout: 120000,
  });
  const supplied = process.env.FIXTURE
    ? JSON.parse(await readFile(process.env.FIXTURE, "utf8")).chosen
    : null;
  const fixture = await page.evaluate(
    ({ supplied, natural }) => {
      const s = __rs,
        nav = s.access.solid,
        n = nav.n,
        half = n * 2;
      if (natural) {
        const index = s.enemies.findIndex((e) => e.alive);
        window.__navIndex = index;
        s.invuln.current = 1e6;
        s.pending.current.fill(null);
        s.enemies.forEach((e, i) => {
          if (i !== index) e.alive = false;
        });
        s.nextWaveTimer.current = 1e6;
        const e = s.enemies[index],
          c = s.camera.position;
        return {
          natural: true,
          index,
          initial: { x: e.x, z: e.z },
          target: { x: c.x, z: c.z },
          initialDistance: Math.hypot(e.x - c.x, e.z - c.z),
        };
      }
      window.__navIndex = 0;
      const index = (x, z) =>
        Math.max(0, Math.min(n - 1, Math.floor((x + half) / 4))) * n +
        Math.max(0, Math.min(n - 1, Math.floor((z + half) / 4)));
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ];
      const candidates = [];
      for (const p of s.western.props) {
        if (p.k !== "fence") continue;
        const nx = Math.sin(p.rot),
          nz = Math.cos(p.rot);
        const a = { x: p.x + nx * 5, z: p.z + nz * 5 },
          b = { x: p.x - nx * 5, z: p.z - nz * 5 };
        if (
          s.enemyBodyAt(a.x, a.z, 0.6, 2) ||
          s.enemyBodyAt(b.x, b.z, 0.6, 2) ||
          s.los(a.x, a.z, b.x, b.z)
        )
          continue;
        if (Math.abs(s.groundAt(a.x, a.z) - s.groundAt(b.x, b.z)) > 0.5) continue;
        const start = index(a.x, a.z),
          goal = index(b.x, b.z);
        if (nav.g[start] || nav.g[goal]) continue;
        const q = [start],
          seen = new Set(q),
          parent = new Map();
        for (let h = 0; h < q.length && q.length < 1000; h++) {
          const k = q[h];
          if (k === goal) break;
          const i = Math.floor(k / n),
            j = k % n;
          dirs.forEach(([di, dj], d) => {
            const ni = i + di,
              nj = j + dj,
              nk = ni * n + nj;
            if (ni < 0 || nj < 0 || ni >= n || nj >= n || nav.g[nk] || seen.has(nk)) return;
            if (
              nav.links
                ? !(nav.links[k] & (1 << d))
                : di && dj && (nav.g[ni * n + j] || nav.g[i * n + nj])
            )
              return;
            seen.add(nk);
            q.push(nk);
            parent.set(nk, k);
          });
        }
        if (!seen.has(goal)) continue;
        let count = 0;
        for (let k = goal; k !== start; k = parent.get(k)) {
          if (k === undefined) {
            count = 999;
            break;
          }
          count++;
        }
        if (count >= 4 && count < 12)
          candidates.push({ a, b, prop: { x: p.x, z: p.z, rot: p.rot }, edges: count });
      }
      candidates.sort((a, b) => b.edges - a.edges);
      if (!supplied && !candidates.length)
        throw Error("No deterministic fence fixture with a valid route");
      const chosen = supplied ?? candidates[0];
      s.invuln.current = 1e6;
      s.pending.current.fill(null);
      s.enemies.forEach((e) => (e.alive = false));
      s.nextWaveTimer.current = 1e6;
      const e = s.enemies[0];
      Object.assign(e, {
        kind: "drifter",
        alive: true,
        hp: 100,
        max: 100,
        x: chosen.a.x,
        z: chosen.a.z,
        stuckFor: 0,
        lastX: undefined,
        lastZ: undefined,
        svT: 0,
        slow: 0,
        frozen: 0,
        burn: 0,
        swing: 0,
      });
      s.playtest.warp(chosen.b.x, s.groundAt(chosen.b.x, chosen.b.z), chosen.b.z);
      return {
        chosen,
        candidateCount: candidates.length,
        initial: { x: e.x, z: e.z },
        target: chosen.b,
      };
    },
    { supplied, natural: !!process.env.NATURAL },
  );
  console.log("fixture", JSON.stringify(fixture));
  await writeFile(`${out}/fixture.json`, JSON.stringify(fixture, null, 2));
  const samples = [];
  let reached = false;
  for (let t = 0; t < Number(process.env.SECONDS ?? 65); t++) {
    if (process.env.MOVE_AFTER && t === Number(process.env.MOVE_AFTER))
      await page.evaluate(() => {
        const s = __rs,
          c = s.camera.position;
        for (const dz of [-12, -10, -8, 12]) {
          if (!s.enemyBodyAt(c.x, c.z + dz, 0.6, 2)) {
            s.playtest.warp(c.x, s.groundAt(c.x, c.z + dz), c.z + dz);
            return;
          }
        }
        throw Error("No valid relocated target");
      });
    await page.waitForTimeout(1000);
    const sample = await page.evaluate(() => {
      const e = __rs.enemies[window.__navIndex],
        c = __rs.camera.position;
      return {
        x: e.x,
        z: e.z,
        targetX: c.x,
        targetZ: c.z,
        d: Math.hypot(e.x - c.x, e.z - c.z),
        collision: __rs.enemyBodyAt(e.x, e.z, 0.6, 2),
        alive: e.alive,
        stuck: e.stuckFor ?? 0,
        waypoint: { x: e.svX, z: e.svZ },
      };
    });
    samples.push({ ...sample, second: t + 1 });
    console.log(t + 1, JSON.stringify(sample));
    if (sample.stuck > 12 && !process.env.EXPECT_FAILURE) break;
    if (sample.d < 1.5) {
      reached = true;
      break;
    }
  }
  await page.screenshot({ path: `${out}/player-view.png` });
  const report = { fixture, reached, samples, errors };
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  if (!process.env.EXPECT_FAILURE)
    assert.ok(reached, "actual Game enemy converges through the fence route");
  assert.deepEqual(errors, []);
  assert.ok(
    samples.every((s) => !s.collision),
    "all sampled full body positions clear",
  );
  for (let i = 1; i < samples.length; i++)
    assert.ok(
      Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z) < 2,
      "no recovery teleport",
    );
} finally {
  await browser.close();
}
