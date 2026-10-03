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

test("recordRun retains earned totals and returns the saved row", async () => {
  let written;
  client = {
    from(table) {
      assert.equal(table, "profiles");
      return {
        update(value) {
          written = value;
          return {
            eq(key, id) {
              assert.equal(key, "id");
              assert.equal(id, p.id);
              return {
                select: () => ({ single: async () => ({ data: { ...p, ...value }, error: null }) }),
              };
            },
          };
        },
      };
    },
  };
  assert.deepEqual(await account.recordRun(p, 8, 4), { ...p, kills: 25, matches: 3 });
  assert.deepEqual(written, { kills: 25, matches: 3, best_wave: 6 });
  assert.deepEqual(await account.recordRun({ ...p, kills: 25, matches: 3 }, 2, 14, 0), {
    ...p,
    kills: 27,
    matches: 3,
    best_wave: 14,
  });
});

test("a failed run write is reported, never counted as saved", async () => {
  const error = new Error("offline");
  client = {
    from: () => ({
      update: () => ({
        eq: () => ({ select: () => ({ single: async () => ({ data: null, error }) }) }),
      }),
    }),
  };
  await assert.rejects(account.recordRun(p, 8, 7), /offline/);
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
