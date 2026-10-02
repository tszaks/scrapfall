import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const load = async (path) => {
  const src = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
};
const ice = await load("../src/game/iceServers.ts");
const errs = await load("../src/game/joinErrors.ts");
const turn = await load("../api/turn.ts");

const CF_BODY = {
  iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
    {
      urls: [
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turn:turn.cloudflare.com:53?transport=udp",
        "turns:turn.cloudflare.com:443?transport=tcp",
      ],
      username: "u",
      credential: "c",
    },
  ],
};
const json = (status, body) => new Response(JSON.stringify(body), { status });

test("endpoint refuses cleanly when the env vars are missing, without calling Cloudflare", async () => {
  let called = false;
  const r = await turn.mintIceServers({}, async () => ((called = true), json(201, CF_BODY)));
  assert.equal(r.status, 503);
  assert.equal(called, false);
});

test("endpoint calls Cloudflare's documented API and strips browser-blocked port 53", async () => {
  let seen;
  const r = await turn.mintIceServers(
    { CLOUDFLARE_TURN_KEY_ID: "kid", CLOUDFLARE_TURN_API_TOKEN: "tok" },
    async (url, init) => ((seen = { url, init }), json(201, CF_BODY)),
  );
  assert.equal(
    seen.url,
    "https://rtc.live.cloudflare.com/v1/turn/keys/kid/credentials/generate-ice-servers",
  );
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.Authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(seen.init.body), { ttl: 86400 });
  assert.equal(r.status, 200);
  const urls = r.body.iceServers.flatMap((s) => s.urls);
  assert.ok(urls.length === 3 && !urls.some((u) => u.includes(":53")));
  assert.equal(r.body.iceServers[1].username, "u");
});

test("endpoint reports an upstream failure without echoing the token", async () => {
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(" "));
  try {
    const env = { CLOUDFLARE_TURN_KEY_ID: "kid", CLOUDFLARE_TURN_API_TOKEN: "secret-token" };
    assert.equal((await turn.mintIceServers(env, async () => json(401, {}))).status, 502);
    const thrown = await turn.mintIceServers(env, async () => {
      throw new TypeError("fetch failed");
    });
    assert.equal(thrown.status, 502);
  } finally {
    console.error = orig;
  }
  assert.ok(logged.length === 2 && !logged.some((l) => l.includes("secret-token")));
});

test("client loader uses the relay list and caches it", async () => {
  let calls = 0;
  const load = ice.makeIceLoader("/game/api/turn", async () => (calls++, json(200, CF_BODY)));
  const a = await load();
  const b = await load();
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.ok(a.some((s) => s.credential === "c"));
});

test("client falls back to STUN only on any failure, and retries next time", async () => {
  let calls = 0;
  const failing = [
    async () => json(503, { error: "turn-not-configured" }),
    async () => new Response("<html>", { status: 200 }), // dev server / static SPA fallback
    async () => {
      throw new TypeError("offline");
    },
  ];
  const load = ice.makeIceLoader("/x", (...a) => failing[calls++](...a));
  for (let i = 0; i < 3; i++) assert.deepEqual(await load(), ice.FALLBACK_ICE);
  assert.equal(calls, 3);
});

test("client gives up on a slow endpoint inside the timeout", async () => {
  const hang = (_url, init) =>
    new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("abort"))));
  const t0 = Date.now();
  const load = ice.makeIceLoader("/x", hang, () => Date.now(), 50);
  assert.deepEqual(await load(), ice.FALLBACK_ICE);
  assert.ok(Date.now() - t0 < 1000);
});

test("join failures get distinct messages", () => {
  assert.equal(errs.joinFailureMessage({ type: "peer-unavailable" }), "No arena found with that code.");
  const timeout = errs.joinFailureMessage(errs.joinFailure(errs.CONNECT_TIMEOUT, "x"));
  assert.match(timeout, /couldn't connect/);
  assert.notEqual(timeout, errs.joinFailureMessage({ type: "peer-unavailable" }));
  assert.match(errs.joinFailureMessage({ type: "network" }), /co-op server/);
  assert.match(errs.joinFailureMessage(new Error("?")), /Try again/);
});
