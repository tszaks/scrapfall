import fs from "node:fs";
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
import { execFileSync } from "node:child_process";
// start a match on either menu: the old CLICK TO PLAY, or Scrapfall's START -> loadout -> ENTER ARENA
async function startGame(p) {
  const old = p.getByRole("button", { name: /CLICK TO PLAY/i });
  const start = p.getByRole("button", { name: /^start$/i });
  await p.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some((b) =>
        /CLICK TO PLAY|^start$/i.test(b.textContent.trim()),
      ),
    null,
    { timeout: 90000 },
  );
  if (await old.count()) {
    await old.first().click();
    return;
  }
  await start.first().click();
  const enter = p.getByRole("button", { name: /enter arena/i });
  await enter.waitFor({ timeout: 30000 });
  await enter.click();
}

const OUT = process.env.OUT || "artifacts/performance";
fs.mkdirSync(OUT, { recursive: true });
const engine = process.env.ENGINE || "chromium",
  maps = (process.env.MAPS || "vice").split(","),
  seconds = Number(process.env.SECONDS || 40),
  repeats = Number(process.env.REPEATS || 1);
const report = {
  engine,
  started: new Date().toISOString(),
  commit:
    process.env.COMMIT || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  viewport: [1280, 800],
  dpr: 2,
  quality: process.env.QUALITY || "high",
  extra: process.env.EXTRA || "",
  foliage: process.env.FOLIAGE === "1",
  fixedRoute: process.env.FIXED_ROUTE === "1",
  stationary: process.env.STATIONARY === "1",
  actualTrafficOccupants: true,
  weather: process.env.WEATHER || "rain",
  wave: Number(process.env.WAVE || 1),
  seconds,
  cpuThrottle: Number(process.env.CPU_THROTTLE || 1),
  repeats,
  soak: process.env.SOAK === "1",
  method: "Stationary driver rendering comparison using the actual Traffic caller, without an occupant override. Matched frozen traffic/enemy transforms and camera. Ten-second warm-up then measured uncapped Metal rendering. No movement/firing; separate entry/exit and co-op tests establish interaction behavior. These figures are not physical display FPS or endurance results.",
  dirty: !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
  cases: [],
};
const path = `${OUT}/${process.env.TAG || engine}.json`;
const save = () => fs.writeFileSync(path, JSON.stringify(report, null, 2));
save();
const browserType = engine === "webkit" ? webkit : chromium;
const b = await browserType.launch({
  headless: true,
  ...(engine === "chromium"
    ? {
        args: [
          "--disable-gpu-vsync",
          "--disable-frame-rate-limit",
          ...(process.platform === "darwin" ? ["--use-angle=metal", "--ignore-gpu-blocklist"] : []),
        ],
      }
    : {}),
  ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}),
});
report.browserVersion = b.version();
save();
try {
  for (let repeat = 0; repeat < repeats; repeat++)
    for (const map of maps) {
      const context = await b.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 2,
      });
      const p = await context.newPage();
      if (process.env.CPU_THROTTLE && engine === "chromium") {
        const session = await context.newCDPSession(p);
        await session.send("Emulation.setCPUThrottlingRate", {
          rate: Number(process.env.CPU_THROTTLE),
        });
      }
      let row = { map, repeat, errors: [], consoleErrors: [] };
      await p.exposeFunction("__benchProgress", (progress) => {
        row.progress = progress;
        (row.progressHistory ??= []).push(progress);
        save();
        console.log(JSON.stringify({ progress: true, map, ...progress }));
      });
      report.cases.push(row);
      save();
      p.on("pageerror", (e) => row.errors.push(e.message));
      p.on("console", (m) => {
        if (m.type() === "error") row.consoleErrors.push(m.text());
      });
      await context.addInitScript(() => {
        const orig = requestAnimationFrame.bind(window);
        window.__bm = { active: false, callback: [], long: [], startupLong: [] };
        window.requestAnimationFrame = (cb) =>
          orig((t) => {
            const s = performance.now();
            try {
              return cb(t);
            } finally {
              if (window.__bm.active) window.__bm.callback.push(performance.now() - s);
            }
          });
        try {
          new PerformanceObserver((l) => {
            window.__bm.startupLong.push(
              ...l.getEntries().map((e) => ({ start: e.startTime, duration: e.duration })),
            );
            if (window.__bm.active)
              window.__bm.long.push(
                ...l.getEntries().map((e) => ({ start: e.startTime, duration: e.duration })),
              );
          }).observe({ type: "longtask", buffered: false });
        } catch {}
      });
      try {
        const t0 = Date.now();
        await p.goto(
          `${process.env.BASE || "http://127.0.0.1:4173"}/game/?debug=1&map=${map}&seed=11&weather=${report.weather}&quality=${report.quality}${process.env.EXTRA || ""}`,
        );
        await startGame(p);
        await p.waitForFunction(() => window.__rs?.camera, null, { timeout: 120000 });
        row.navThroughMenuToSceneMs = Date.now() - t0;
        if (report.foliage)
          row.foliage = await p.evaluate(() => {
            const r = __rs;
            const trees = r.city.props
              .filter((p) => p.k === "tree")
              .sort(
                (a, b) =>
                  Math.hypot(a.x - r.camera.position.x, a.z - r.camera.position.z) -
                  Math.hypot(b.x - r.camera.position.x, b.z - r.camera.position.z),
              );
            for (const tree of trees)
              for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
                const x = tree.x + Math.cos(a) * 4,
                  z = tree.z + Math.sin(a) * 4;
                const y = r.groundAt(x, z);
                if (!Number.isFinite(y) || r.bodyAt(x, z, y)) continue;
                r.playtest.warp(x, y, z);
                window.__foliageTarget = { x: tree.x, z: tree.z, y: y + 4.7 * (tree.s ?? 1) };
                return { tree, start: [x, y, z] };
              }
            throw new Error("No walkable close-tree benchmark start");
          });
        await p.waitForFunction(() => window.__rsCars && window.__rsCarBatch);
        const posesPath = `${OUT}/driver-scene.json`;
        const savedScene = fs.existsSync(posesPath) ? JSON.parse(fs.readFileSync(posesPath, "utf8")) : null;
        row.driverScene = await p.evaluate(({savedScene}) => {
          const r = __rs;
          const cars = savedScene?.cars ?? __rsCars.map(c => ({x:c.x,z:c.z,yaw:c.yawVis,park:c.park,type:c.v.type}));
          for(let i=0;i<__rsCars.length;i++) {
            const c=__rsCars[i],p=cars[i];
            if(!p||c.v.type!==p.type)throw new Error("Traffic identity mismatch");
            Object.assign(c,{x:p.x,px:p.x,z:p.z,pz:p.z,yaw:p.yaw,pyaw:p.yaw,yawVis:p.yaw,driven:true,speed:0,park:p.park});
          }
          const p = cars.find(c=>c.type==="sedan"&&!c.park);
          const camera = savedScene?.camera ?? {x:p.x+Math.sin(p.yaw)*5,z:p.z+Math.cos(p.yaw)*5,y:0,yaw:p.yaw,pitch:-0.09};
          r.playtest.warp(camera.x,camera.y,camera.z);r.look.current.yaw=camera.yaw;r.look.current.pitch=camera.pitch;window.__driverBenchCamera=camera;
          r.invuln.current=1e6;r.trigger.current=false;r.pending.current.fill(null);
          const enemies=savedScene?.enemies ?? r.enemies.map((e,i)=>({i,x:e.x,y:e.y,z:e.z,alive:e.alive}));
          for(const p of enemies){const e=r.enemies[p.i];Object.assign(e,p);if(e.alive)e.frozen=1e6;}
          return {cars,camera,enemies,actualTrafficCaller:true};
        },{savedScene});
        if(!savedScene)fs.writeFileSync(posesPath,JSON.stringify(row.driverScene,null,2));
        await p.waitForTimeout(10000);
        if (process.env.WAVE)
          await p.evaluate((n) => {
            __rs.enemies.forEach((e) => (e.alive = false));
            __rs.pending.current.fill(null);
            __rs.wave.current = n;
            __rs.spawnWave(n);
            __rs.invuln.current = 1e6;
          }, Number(process.env.WAVE));
        if (process.env.WAVE) await p.waitForTimeout(8000);
        if (report.stationary) await p.evaluate(() => {
          __rs.pending.current.fill(null);
          for (const enemy of __rs.enemies) if (enemy.alive) enemy.frozen = 1e6;
        });
        row.setup = await p.evaluate(() => {
          const r = __rs;
          r.invuln.current = 1e6;
          r.equip("pistol");
          return {
            drivers: window.__rsCarBatch?.group.getObjectByName("ambient-drivers")?.count ?? 0,
            hud: document.body.innerText.slice(0, 500),
            camera: r.camera.position.toArray(),
            keys: r.keys.current,
            renderer: (() => {
              const gl = r.gl.getContext();
              const ext = gl.getExtension("WEBGL_debug_renderer_info");
              return ext
                ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
                : gl.getParameter(gl.RENDERER);
            })(),
            quality: window.__rsQuality,
            warm: window.__rsWarm,
            startupLong: window.__bm.startupLong,
            assets: performance
              .getEntriesByType("resource")
              .filter((x) => x.name.endsWith(".js"))
              .map((x) => ({ url: x.name, bytes: x.encodedBodySize, duration: x.duration })),
            enemies: r.enemies.filter((e) => e.alive).length,
            aimStats: r.aimStats.current,
          };
        });
        let cdp;
        if (process.env.PROFILE && engine === "chromium") {
          cdp = await context.newCDPSession(p);
          await cdp.send("Profiler.enable");
          await cdp.send("Profiler.start");
          row.profileStartPerformance = await p.evaluate(() => performance.now());
          await cdp.send("Performance.enable");
          const beforeClock = await cdp.send("Performance.getMetrics");
          const performanceNow = await p.evaluate(() => performance.now());
          const afterClock = await cdp.send("Performance.getMetrics");
          row.profileClock = {
            performanceNow,
            before: beforeClock.metrics.find((m) => m.name === "Timestamp").value,
            after: afterClock.metrics.find((m) => m.name === "Timestamp").value,
          };
        }
        let traceSession;
        if (process.env.TRACE && engine === "chromium") {
          traceSession = await context.newCDPSession(p);
          await traceSession.send("Tracing.start", {
            categories: "devtools.timeline,blink.user_timing",
            transferMode: "ReturnAsStream",
          });
        }
        row.metrics = await p.evaluate(
          async ({ secs, soak, foliage, fixedRoute, stationary }) => {
            const r = __rs,
              bm = __bm;
            performance.mark("benchmark-measurement-start");
            const ms = [],
              warmMs = [],
              shaderEvents = [],
              frameHitches = [],
              renders = [],
              calls = [],
              triangles = [],
              enemies = [],
              poses = [];
            let last = 0,
              start = performance.now(),
              frame = 0,
              lastProgress = 0;
            const original = r.gl.render;
            const previousAutoReset = r.gl.info.autoReset;
            r.gl.info.autoReset = false;
            r.gl.info.reset();
            const context = r.gl.getContext();
            const shaderCalls = [];
            const shaderOriginals = new Map();
            for (const name of [
              "bufferData",
              "compileShader",
              "linkProgram",
              "getProgramParameter",
              "getProgramInfoLog",
              "getShaderInfoLog",
              "getShaderParameter",
              "getUniformLocation",
              "getAttribLocation",
            ]) {
              const originalMethod = context[name];
              shaderOriginals.set(name, originalMethod);
              context[name] = function (...args) {
                const began = performance.now();
                try {
                  return originalMethod.apply(this, args);
                } finally {
                  const duration = performance.now() - began;
                  if (duration > 2)
                    shaderCalls.push({
                      method: name,
                      elapsed: (began - start) / 1000,
                      duration,
                      program: r.gl.info.programs.find((p) => p.program === args[0])?.name,
                      key: r.gl.info.programs
                        .find((p) => p.program === args[0])
                        ?.cacheKey?.slice(-240),
                    });
                }
              };
            }
            const timer = context.getExtension("EXT_disjoint_timer_query_webgl2");
            const pendingQueries = [],
              gpuMs = [];
            let submissions = 0;
            let renderTotal = 0,
              renderDepth = 0;
            r.gl.render = function (...args) {
              let s = performance.now();
              const query =
                timer && renderDepth === 0 && submissions++ % 120 === 0 && pendingQueries.length < 8
                  ? context.createQuery()
                  : null;
              if (query) context.beginQuery(timer.TIME_ELAPSED_EXT, query);
              renderDepth++;
              try {
                return original.apply(this, args);
              } finally {
                renderDepth--;
                if (query) {
                  context.endQuery(timer.TIME_ELAPSED_EXT);
                  pendingQueries.push(query);
                }
                if (renderDepth === 0) renderTotal += performance.now() - s;
              }
            };
            bm.active = true;
            r.trigger.current = !stationary;
            const startMemory = { ...r.gl.info.memory };
            const programsStart = r.gl.info.programs.length;
            let previousPrograms = programsStart;
            await new Promise((resolve) => {
              function step(now) {
                const elapsed = (now - start) / 1000;
                if (timer && frame % 120 === 0 && pendingQueries.length) {
                  if (context.getParameter(timer.GPU_DISJOINT_EXT)) {
                    pendingQueries.splice(0).forEach((q) => context.deleteQuery(q));
                  } else
                    while (
                      pendingQueries.length &&
                      context.getQueryParameter(pendingQueries[0], context.QUERY_RESULT_AVAILABLE)
                    ) {
                      const q = pendingQueries.shift();
                      gpuMs.push(context.getQueryParameter(q, context.QUERY_RESULT) / 1e6);
                      context.deleteQuery(q);
                    }
                }
                if (last) {
                  ms.push(now - last);
                  if (now - last > 50)
                    frameHitches.push({
                      elapsed,
                      ms: now - last,
                      renderSubmitMs: renderTotal,
                      rafCallbackMs: bm.callback.at(-1),
                      programs: r.gl.info.programs.length,
                    });
                  if (elapsed >= 10) warmMs.push(now - last);
                }
                const programs = r.gl.info.programs.length;
                if (programs !== previousPrograms) {
                  shaderEvents.push({
                    elapsed,
                    programs,
                    delta: programs - previousPrograms,
                    frameMs: last ? now - last : 0,
                  });
                  previousPrograms = programs;
                }
                last = now;
                renders.push(renderTotal);
                renderTotal = 0;
                calls.push(r.gl.info.render.calls);
                triangles.push(r.gl.info.render.triangles);
                r.gl.info.reset();
                enemies.push(r.enemies.filter((e) => e.alive).length);
                const alive = r.enemies.filter((e) => e.alive);
                // Endurance mode continually replenishes late-wave combat through the
                // existing spawn path; it does not change the shipped simulation.
                if (soak && alive.length < 5 && !r.pending.current.some(Boolean)) {
                  r.wave.current = 10;
                  r.spawnWave(10);
                }
                if (elapsed - lastProgress >= 60) {
                  lastProgress = elapsed;
                  window.__benchProgress({
                    elapsedSeconds: Math.round(elapsed),
                    frames: ms.length,
                    enemies: alive.length,
                    shots: r.aimStats.current.shot,
                    memory: { ...r.gl.info.memory },
                    programs: r.gl.info.programs.length,
                    quality: { tier: window.__rsQuality?.tier, dpr: window.__rsQuality?.dpr },
                  });
                }
                let target = alive.sort(
                  (a, b) =>
                    Math.hypot(a.x - r.camera.position.x, a.z - r.camera.position.z) -
                    Math.hypot(b.x - r.camera.position.x, b.z - r.camera.position.z),
                )[0];
                if (fixedRoute) {
                  r.look.current.yaw = 0;
                  r.look.current.pitch = 0;
                  target = null;
                }
                if (foliage) target = window.__foliageTarget;
                if (window.__driverBenchCamera) {
                  r.look.current.yaw = window.__driverBenchCamera.yaw;
                  r.look.current.pitch = window.__driverBenchCamera.pitch;
                } else if (target) {
                  r.look.current.yaw = Math.atan2(
                    -(target.x - r.camera.position.x),
                    -(target.z - r.camera.position.z),
                  );
                  r.look.current.pitch = foliage
                    ? Math.atan2(
                        target.y - r.camera.position.y,
                        Math.hypot(target.x - r.camera.position.x, target.z - r.camera.position.z),
                      )
                    : 0;
                } else if (!fixedRoute) r.look.current.yaw += 0.02;
                const phase = Math.floor(elapsed / 5) % 4;
                for (const key of ["KeyW", "KeyA", "KeyS", "KeyD"]) r.keys.current.delete(key);
                if (!stationary)
                  r.keys.current.add(
                    foliage
                      ? ["KeyA", "KeyD"][Math.floor(elapsed / 3) % 2]
                      : ["KeyW", "KeyA", "KeyS", "KeyD"][phase],
                  );
                r.trigger.current = !stationary;
                r.ammo.current.pistol = 999;
                r.invuln.current = 1e6;
                if (frame++ % 60 === 0)
                  poses.push({
                    t: elapsed,
                    p: r.camera.position.toArray(),
                    hp: r.healthRef.current,
                    enemies: alive.length,
                    wave: r.wave.current,
                  });
                if (elapsed < secs) requestAnimationFrame(step);
                else resolve();
              }
              requestAnimationFrame(step);
            });
            bm.active = false;
            for (const [name, method] of shaderOriginals) context[name] = method;
            r.trigger.current = false;
            r.keys.current.clear();
            r.gl.render = original;
            r.gl.info.autoReset = previousAutoReset;
            r.gl.info.reset();
            pendingQueries.forEach((q) => context.deleteQuery(q));
            const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
            const pct = (a, q) =>
              [...a].sort((a, b) => a - b)[Math.min(a.length - 1, Math.floor(a.length * q))];
            return {
              measurementStart: start,
              programsStart,
              shaderEvents,
              shaderCalls,
              frameHitches,
              warmAfter10s: {
                p95: pct(warmMs, 0.95),
                p99: pct(warmMs, 0.99),
                worst: Math.max(...warmMs),
                over16_7: warmMs.filter((x) => x > 1000 / 60).length,
                frames: warmMs.length,
              },
              driversEnd: window.__rsCarBatch?.group.getObjectByName("ambient-drivers")?.count ?? 0,
              programsEnd: r.gl.info.programs.length,
              gpuTimerAvailable: !!timer,
              gpuRenderPassSamples: gpuMs.length,
              gpuRenderPassP95: gpuMs.length ? pct(gpuMs, 0.95) : null,
              shots: r.aimStats.current.shot,
              fps: 1000 / avg(ms),
              p50: pct(ms, 0.5),
              p95: pct(ms, 0.95),
              p99: pct(ms, 0.99),
              worst: ms.reduce((a, b) => Math.max(a, b), 0),
              over16_7: ms.filter((x) => x > 1000 / 60).length,
              over50: ms.filter((x) => x > 50).length,
              over25: ms.filter((x) => x > 25).length,
              frames: ms.length,
              renderSubmitMean: avg(renders),
              renderSubmitP95: pct(renders, 0.95),
              callbackMean: avg(bm.callback),
              callbackP95: pct(bm.callback, 0.95),
              callsMean: avg(calls),
              callsMax: calls.reduce((a, b) => Math.max(a, b), 0),
              trianglesMean: avg(triangles),
              enemiesMax: enemies.reduce((a, b) => Math.max(a, b), 0),
              enemiesMean: avg(enemies),
              poses,
              longTasks: bm.long,
              memoryStart: startMemory,
              memoryEnd: { ...r.gl.info.memory },
              hud: document.body.innerText,
              quality: window.__rsQuality,
              warm: window.__rsWarm,
            };
          },
          {
            secs: seconds,
            soak: report.soak,
            foliage: report.foliage,
            fixedRoute: report.fixedRoute,
            stationary: report.stationary,
          },
        );
        if (traceSession) {
          const completed = new Promise((resolve) =>
            traceSession.once("Tracing.tracingComplete", resolve),
          );
          await traceSession.send("Tracing.end");
          const { stream } = await completed;
          const target = fs.openSync(`${OUT}/${process.env.TAG}-${map}-${repeat}.trace.json`, "w");
          while (true) {
            const part = await traceSession.send("IO.read", { handle: stream });
            fs.writeSync(target, part.base64Encoded ? Buffer.from(part.data, "base64") : part.data);
            if (part.eof) break;
          }
          fs.closeSync(target);
          await traceSession.send("IO.close", { handle: stream });
        }
        if (cdp) {
          const prof = await cdp.send("Profiler.stop");
          fs.writeFileSync(
            `${OUT}/${process.env.TAG}-${map}-${repeat}.cpuprofile`,
            JSON.stringify(prof.profile),
          );
        }
        await p.screenshot({ path: `${OUT}/${process.env.TAG || engine}-${map}-${repeat}.png` });
        console.log(
          JSON.stringify({
            engine,
            map,
            repeat,
            ...Object.fromEntries(
              Object.entries(row.metrics).filter(([k, v]) => typeof v === "number"),
            ),
          }),
        );
      } catch (e) {
        row.failure = e.stack;
        console.log("FAIL", engine, map, e.message);
      } finally {
        save();
        await context.close();
      }
    }
} finally {
  await b.close();
  report.ended = new Date().toISOString();
  save();
}
if (
  report.cases.some(
    (c) =>
      c.failure ||
      c.errors.length ||
      !c.metrics?.frames ||
      (report.stationary ? c.metrics.shots !== 0 : c.metrics.shots === 0) ||
      !c.metrics.poses.every(({ p }) => p.every(Number.isFinite)),
  )
)
  process.exitCode = 1;
