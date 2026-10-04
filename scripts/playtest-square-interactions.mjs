import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.BASE ?? "http://127.0.0.1:5292",
  out = process.env.OUT ?? "output/square-interactions";
await mkdir(out, { recursive: true });
const b = await chromium.launch({ args: ["--use-angle=metal"] }),
  p = await b.newPage({ viewport: { width: 1280, height: 800 } }),
  report = { errors: [], checks: [] };
p.on("pageerror", (e) => report.errors.push(e.message));
try {
  await p.goto(`${base}/game/?map=whiteout&seed=11&debug=1&padshim=ps&tour=1`);
  await p.getByRole("button", { name: /^start$/i }).click({ timeout: 120000 });
  await p.getByRole("button", { name: /enter arena/i }).click({ timeout: 120000 });
  await p.waitForFunction(() => window.__rs?.city?.alpine && window.__pad);
  await p.waitForTimeout(500);
  for (const name of ["blue", "red"]) {
    await p.evaluate((name) => {
      const r = __rs,
        t = r.playtest,
        path = r.city.alpine.paths.find((p) => p.kind === "piste" && p.name === name),
        [x, z] = path.pts[0];
      __pad.reset();
      t.resetSki();
      t.warp(x, r.groundAt(x, z), z);
    }, name);
    await p.waitForTimeout(250);
    await p.evaluate(() => __pad.tap(2, 100));
    await p.waitForTimeout(200);
    const s = await p.evaluate(() => ({
      active: __rs.playtest.ski.active,
      name: __rs.playtest.ski.name,
      remaining: __rs.playtest.supply.remaining,
      hint: document.querySelector('[data-testid="travel-hint"]')?.innerText,
    }));
    report.checks.push(s);
    assert.equal(s.active, true);
    assert.equal(s.name, name);
    assert.equal(s.remaining, 0);
    await p.screenshot({ path: `${out}/${name}-square-start.png` });
  }
  assert.deepEqual(report.errors, []);
} catch (e) {
  report.failure = e.stack;
  process.exitCode = 1;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await b.close();
}
console.log(JSON.stringify(report));
