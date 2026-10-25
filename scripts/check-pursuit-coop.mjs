import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const out = "output/enemy-pursuit-coop";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=metal"] });
const context = await browser.newContext({ viewport: { width: 900, height: 650 } }),
  host = await context.newPage(),
  guest = await context.newPage(),
  errors = [];
for (const p of [host, guest]) p.on("pageerror", (e) => errors.push(e.message));
try {
  for (const p of [host, guest])
    await p.goto("http://localhost:5321/game/?map=gulch&seed=7&debug=1&quality=low");
  await host.getByRole("button", { name: "HOST A ROOM" }).click({ timeout: 120000 });
  const copy = host.getByRole("button", { name: /TAP TO COPY/ });
  await copy.waitFor({ timeout: 45000 });
  const code = (await copy.innerText()).trim().slice(0, 4);
  await guest.getByRole("textbox", { name: "Room code" }).fill(code);
  await guest.getByRole("button", { name: /^JOIN$/ }).click();
  await guest.getByRole("button", { name: /READY UP/ }).click({ timeout: 45000 });
  await host.getByRole("button", { name: /^Start$/ }).click();
  await host.getByRole("button", { name: /ENTER ARENA/i }).click({ timeout: 90000 });
  await Promise.all(
    [host, guest].map((p) =>
      p.waitForFunction(
        () => window.__rs?.net.current?.peers().length && __rs.enemies.some((e) => e.alive),
        null,
        { timeout: 120000 },
      ),
    ),
  );
  const corridor = await host.evaluate(() => {
    const s = __rs;
    for (let x = -30; x <= 30; x += 2)
      for (let z = -60; z <= 30; z += 10) {
        let valid = true;
        for (let dz = -14; dz <= 30; dz += 0.5)
          if (
            s.enemyBodyAt(x, z + dz, 0.6, 2) ||
            Math.abs(s.groundAt(x, z + dz) - s.groundAt(x, z)) > 0.4
          ) {
            valid = false;
            break;
          }
        if (valid) {
          s.playtest.warp(x, s.groundAt(x, z - 10), z - 10);
          s.invuln.current = 1e6;
          return { x, z };
        }
      }
    throw Error("No clear co-op pursuit corridor");
  });
  await guest.evaluate(({ x, z }) => {
    __rs.playtest.warp(x, __rs.groundAt(x, z + 10), z + 10);
    __rs.invuln.current = 1e6;
  }, corridor);
  await host.waitForTimeout(1000);
  await host.evaluate(({ x, z }) => {
    const s = __rs;
    s.enemies.forEach((e) => (e.alive = false));
    s.pending.current.fill(null);
    s.nextWaveTimer.current = 1e6;
    Object.assign(s.enemies[0], {
      kind: "drifter",
      alive: true,
      hp: 100,
      max: 100,
      x,
      z: z + 4,
      slow: 0,
      frozen: 0,
      burn: 0,
      swing: 0,
      svT: 0,
      lastX: undefined,
      lastZ: undefined,
      stuckFor: 0,
    });
  }, corridor);
  const read = () =>
    host.evaluate(() => {
      const e = __rs.enemies[0];
      return {
        x: e.x,
        z: e.z,
        host: { x: __rs.camera.position.x, z: __rs.camera.position.z },
        guests: [...__rs.remotes.current.values()].map((r) => ({ x: r.x, z: r.z, hp: r.hp })),
        blocked: __rs.enemyBodyAt(e.x, e.z, 0.6, 2),
      };
    });
  const start = await read();
  await host.waitForTimeout(2000);
  const chasingGuest = await read();
  assert.ok(chasingGuest.z > start.z + 1, "host AI pursues closer guest");
  await guest.evaluate(
    ({ x, z }) => __rs.playtest.warp(x, __rs.groundAt(x, z + 30), z + 30),
    corridor,
  );
  await host.waitForTimeout(7000);
  const chasingHost = await read();
  assert.ok(chasingHost.z < chasingGuest.z - 3, "host AI retargets host after guest moves away");
  const guestMirror = await guest.evaluate(() => ({ x: __rs.enemies[0].x, z: __rs.enemies[0].z }));
  assert.ok(
    Math.hypot(guestMirror.x - chasingHost.x, guestMirror.z - chasingHost.z) < 1,
    "guest mirrors host-authoritative enemy",
  );
  assert.deepEqual(errors, []);
  assert.ok(!start.blocked && !chasingGuest.blocked && !chasingHost.blocked);
  const result = { corridor, start, chasingGuest, chasingHost, guestMirror, errors };
  console.log(JSON.stringify(result));
  await writeFile(`${out}/report.json`, JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
