import { chromium } from "playwright";
import fs from "node:fs/promises";
const root = process.env.OUT || "/tmp/scrapfall-environment-audit";
await fs.mkdir(root, { recursive: true });
const b = await chromium.launch({
  args: [
    "--use-angle=metal",
    "--ignore-gpu-blocklist",
    "--disable-gpu-vsync",
    "--disable-frame-rate-limit",
  ],
});
const rows = [];
for (const map of (process.env.MAPS || "vice,gulch,pier,whiteout").split(","))
  for (const time of (process.env.TIMES || "sunset,night").split(","))
    for (const version of (process.env.VERSIONS || "before,after").split(",")) {
      const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
      const row = { map, time, version, throttle: process.env.THROTTLE || 1, errors: [] };
      rows.push(row);
      p.on("pageerror", (e) => row.errors.push(e.message));
      p.on("console", (m) => {
        if (m.type() === "error") row.errors.push(m.text().slice(0, 1000));
      });
      await p.addInitScript(() => {
        const raf = window.requestAnimationFrame.bind(window);
        window.__costs = [];
        window.__measure = false;
        window.requestAnimationFrame = (cb) =>
          raf((t) => {
            const s = performance.now();
            cb(t);
            if (window.__measure) window.__costs.push(performance.now() - s);
          });
      });
      if (process.env.THROTTLE) {
        const c = await p.context().newCDPSession(p);
        await c.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.THROTTLE) });
      }
      await p.goto(
        `${version === "before" ? process.env.BASELINE_URL || "http://127.0.0.1:5188" : process.env.CANDIDATE_URL || "http://127.0.0.1:5186"}/game/?map=${map}&seed=7&time=${time}&tour=1&debug=1&quality=high`,
      );
      await p
        .getByRole("button", { name: /^start$/i })
        .first()
        .click({ timeout: 120000 });
      await p
        .getByRole("button", { name: /enter arena/i })
        .first()
        .click({ timeout: 120000 });
      await p.waitForFunction(() => window.__rs?.camera, null, { timeout: 120000 });
      await p.waitForTimeout(6000);
      row.views = await p.evaluate(() => {
        const r = window.__rs,
          origin = r.camera.position;
        let seed = 19473;
        const rand = () => ((seed = Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
        const views = [];
        for (let i = 0; i < 200 && views.length < 3; i++) {
          const x = origin.x + (rand() - 0.5) * 180,
            z = origin.z + (rand() - 0.5) * 180,
            y = r.groundAt(x, z);
          if (!Number.isFinite(y) || r.bodyAt(x, z, y) || r.blockedAt(x, z)) continue;
          views.push({ x, y, z, yaw: rand() * Math.PI * 2 });
        }
        return views;
      });
      for (let i = 0; i < row.views.length; i++) {
        await p.evaluate((v) => {
          const r = window.__rs;
          r.playtest.warp(v.x, v.y, v.z);
          r.look.current.yaw = v.yaw;
          r.look.current.pitch = -0.05;
        }, row.views[i]);
        await p.waitForTimeout(600);
        if (!process.env.THROTTLE)
          await p.screenshot({ path: `${root}/${map}-${time}-${version}-${i}.png` });
      }
      row.metrics = await p.evaluate(async () => {
        const r = window.__rs;
        window.__costs = [];
        window.__measure = true;
        let previous = performance.now(),
          start = previous;
        const frames = [],
          calls = [],
          triangles = [];
        const autoReset = r.gl.info.autoReset;
        r.gl.info.autoReset = false;
        r.gl.info.reset();
        await new Promise((done) => {
          const tick = () => {
            const t = performance.now();
            frames.push(t - previous);
            previous = t;
            calls.push(r.gl.info.render.calls);
            triangles.push(r.gl.info.render.triangles);
            r.gl.info.reset();
            if (t - start < 8000) requestAnimationFrame(tick);
            else done();
          };
          requestAnimationFrame(tick);
        });
        window.__measure = false;
        r.gl.info.autoReset = autoReset;
        const sorted = frames.slice().sort((a, b) => a - b),
          cpu = window.__costs.slice().sort((a, b) => a - b);
        const q = (a, p) => a[Math.floor((a.length - 1) * p)];
        return {
          frames: frames.length,
          p95: q(sorted, 0.95),
          p99: q(sorted, 0.99),
          over25: frames.filter((x) => x > 25).length,
          over50: frames.filter((x) => x > 50).length,
          cpuMean: cpu.reduce((a, b) => a + b, 0) / cpu.length,
          cpuPerFrame: cpu.reduce((a, b) => a + b, 0) / frames.length,
          callbackCount: cpu.length,
          cpuP95: q(cpu, 0.95),
          calls: Math.max(...calls),
          triangles: Math.max(...triangles),
        };
      });
      console.log(JSON.stringify(row));
      await fs.writeFile(
        `${root}/report-${process.env.TAG || "final"}-${process.env.THROTTLE || 1}.json`,
        JSON.stringify(rows, null, 2),
      );
      await p.close();
    }
await b.close();
if (rows.some((row) => row.errors.length)) process.exit(1);
