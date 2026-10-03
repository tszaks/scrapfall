import test from "node:test";
import assert from "node:assert/strict";
import { rolldown } from "rolldown";
import { fileURLToPath } from "node:url";
let harness;
globalThis.__accountHook = new Proxy({}, { get: (_, key) => harness[key] });
const bundle = await rolldown({
  input: fileURLToPath(new URL("../src/game/useAccount.ts", import.meta.url)),
  plugins: [
    {
      name: "hook-harness",
      resolveId(id) {
        if (["react", "./account", "./accountClient"].includes(id)) return "\0" + id;
      },
      load(id) {
        if (id === "\0react")
          return "export const useState=(...a)=>globalThis.__accountHook.useState(...a); export const useRef=(...a)=>globalThis.__accountHook.useRef(...a); export const useEffect=(...a)=>globalThis.__accountHook.useEffect(...a);";
        if (id === "\0./accountClient") return "export const accountsConfigured=true;";
        if (id === "\0./account")
          return "export const watchProfile=(...a)=>globalThis.__accountHook.watchProfile(...a); export const recordRun=(...a)=>globalThis.__accountHook.recordRun(...a); export const runCredit=(p,n)=>({kills:p?.runId===n.runId&&p.userId===n.userId?Math.max(0,n.kills-p.kills):n.kills,matches:p?.runId===n.runId&&p.userId===n.userId?0:1});";
      },
    },
  ],
});
const { output } = await bundle.generate({ format: "esm", codeSplitting: false });
const { useAccount } = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`
);
const p = { id: "user", username: "player", kills: 0, matches: 0, best_wave: 0, color: "#fff" };
const tick = () => new Promise((resolve) => setImmediate(resolve));
function setup(save) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let restore;
  let signOut;
  harness = {
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: initial };
      return [
        slots[i].value,
        (v) => {
          slots[i].value = typeof v === "function" ? v(slots[i].value) : v;
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      return (slots[i] ??= { current: initial });
    },
    useEffect(fn, deps) {
      const i = cursor++;
      const old = slots[i];
      if (!old || deps.some((v, n) => v !== old[n])) {
        slots[i] = deps;
        effects.push(fn);
      }
    },
    watchProfile(update, report, loading, identity) {
      restore = () => {
        identity(p.id);
        update(p);
        loading(false);
      };
      signOut = () => {
        identity(null);
        update(null);
        loading(false);
      };
      return () => {};
    },
    recordRun: save,
  };
  const render = (ended, kills = 0, run = 7) => {
    cursor = 0;
    effects = [];
    const result = useAccount(ended, kills, 4, run);
    for (const effect of effects) effect();
    return result;
  };
  render(false);
  return { render, restore: () => restore(), signOut: () => signOut() };
}
test("a run ending during remembered-profile loading is saved after restoration exactly once", async () => {
  const calls = [];
  const h = setup(async (...args) => {
    calls.push(args);
    return p;
  });
  h.render(true, 8);
  await tick();
  assert.equal(calls.length, 0);
  h.restore();
  h.render(true, 8);
  await tick();
  h.render(true, 8);
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 8);
});
test("overlapping ending/overtime saves are serialized and credit only additional kills", async () => {
  const calls = [];
  let finish;
  const h = setup((...args) => {
    calls.push(args);
    return calls.length === 1
      ? new Promise((r) => {
          finish = r;
        })
      : Promise.resolve(p);
  });
  h.restore();
  h.render(true, 40);
  await tick();
  h.render(false, 40);
  h.render(true, 48);
  await tick();
  assert.equal(calls.length, 1);
  finish(p);
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1][1], 8);
  assert.equal(calls[1][3], 0);
});
test("an uncertain save is not replayed in overtime; a fresh arena can save again", async () => {
  const calls = [];
  const h = setup(async (...args) => {
    calls.push(args);
    if (calls.length === 1) throw new Error("response lost");
    return p;
  });
  h.restore();
  h.render(true, 40);
  await tick();
  h.render(false, 40);
  h.render(true, 48);
  await tick();
  assert.equal(calls.length, 1);
  assert.match(h.render(true, 48).error, /uncertain/);
  h.render(false, 0, 8);
  h.render(true, 2, 8);
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1][1], 2);
  assert.equal(h.render(true, 2, 8).error, "");
});

test("a pending ending survives a new arena and saves its original score and wave", async () => {
  const calls = [];
  const h = setup(async (...args) => {
    calls.push(args);
    return p;
  });
  h.render(true, 8, 7);
  h.render(false, 0, 8);
  h.restore();
  h.render(false, 0, 8);
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 8);
  assert.equal(calls[0][2], 4);
  h.render(true, 2, 8);
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1][1], 2);
});
test("signed-out initial restoration drops pending endings rather than assigning them on later login", async () => {
  const calls = [];
  const h = setup(async (...args) => {
    calls.push(args);
    return p;
  });
  h.render(true, 8, 7);
  h.signOut();
  h.render(true, 8, 7);
  h.restore();
  h.render(true, 8, 7);
  await tick();
  assert.equal(calls.length, 0);
});

test("multiple completed arenas during restoration retain separate ending snapshots", async () => {
  const calls = [];
  const h = setup(async (...args) => {
    calls.push(args);
    return p;
  });
  h.render(true, 8, 7);
  h.render(false, 0, 8);
  h.render(true, 2, 8);
  h.restore();
  h.render(true, 2, 8);
  await tick();
  assert.deepEqual(
    calls.map((args) => [args[1], args[3]]),
    [
      [8, 1],
      [2, 1],
    ],
  );
});
