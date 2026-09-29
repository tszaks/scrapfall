// Repeatable no-jump entry/exit audit against an already running static build.
// npm run build && npm run serve:static (separate terminal), then:
// node scripts/audit-pier-alpine-doors.mjs
// PORT, OUT, TAG, SEEDS, MAPS, PICK, OFFSETS, WEATHER, ENGINE=webkit, SHOTS=0 and WATER=0 narrow a replay.
// Placement only sets each outside starting pose; every crossing uses real keyboard input.
import fs from "node:fs";
import { chromium, webkit } from "playwright";
import os from "node:os";
import path from "node:path";
const launch = () =>
  process.env.ENGINE === "webkit"
    ? webkit.launch({ headless: true })
    : chromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
        channel: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? undefined : "chromium",
        args:
          process.platform === "darwin"
            ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"]
            : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
      });
async function startGame(p) {
  await p.getByRole("button", { name: /^start$/i }).click({ timeout: 120000 });
  await p.getByRole("button", { name: /enter arena/i }).click({ timeout: 30000 });
}
async function face(p, x, z, pitch = 0) {
  await p.evaluate(
    ({ x, z, pitch }) => {
      const c = __rs.camera.position;
      __rs.look.current.yaw = Math.atan2(-(x - c.x), -(z - c.z));
      __rs.look.current.pitch = pitch;
    },
    { x, z, pitch },
  );
}
// Genuine KeyW input, diagnostic per-frame look steering and threshold key release.
// This avoids Node/browser transport latency continuing past a narrow landing.
async function walkTo(p, x, z, tol = 0.25, maxMs = 12000) {
  await p.evaluate(
    ({ x, z, tol, maxMs }) => {
      const r = __rs,
        t = { x, z, tol, start: performance.now(), maxMs, done: false, reached: false };
      window.__qaWalk = t;
      const tick = () => {
        if (t.done) return;
        const c = r.camera.position,
          d = Math.hypot(x - c.x, z - c.z);
        t.distance = d;
        r.look.current.yaw = Math.atan2(-(x - c.x), -(z - c.z));
        if (d < tol || performance.now() - t.start > maxMs) {
          t.done = true;
          t.reached = d < tol;
          r.keys.current.delete("KeyW");
          return;
        }
        requestAnimationFrame(tick);
      };
      tick();
    },
    { x, z, tol, maxMs },
  );
  await p.keyboard.down("KeyW");
  try {
    await p.waitForFunction(() => window.__qaWalk?.done, null, {
      timeout: maxMs + 10000,
      polling: "raf",
    });
    return await p.evaluate(() => window.__qaWalk.reached);
  } finally {
    await p.keyboard.up("KeyW");
    await p.evaluate(() => {
      __rs.keys.current.delete("KeyW");
      if (window.__qaWalk) __qaWalk.done = true;
    });
    await p.waitForTimeout(60);
  }
}

const OUT = process.env.OUT || path.join(os.tmpdir(), "scrapfall-door-audit"),
  tag = process.env.TAG || String(Date.now()),
  port = process.env.PORT || 4173;
fs.mkdirSync(OUT, { recursive: true });
const seeds = (process.env.SEEDS || "1,4,7,11,42").split(",").map(Number),
  maps = (process.env.MAPS || "pacific,whiteout").split(","),
  pick = process.env.PICK ? new RegExp(process.env.PICK) : null;
const report = {
  tag,
  engine: process.env.ENGINE || "chromium",
  port,
  started: Date.now(),
  cases: [],
  errors: [],
  inventories: [],
  note: "Diagnostic placement outside each door at actual ground height; KeyW crossing and return, no jump key. Per-frame look steering only. Combat is isolated with invulnerability and frozen enemies.",
};
const save = () => fs.writeFileSync(`${OUT}/${tag}.json`, JSON.stringify(report, null, 2));
const browser = await launch();
const sample = (p) =>
  p.evaluate(() => ({
    eye: __rs.camera.position.toArray(),
    feet: __controls.moveState.feet,
    airborne: __controls.moveState.airborne,
    vy: __controls.moveState.vy,
    access: { ...__rs.access.player },
    structure: { ...__rs.structures.player },
    lost: __rs.gl.getContext().isContextLost(),
    paused: /RESUME/.test(document.body.innerText),
    dead: /YOU GOT SWARMED/.test(document.body.innerText) || __rs.healthRef.current <= 0,
  }));
