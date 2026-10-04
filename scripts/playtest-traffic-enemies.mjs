import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.BASE ?? "http://127.0.0.1:5292",
  out = process.env.OUT ?? "output/playwright/traffic-enemies";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  args:
    process.platform === "darwin"
      ? ["--use-angle=metal"]
      : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }),
  report = { base, errors: [] };
page.on("pageerror", (e) => report.errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") report.errors.push(m.text());
});
try {
  await page.goto(`${base}/game/?map=vice&seed=11&debug=1`);
  await page.getByRole("button", { name: /^start$/i }).click({ timeout: 120000 });
  await page.getByRole("button", { name: /enter arena/i }).click({ timeout: 120000 });
  await page.waitForFunction(() => window.__rs?.camera && window.__rsCars);
  await page.evaluate(() => {
    window.trafficHits = [];
    const L = __rs.traffic.current;
    let handler = L.hurtEnemy;
    Object.defineProperty(L, "hurtEnemy", {
      configurable: true,
      get() {
        return handler
          ? function (i, dmg, kx, kz) {
              const e = __rs.enemies[i],
                before = { hp: e.hp, alive: e.alive, x: e.x, z: e.z };
              handler(i, dmg, kx, kz);
              trafficHits.push({
                dmg,
                before,
                after: { hp: e.hp, alive: e.alive, x: e.x, z: e.z },
                active: L.active,
              });
            }
          : null;
      },
      set(fn) {
        handler = fn;
      },
    });
  });
  // First observe an untouched long-distance wave; no attacks, warps, or spawning.
  report.natural = await page.evaluate(
    async (seconds) => {
      const samples = [],
        start = performance.now();
      while (performance.now() - start < seconds * 1000) {
        await new Promise((r) => setTimeout(r, 1000));
        const r = __rs,
          p = r.camera.position;
        samples.push({
          ms: performance.now() - start,
          wave: r.wave.current,
          hp: r.healthRef.current,
          shots: r.aimStats.current.shot,
          alive: r.enemies
            .filter((e) => e.alive)
            .map((e) => ({ hp: e.hp, d: Math.hypot(e.x - p.x, e.z - p.z) })),
          pending: r.pending.current.filter(Boolean).length,
          hits: trafficHits.length,
          kills: document.body.innerText.match(/KILLS\s+(\d+)/)?.[1],
        });
      }
      return samples;
    },
    Number(process.env.SECONDS ?? 240),
  );
  report.naturalHits = await page.evaluate(() => trafficHits);
  await page.screenshot({ path: `${out}/natural.png` });
  if (Number(process.env.SECONDS ?? 240) >= 60) {
    assert.ok(
      report.natural.some((s) => s.alive.length === 4),
      "natural wave creates four long-approach enemies",
    );
    assert.ok(
      report.natural.every((s) => s.wave <= 1 && s.shots === 0 && Number(s.kills) === 0),
      "traffic cannot clear or score an untouched wave",
    );
    assert.ok(
      report.natural
        .filter((s) => s.pending === 0 && s.alive.length > 0)
        .every((s) => s.alive.length === 4),
      "all first-wave robots survive ambient traffic",
    );
  }
  // Deliberately overlap one enemy with moving traffic to exercise unavoidable bumps.
  report.bump = await page.evaluate(async () => {
    const r = __rs,
      e = r.enemies.find((e) => e.alive),
      idx = r.enemies.indexOf(e),
      start = trafficHits.length;
    const c = __rsCars.find((c) => !c.driven && !c.park && c.role === 0 && c.speed > 5);
    if (!c || !e) throw new Error("fixture requires a moving ambient car and living enemy");
    e.x = c.x;
    e.z = c.z;
    e.hp = 2;
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { idx, hits: trafficHits.slice(start), hp: e.hp, alive: e.alive };
  });
  assert.ok(report.bump.hits.length > 0, "forced overlap exercises actual car contact");
  assert.ok(
    report.bump.hits.every((h) => h.dmg === 0 && h.after.hp === h.before.hp && h.after.alive),
    "bumps retain health and life",
  );
  assert.ok(
    report.bump.hits.some((h) => Math.hypot(h.after.x - h.before.x, h.after.z - h.before.z) > 0.01),
    "bump physically pushes robot",
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  report.pause = await page.evaluate(async () => {
    const r = __rs,
      e = r.enemies.find((e) => e.alive),
      c = __rsCars.find((c) => !c.driven && c.speed > 5),
      start = trafficHits.length;
    e.x = c.x;
    e.z = c.z;
    const p = { x: e.x, z: e.z, hp: e.hp };
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return {
      before: p,
      after: { x: e.x, z: e.z, hp: e.hp },
      hits: trafficHits.length - start,
      active: r.traffic.current.active,
    };
  });
  assert.equal(report.pause.active, false);
  assert.equal(report.pause.hits, 0);
  assert.deepEqual(report.pause.before, report.pause.after);
  await page.getByRole("button", { name: /resume/i }).click();
  // Controlled damage fixture uses the real player hit path, preserving the natural shop timer.
  await page.evaluate(() => {
    __rs.enemies.forEach((e, i) => {
      if (e.alive) __rs.hurtEnemy(e, 9999, i);
    });
  });
  await page.waitForFunction(() => __rs.wave.current === 2, null, { timeout: 45000 });
  report.combat = await page.evaluate(() => ({
    wave: __rs.wave.current,
    kills: document.body.innerText.match(/KILLS\s+(\d+)/)?.[1],
  }));
  assert.equal(Number(report.combat.kills), 4);
  assert.deepEqual(report.errors, []);
} catch (e) {
  report.failure = e.stack;
  process.exitCode = 1;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ ...report, natural: report.natural?.filter((_, i) => i % 30 === 0) }));
