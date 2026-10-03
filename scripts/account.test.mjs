import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";

let client;
globalThis.__accountTestClient = new Proxy({}, { get: (_, key) => client[key] });
const bundle = await rolldown({
  input: fileURLToPath(new URL("../src/game/account.ts", import.meta.url)),
  plugins: [
    {
      name: "mock-account-backend",
      resolveId(id) {
        if (id === "./accountClient") return "\0account-client";
      },
      load(id) {
        if (id === "\0account-client")
          return "export const accountClient = globalThis.__accountTestClient;";
      },
    },
  ],
});
const { output } = await bundle.generate({ format: "esm", codeSplitting: false });
const account = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`
);

const p = { id: "user", username: "player", kills: 17, matches: 2, best_wave: 6, color: "#ffaa00" };
test("sign-in and sign-up do not race a second profile read", async () => {
  client = {
    auth: {
      signInWithPassword: async () => ({ error: null }),
      signUp: async () => ({ data: { session: {} }, error: null }),
    },
    from() {
      assert.fail("auth subscription alone must load profiles");
    },
  };
  await account.signIn("player", "password");
  await account.signUp("player", "password");
});

test("sign-up without a session explains that login is incomplete", async () => {
  client = { auth: { signUp: async () => ({ data: { session: null }, error: null }) } };
  await assert.rejects(account.signUp("player", "password"), /sign-in is incomplete/);
});

function profileBackend(initial, failure = null) {
  let row = { ...initial };
  return {
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { ...row }, error: null }) }) }),
      update: (next) => {
        const conditions = [];
        const query = {
          eq(key, value) {
            conditions.push([key, value]);
            return query;
          },
          select() {
            return query;
          },
          async maybeSingle() {
            if (failure) return { data: null, error: failure };
            if (!conditions.every(([key, value]) => row[key] === value))
              return { data: null, error: null };
            row = { ...row, ...next };
            return { data: { ...row }, error: null };
          },
        };
        return query;
      },
    }),
  };
}
test("recordRun uses fresh totals and overtime preserves the match count", async () => {
  client = profileBackend(p);
  assert.deepEqual(await account.recordRun(p, 8, 4), { ...p, kills: 25, matches: 3 });
  assert.deepEqual(await account.recordRun(p, 2, 14, 0), {
    ...p,
    kills: 27,
    matches: 3,
    best_wave: 14,
  });
});
test("concurrent remembered tabs cannot lose either run's increments", async () => {
  client = profileBackend(p);
  await Promise.all([account.recordRun(p, 8, 9), account.recordRun(p, 3, 7)]);
  const { data } = await client.from().select().eq().single();
  assert.deepEqual(data, { ...p, kills: 28, matches: 4, best_wave: 9 });
});
test("transport failures are surfaced without replaying an uncertain write", async () => {
  client = profileBackend(p, new Error("offline"));
  await assert.rejects(account.recordRun(p, 8, 7), /offline/);
});
test("sign-in preserves service errors and normalizes only invalid credentials", async () => {
  for (const [code, message, expected] of [
    ["invalid_credentials", "bad credentials", "Wrong username or password"],
    ["over_request_rate_limit", "Try later", "Try later"],
    ["unexpected_failure", "Server unavailable", "Server unavailable"],
  ]) {
    client = { auth: { signInWithPassword: async () => ({ error: { code, message } }) } };
    await assert.rejects(account.signIn("player", "password"), { message: expected });
  }
});
test("completed waves include a cleared shopping break but not an opening banner", () => {
  assert.equal(account.completedWave(4, true), 4);
  assert.equal(account.completedWave(4, false), 3);
  assert.equal(account.completedWave(1, false), 0);
  assert.equal(account.completedWave(12, true), 12);
});

test("overtime credits only new kills and one match; new arenas/accounts start fresh", () => {
  const previous = { runId: 7, userId: "user", kills: 40 };
  assert.deepEqual(account.runCredit(null, previous), { kills: 40, matches: 1 });
  assert.deepEqual(account.runCredit(previous, { ...previous, kills: 48 }), {
    kills: 8,
    matches: 0,
  });
  assert.deepEqual(account.runCredit(previous, { ...previous, kills: 40 }), {
    kills: 0,
    matches: 0,
  });
  assert.deepEqual(account.runCredit(previous, { ...previous, runId: 8, kills: 2 }), {
    kills: 2,
    matches: 1,
  });
  assert.deepEqual(account.runCredit(previous, { ...previous, userId: "other" }), {
    kills: 40,
    matches: 1,
  });
});
