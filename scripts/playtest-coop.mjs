import { chromium } from "playwright";
import fs from "node:fs";
const base = process.env.BASE ?? "http://127.0.0.1:4173";
const out = process.env.OUT ?? "/tmp/scrapfall-coop-check.json";
const b = await chromium.launch({
  args:
    process.platform === "darwin"
      ? ["--use-angle=metal"]
      : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const c = await b.newContext({ viewport: { width: 900, height: 650 } });
const h = await c.newPage(),
  g = await c.newPage();
const errors = [];
for (const p of [h, g]) p.on("pageerror", (e) => errors.push(e.message));
try {
  for (const p of [h, g]) await p.goto(`${base}/game/?map=whiteout&seed=7&debug=1&quality=low`);
  await h.getByRole("button", { name: "HOST A ROOM" }).click({ timeout: 120000 });
  await h.getByRole("button", { name: /TAP TO COPY/ }).waitFor({ timeout: 45000 });
  const code = (await h.getByRole("button", { name: /TAP TO COPY/ }).innerText())
    .trim()
    .slice(0, 4);
  console.log("room opened");
  await g.getByRole("textbox", { name: "Room code" }).fill(code);
  await g.getByRole("button", { name: /^JOIN$/ }).click();
  await g.getByRole("button", { name: /READY UP/ }).waitFor({ timeout: 45000 });
  await g.getByRole("button", { name: /READY UP/ }).click();
  await h.getByRole("button", { name: /^Start$/ }).click();
  await h.getByRole("button", { name: /ENTER ARENA/i }).click({ timeout: 90000 });
  await Promise.all(
    [h, g].map((p) =>
      p.waitForFunction(
        () => window.__rs?.net?.current?.peers().length && __rs?.wave?.current >= 1,
        null,
        { timeout: 120000 },
      ),
    ),
  );
  console.log("both in game");
  await Promise.all(
    [h, g].map((p) =>
      p.waitForFunction(() => __rs.enemies.filter((e) => e.alive).length >= 3, null, {
        timeout: 90000,
      }),
    ),
  );
  const before = await Promise.all(
    [h, g].map((p) =>
      p.evaluate(() => ({
        wave: __rs.wave.current,
        role: __rs.net.current.role,
        alive: __rs.enemies.filter((e) => e.alive).length,
      })),
    ),
  );
  await h.close();
  await g.waitForFunction(() => __rs.net.current.role === "host", null, { timeout: 60000 });
  const after = await g.evaluate(() => ({
    wave: __rs.wave.current,
    role: __rs.net.current.role,
    alive: __rs.enemies.filter((e) => e.alive).length,
    hp: __rs.enemies.filter((e) => e.alive).map((e) => e.hp),
  }));
  const rejoin = await c.newPage();
  rejoin.on("pageerror", (e) => errors.push(e.message));
  await rejoin.goto(`${base}/game/?seed=7&debug=1&quality=low`);
  await rejoin.getByRole("textbox", { name: "Room code" }).fill(code);
  await rejoin.getByRole("button", { name: /^JOIN$/ }).click();
  await rejoin.waitForFunction(
    () => window.__rs?.net?.current?.role === "guest" && __rs.wave.current >= 1,
    null,
    { timeout: 120000 },
  );
  const joined = await rejoin.evaluate(() => ({
    wave: __rs.wave.current,
    role: __rs.net.current.role,
  }));
  fs.writeFileSync(out, JSON.stringify({ before, after, joined, errors }, null, 2));
  console.log("host transferred");
} catch (e) {
  console.log("FAIL", e.message);
  if (!h.isClosed()) console.log("HOST", (await h.locator("body").innerText()).slice(-2000));
  console.log("GUEST", (await g.locator("body").innerText()).slice(-2000));
  process.exitCode = 1;
} finally {
  await b.close();
}