async function place(p, x, z) {
  await p.evaluate(
    ({ x, z }) => {
      const r = __rs,
        g = r.groundAt(x, z);
      Object.assign(__controls.moveState, {
        feet: g,
        airborne: false,
        vy: 0,
        lift: 0,
        fallTop: g,
        landed: -1,
        dip: 0,
      });
      Object.assign(r.access.player, {
        zone: 0,
        b: -1,
        y: g,
        level: 0,
        inCar: false,
        lap: 0,
        region: 0,
        climb: 0,
      });
      r.camera.position.set(x, g + 1.6, z);
      r.look.current.pitch = 0;
      r.look.current.yaw = 0;
      r.knock.current.x = r.knock.current.z = 0;
      r.keys.current.clear();
    },
    { x, z },
  );
  await p.waitForTimeout(400);
}
try {
  for (const map of maps)
    for (const seed of seeds) {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      });
      const p = await ctx.newPage();
      p.setDefaultTimeout(120000);
      p.on("pageerror", (e) => {
        report.errors.push({ map, seed, type: "page", message: e.message });
        save();
      });
      p.on("console", (m) => {
        if (m.type() === "error") {
          report.errors.push({ map, seed, type: "console", message: m.text() });
          save();
        }
      });
      await p.goto(
        `http://127.0.0.1:${port}/game/?debug=1&quality=high&map=${map}&seed=${seed}&weather=${process.env.WEATHER || "sunset"}`,
        { timeout: 120000 },
      );
      await startGame(p);
      await p.waitForFunction(() => !!window.__rs?.structures && !!window.__controls);
      await p.evaluate(() => {
        const quiet = () => {
          const r = __rs;
          r.invuln.current = 1e9;
          r.enemies.forEach((e, i) => {
            e.alive = i === 0;
            if (i === 0) {
              e.x = 2000;
              e.z = 2000;
              e.hp = 999;
              e.frozen = 999;
            }
          });
          r.pending.current.fill(null);
          r.nextWaveTimer.current = 999;
        };
        quiet();
        window.__doorQuiet = setInterval(quiet, 60);
      });
      await p.waitForTimeout(1500);
      const inv = await p.evaluate(() =>
        JSON.parse(
          JSON.stringify(
            {
              plans: __rs.structures.list(),
              access: __rs.access.list(),
              assets: performance
                .getEntriesByType("resource")
                .filter((e) => /\/assets\/routes-/.test(e.name))
                .map((e) => e.name),
            },
            (k, v) => (k === "interior" ? undefined : v),
          ),
        ),
      );
      report.inventories.push({ map, seed, ...inv });
      save();
      if (inv.plans.length < 7 || !inv.access.some((b) => b.kind !== "ladder"))
        throw Error("Expected walkable rooms/access entrances are missing");
      const requiredRooms =
        map === "pacific"
          ? ["pier-arcade--76--30", ...(seed === 4 ? ["pier-surf-150--40"] : [])]
          : ["alpine-grand-west-lobby", ...(seed === 11 ? ["alpine-cafe--34-12"] : [])];
      for (const id of requiredRooms)
        if (!inv.plans.some((p) => p.id === id)) throw Error(`Missing reported room: ${id}`);
      if (map === "whiteout")
        for (const name of ["church-tower", "grand-hotel"])
          if (!inv.access.some((b) => b.spec.name === name))
            throw Error(`Missing entrance: ${name}`);
      const doors = [];
      for (const plan of inv.plans)
        for (const [i, d] of plan.doors.entries()) {
          const n = [
            [0, 1],
            [-1, 0],
            [0, -1],
            [1, 0],
          ][d.facing];
          doors.push({ id: plan.id + "-" + i, x: d.x, z: d.z, n, y: plan.base, type: "ordinary" });
        }
      for (const b of inv.access)
        if (b.kind !== "ladder") {
          doors.push({
            id: "access-" + b.spec.name,
            x: b.ox,
            z: b.oz,
            n: [b.ix, b.iz],
            y: b.groundY,
            type: "access",
          });
        }
      for (const d of doors)
        for (const offset of (process.env.OFFSETS || "-0.2,0,0.2").split(",").map(Number)) {
          if (pick && !pick.test(d.id)) continue;
          const x = d.x + d.n[1] * offset,
            z = d.z - d.n[0] * offset;
          const start = [x - d.n[0] * 3.5, z - d.n[1] * 3.5],
            end = [x + d.n[0] * 1.1, z + d.n[1] * 1.1];
          const row = { map, seed, ...d, offset, start, end, moves: [], pass: false };
          report.cases.push(row);
          save();
          try {
            await place(p, ...start);
            await face(p, d.x, d.z, 0);
            row.before = await sample(p);
            const safe = (map + "-" + seed + "-" + d.id + "-" + offset).replace(/[^\w-]/g, "_");
            if (process.env.SHOTS !== "0") {
              row.beforeShot = `${OUT}/${tag}-${safe}-before.png`;
              await p.screenshot({ path: row.beforeShot });
            }
            await p.evaluate(() => {
              window.__doorSamples = [];
              window.__doorSampling = true;
              const f = () => {
                if (!window.__doorSampling) return;
                const s = __controls.moveState;
                __doorSamples.push({
                  eye: __rs.camera.position.toArray(),
                  feet: s.feet,
                  vy: s.vy,
                  airborne: s.airborne,
                  jump: __rs.keys.current.has("Space"),
                });
                requestAnimationFrame(f);
              };
              f();
            });
            for (const [label, target] of [
              ["enter", end],
              ["exit", start],
            ]) {
              const reached = await walkTo(p, ...target, 0.18, 6000);
              const after = await sample(p);
              row.moves.push({ label, target, reached, after });
              if (!reached || after.paused || after.lost || after.dead)
                throw Error(label + " blocked");
              if (label === "enter" && Math.abs(after.feet - d.y) > 0.3)
                throw Error("wrong floor height");
            }
            row.pass = true;
          } catch (e) {
            row.error = String(e);
            console.log(map, seed, d.id, row.error);
          } finally {
            row.final = await sample(p);
            row.samples = await p.evaluate(() => {
              window.__doorSampling = false;
              return window.__doorSamples || [];
            });
            if (row.samples.some((s) => s.jump)) {
              row.pass = false;
              row.error = "Jump input detected";
            }
            if (!row.pass || process.env.SHOTS !== "0") {
              row.afterShot = `${OUT}/${tag}-${(map + "-" + seed + "-" + d.id + "-" + offset).replace(/[^\w-]/g, "_")}-after.png`;
              await p.screenshot({ path: row.afterShot });
            }
            save();
            console.log(
              JSON.stringify({
                map,
                seed,
                id: d.id,
                pass: row.pass,
                moves: row.moves.map((m) => ({
                  label: m.label,
                  reached: m.reached,
                  eye: m.after.eye,
                })),
              }),
            );
          }
        }
      if (map === "pacific" && process.env.WATER !== "0") {
        const row = { map, seed, id: "wading-boundary", moves: [], pass: false };
        report.cases.push(row);
        try {
          const line = await p.evaluate(() => __rs.city.seaX);
          if (!Number.isFinite(line)) throw Error("Missing swim boundary");
          row.line = line;
          await place(p, line + 4, 120);
          await face(p, line - 8, 120);
          const crossed = await walkTo(p, line - 8, 120, 0.2, 2000);
          const edge = await sample(p);
          row.edge = edge;
          if (crossed || edge.eye[0] < line || edge.eye[0] > line + 1.2)
            throw Error("Deep-water boundary moved or is inaccessible");
          const along = await walkTo(p, edge.eye[0] + 0.15, 128, 0.25, 6000);
          row.along = await sample(p);
          if (!along) throw Error("Cannot walk beside swim line");
          await face(p, line, 135, -0.1);
          row.shot = `${OUT}/${tag}-${map}-${seed}-water.png`;
          await p.screenshot({ path: row.shot });
          row.pass = true;
        } catch (e) {
          row.error = String(e);
        }
        save();
        console.log(JSON.stringify({ map, seed, id: row.id, pass: row.pass, error: row.error }));
      }
      await ctx.close();
    }
} catch (e) {
  report.fatal = String(e.stack || e);
  console.error(report.fatal);
} finally {
  await browser.close();
  report.closed = true;
  report.finished = Date.now();
  report.pass =
    !report.fatal &&
    !report.errors.length &&
    report.cases.length > 0 &&
    report.cases.every((c) => c.pass);
  save();
  if (!report.pass) process.exitCode = 1;
}
