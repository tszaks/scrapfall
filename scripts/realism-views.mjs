// Matched player-eye evidence. Debug warps select views; keyboard playtests are separate.
import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
const out = process.env.OUT || "output/playwright/views";
const tag = process.env.TAG || "before";
const base = process.env.BASE || "http://127.0.0.1:5286";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const report = [];
try {
  for (const map of (process.env.MAPS || "vice,pier,whiteout,gulch").split(",")) {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto(
      `${base}/game/?map=${map}&seed=7&time=${process.env.TIME || "sunset"}&weather=${process.env.WEATHER || "sunny"}&tour=1&debug=1&quality=high`,
    );
    await page.getByRole("button", { name: /^start$/i }).click({ timeout: 90000 });
    await page.getByRole("button", { name: /enter arena/i }).click();
    await page.waitForFunction(() => window.__rs?.camera, null, { timeout: 120000 });
    await page.waitForTimeout(3500);
    const poses = await page.evaluate((map) => {
      const r = __rs,
        p = r.camera.position;
      const poses = [
        { name: "street", x: p.x, z: p.z, y: r.groundAt(p.x, p.z), yaw: 0, pitch: 0 },
        {
          name: "street-side",
          x: p.x,
          z: p.z,
          y: r.groundAt(p.x, p.z),
          yaw: Math.PI / 2,
          pitch: 0,
        },
      ];
      // Deterministic random walkable views, kept even when unflattering.
      let seed = 841;
      const rand = () => ((seed = Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
      for (let i = 0; i < 3; i++)
        for (let trial = 0; trial < 100; trial++) {
          const x = p.x + (rand() - 0.5) * 80,
            z = p.z + (rand() - 0.5) * 80,
            y = r.groundAt(x, z);
          if (Number.isFinite(y) && !r.bodyAt(x, z, y)) {
            poses.push({ name: `random-${i}`, x, z, y, yaw: rand() * Math.PI * 2, pitch: 0 });
            break;
          }
        }
      if (map === "vice") {
        const b = r.access.list().find((b) => b.stair && !b.stair.spiral);
        if (b) {
          const a = -(b.stair.W / 2 + 0.1) / 2,
            d = b.stair.v0 + b.stair.Ls * 0.5;
          poses.push({
            name: "stairwell",
            x: b.ox + b.tx * a + b.ix * d,
            z: b.oz + b.tz * a + b.iz * d,
            y: b.groundY,
            yaw: Math.atan2(-b.ix, -b.iz),
            pitch: 0.03,
            building: b.id,
          });
        }
      }
      return poses;
    }, map);
    const posePath = `${out}/${map}-poses.json`;
    const matched = tag === "before" ? poses : JSON.parse(await readFile(posePath, "utf8"));
    if (tag === "before") await writeFile(posePath, JSON.stringify(poses, null, 2));
    for (const pose of matched) {
      await page.evaluate((p) => {
        const r = __rs;
        r.playtest.warp(p.x, p.y, p.z);
        r.look.current.yaw = p.yaw;
        r.look.current.pitch = p.pitch;
        if (p.building !== undefined)
          Object.assign(r.access.player, {
            zone: 1,
            b: p.building,
            lap: 0,
            region: 0,
            level: 0,
            inCar: false,
            y: p.y,
          });
      }, pose);
      await page.waitForTimeout(800);
      const actual = await page.evaluate(() => ({
        position: __rs.camera.position.toArray(),
        look: __rs.look.current,
        quality: window.__rsQuality,
      }));
      await page.screenshot({ path: `${out}/${tag}-${map}-${pose.name}.png` });
      report.push({ map, pose, actual, errors: [...errors] });
    }
    await page.close();
    console.log(`${tag} ${map}: ${matched.length} matched views`);
  }
  await writeFile(`${out}/${tag}.json`, JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
if (report.some((r) => r.errors.length)) process.exitCode = 1;
