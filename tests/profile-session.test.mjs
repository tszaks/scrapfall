import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/game/profileSession.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { followProfileSession } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));
function setup(load) {
  let emit;
  const updates = [], errors = [], loading = [];
  let unsubscribed = false;
  const stop = followProfileSession((callback) => {
    emit = callback;
    return () => { unsubscribed = true; };
  }, load, (p) => updates.push(p), (e) => errors.push(e), (v) => loading.push(v));
  return { emit: (u) => emit(u), updates, errors, loading, stop, unsubscribed: () => unsubscribed };
}

test('restores a remembered session and queries outside the auth callback', async () => {
  let calls = 0;
  const s = setup(async (user) => { calls++; return { id: user.id }; });
  s.emit({ id: 'remembered' });
  assert.equal(calls, 0);
  assert.deepEqual(s.loading, [true]);
  await flush();
  assert.deepEqual(s.updates, [{ id: 'remembered' }]);
  assert.equal(s.loading.at(-1), false);
  s.stop();
});

test('clears a signed-out session and prevents late restoration after logout', async () => {
  let resolve;
  const s = setup(() => new Promise((r) => { resolve = r; }));
  s.emit({ id: 'old' });
  await flush();
  s.emit(null);
  resolve({ id: 'old' });
  await flush();
  assert.deepEqual(s.updates, [null]);
  assert.equal(s.loading.at(-1), false);
  s.stop();
});

test('a newer account wins over an older in-flight profile', async () => {
  let resolveOld;
  const s = setup((user) => user.id === 'old' ? new Promise((r) => { resolveOld = r; }) : Promise.resolve(user));
  s.emit({ id: 'old' });
  await flush();
  s.emit({ id: 'new' });
  await flush();
  resolveOld({ id: 'old' });
  await flush();
  assert.deepEqual(s.updates, [{ id: 'new' }]);
  s.stop();
});

test('reports restoration errors and recovers on the next auth event', async () => {
  let fail = true;
  const s = setup(async (user) => { if (fail) throw new Error('offline'); return user; });
  s.emit({ id: 'remembered' });
  await flush();
  assert.equal(s.errors[0].message, 'offline');
  assert.deepEqual(s.updates, []);
  assert.equal(s.loading.at(-1), false);
  fail = false;
  s.emit({ id: 'remembered' });
  await flush();
  assert.deepEqual(s.updates, [{ id: 'remembered' }]);
  s.stop();
});

test('unmount unsubscribes and ignores outstanding profile requests', async () => {
  let resolve;
  const s = setup(() => new Promise((r) => { resolve = r; }));
  s.emit({ id: 'old' });
  await flush();
  s.stop();
  resolve({ id: 'old' });
  await flush();
  assert.equal(s.unsubscribed(), true);
  assert.deepEqual(s.updates, []);
});
