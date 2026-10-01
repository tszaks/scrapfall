import assert from "node:assert/strict";
import fs from "node:fs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const b = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}),
});
const ctx = await b.newContext({ viewport: { width: 1000, height: 700 } }),
  host = await ctx.newPage(),
  guest = await ctx.newPage();
// Two clients use keyboard fallback so pointer capture in one page cannot pause the other.
await ctx.addInitScript(() => {
  HTMLElement.prototype.requestPointerLock = () => Promise.resolve();
});
const report = { errors: [], checks: [] };
const out = process.env.OUT || "artifacts/performance";
fs.mkdirSync(out, { recursive: true });
for (const p of [host, guest]) p.on("pageerror", (e) => report.errors.push(e.message));
const ready = (p) =>
  p.waitForFunction(
    () => window.__rsWarm?.length && !document.body.innerText.includes("PREPARING ARENA"),
    null,
    { timeout: 45000 },
  );
let roomCode;
const join = async () => {
  roomCode ??= await host.locator("div.tracking-\\[0\\.4em\\]").innerText();
  const code = roomCode;
  await guest.getByPlaceholder("CODE").fill(code);
  await guest.getByRole("button", { name: "JOIN", exact: true }).click();
  await guest.waitForFunction(() => document.body.innerText.includes("JOINED ROOM"), null, {
    timeout: 30000,
  });
};
try {
  for (const p of [host, guest]) {
    await p.goto(`${process.env.BASE || "http://127.0.0.1:4173"}/game/?debug=1&map=vice&seed=11`);
    await ready(p);
  }
  await host.getByRole("button", { name: "HOST", exact: true }).click();
  await host.waitForFunction(() => document.body.innerText.includes("HOSTING ROOM"), null, {
    timeout: 30000,
  });
  await join();
  await host.getByRole("button", { name: "START", exact: true }).click();
  await host.getByRole("button", { name: "ENTER ARENA", exact: true }).click();
  for (const p of [host, guest]) {
    await ready(p);
    await p.waitForFunction(() => __rs.enemies.some((e) => e.alive), null, { timeout: 30000 });
    await p.evaluate(() => (__rs.invuln.current = 1e6));
  }
  const worlds = await Promise.all(
    [host, guest].map((p) =>
      p.evaluate(() => ({
        theme: document.body.innerText.split("\n")[0],
        wave: document.body.innerText.match(/WAVE\s+(\d+)/)?.[1],
        remotes: __rs.remotes.current.size,
      })),
    ),
  );
  assert.equal(worlds[0].theme, worlds[1].theme);
  assert.ok(worlds.every((w) => Number(w.wave) > 0));
  report.checks.push({ start: worlds });
  await host.keyboard.press("p");
  for (const p of [host, guest])
    await p.getByRole("button", { name: "RESUME", exact: true }).waitFor();
  await host.getByRole("button", { name: "RESUME", exact: true }).click();
  await guest.waitForFunction(
    () => !Array.from(document.querySelectorAll("button")).some((b) => b.textContent === "RESUME"),
  );
  report.checks.push("synchronized pause/resume");
  // Accelerate to the last-wave death path; normal damage and the wave director
  // must leave victory stable across subsequent animation frames.
  await host.evaluate(() => {
    __rs.wave.current = 12;
    __rs.enemies.forEach((e, i) => {
      if (e.alive) __rs.hurtEnemy(e, 100000, i);
    });
    __rs.pending.current.fill(null);
  });
  const restartAt = Date.now();
  await host.getByRole("button", { name: "NEW ARENA", exact: true }).click();
  await host.getByRole("button", { name: "ENTER ARENA", exact: true }).click();
  for (const p of [host, guest]) {
    await ready(p);
    await p.waitForFunction(() => __rs.enemies.some((e) => e.alive), null, { timeout: 30000 });
  }
  report.checks.push({
    restart: "host starts a new arena and both worlds resume",
    elapsedMs: Date.now() - restartAt,
  });
  await guest.keyboard.press("p");
  await guest.getByRole("button", { name: "LEAVE ROOM", exact: true }).click();
  await guest.getByPlaceholder("CODE").waitFor();
  // The host remains paused after a guest leaves; reconnect uses the saved room code.
  await join();
  await ready(guest);
  await host.getByRole("button", { name: "RESUME", exact: true }).click();
  await guest.waitForFunction(
    () => __rs.remotes.current.size > 0 && !document.body.innerText.includes("RESUME"),
  );
  report.checks.push("guest reconnect and synchronized resume");
  assert.deepEqual(report.errors, []);
} catch (e) {
  report.failure = e.stack;
  report.hud = await Promise.all(
    [host, guest].map((p) =>
      p
        .locator("body")
        .innerText()
        .catch(() => "unavailable"),
    ),
  );
  process.exitCode = 1;
} finally {
  fs.writeFileSync(`${out}/coop.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await b.close();
}
