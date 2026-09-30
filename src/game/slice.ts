import { useEffect, useRef, useState } from "react";

// Cooperative time-slicing for world construction. Heavy generators and mesh builders
// run as coroutines (function* with `yield` at safe points); runSliced pumps them and
// hands control back to the event loop whenever a slice blows its budget, so no task
// runs long enough to delay a click. Everything stays on the main thread — layouts,
// terrain closures and module globals keep working exactly as before.

/** ms of main-thread work per slice before control returns to the event loop. Under a
 * 4x CPU throttle one unit of work takes 4x longer, so this stays comfortably under
 * the 100 ms task budget everywhere. */
const BUDGET_MS = 16;

// MessageChannel is the fastest macrotask yield (no 4 ms setTimeout clamp). Safari
// supports it everywhere Workers/postMessage do.
const chan = new MessageChannel();
const waiters: (() => void)[] = [];
chan.port1.onmessage = () => waiters.shift()?.();

/** Suspend the current async function for one task, letting input/paint through. */
export function yieldControl(): Promise<void> {
  return new Promise((resolve) => {
    waiters.push(resolve);
    chan.port2.postMessage(0);
  });
}

/** Suspend until the next animation frame (use when the next step should paint first). */
export function yieldFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Pump a coroutine to completion across tasks. The generator yields at safe points;
 * the driver yields to the event loop whenever the accumulated work since the last
 * yield exceeds BUDGET_MS. Returns the coroutine's return value.
 */
export async function runSliced<T>(
  it: Generator<unknown, T, unknown>,
  budget = BUDGET_MS,
): Promise<T> {
  let t0 = performance.now();
  for (;;) {
    const s = it.next();
    if (s.done) return s.value;
    const step = s.value;
    if (step instanceof Promise) await step;
    if (performance.now() - t0 >= budget) {
      await yieldControl();
      t0 = performance.now();
    }
  }
}

/** One-shot helper for pipelines that are already plain statements: call between
 * phases; it resolves immediately unless the caller wants a forced pause. */
export async function phase<T>(fn: () => T): Promise<T> {
  const t = fn();
  await yieldControl();
  return t;
}

/** Run a coroutine to completion in one task — the synchronous fallback for paths that
 * can't await (a render-path useMemo that missed its prepared cache). */
export function drain<T>(it: Generator<unknown, T, unknown>): T {
  let s = it.next();
  while (!s.done) s = it.next();
  return s.value;
}

/**
 * Hook: run a heavy constructor off the render path, across tasks. Returns the built
 * value, or null while it builds. `deps` restart the build; a stale build is dropped
 * (its globals-install phase must be wrapped in the same effect anyway).
 */
export function useSliced<T>(
  build: () => Generator<unknown, T, unknown> | Promise<T> | T,
  deps: readonly unknown[],
): T | null {
  const [value, setValue] = useState<T | null>(null);
  const gen = useRef(0);
  useEffect(() => {
    const n = ++gen.current;
    setValue(null);
    let alive = true;
    (async () => {
      const out = build();
      const v =
        out && typeof (out as Generator).next === "function"
          ? await runSliced(out as Generator<unknown, T, unknown>)
          : await (out as Promise<T> | T);
      if (alive && gen.current === n) setValue(v);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

/**
 * Progressive mount: returns how many of `total` items should render right now,
 * growing by `per` each frame until all are mounted. Feeding a stable array of
 * elements through `.slice(0, n)` keeps each React commit small.
 */
export function useStaged(total: number, per = 24): number {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    if (total <= 0) return;
    let alive = true;
    let n = 0;
    const tick = () => {
      if (!alive || n >= total) return;
      n = Math.min(n + per, total);
      setShown(n);
      if (n < total) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      alive = false;
    };
  }, [total, per]);
  return Math.min(shown, total);
}
