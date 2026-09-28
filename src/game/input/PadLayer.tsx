import { controlState } from "./remap";
// Controller support for the menus (start, loadout, pause, game over, Settings, the weapon and
// enemy panels): the d-pad or left stick walks a focus ring between the buttons of the
// top-most open menu, A presses, B backs out (CLOSE / BACK / DONE), Start presses the menu's
// main button (START / RESUME / ENTER ARENA / NEW ARENA). Sliders move with left / right.
//
// Mount once in the Game component. It needs no markup changes: the top-most menu is the
// highest full-screen overlay (z-index 30+) on screen; `data-pad-back` / `data-pad-start` on
// a button override the text matching.
import { useEffect } from "react";
import { BTN } from "./bindings";
import { consumePress, pollPad } from "./gamepad";
import { installControls } from "./controls";
import { installPadShim } from "./padShim";

const CSS = `
html.pad-nav :is(button, input, select, [data-pad-focus]):focus {
  outline: 3px solid #e7b25c !important;
  outline-offset: 2px;
  box-shadow: 0 0 0 6px rgba(43, 33, 24, 0.55);
}
html.rs-bigmap [data-minimap] {
  transform: scale(2.1) !important;
  transform-origin: bottom right;
}
`;

const FOCUSABLE = "button, input[type=range], input[type=checkbox], select, [data-pad-focus]";

const visible = (el: Element) =>
  el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";

/** the top-most open menu: the highest full-screen overlay (z 30+) that has buttons */
function topMenu(): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestZ = -1;
  document.querySelectorAll<HTMLElement>(".fixed.inset-0").forEach((el) => {
    const z = parseInt(getComputedStyle(el).zIndex, 10);
    if (!(z >= 30) || !visible(el) || !el.querySelector(FOCUSABLE)) return;
    if (z >= bestZ) {
      best = el;
      bestZ = z;
    }
  });
  return best;
}

/** the menu's own controls (not those of a menu opened on top of it, inside it) */
function items(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if ((el as HTMLButtonElement).disabled || !visible(el)) return false;
    const owner = el.parentElement?.closest<HTMLElement>(".fixed.inset-0");
    return (
      owner === root ||
      (owner !== null &&
        owner !== undefined &&
        root.contains(owner) &&
        parseInt(getComputedStyle(owner).zIndex, 10) < 30)
    );
  });
}

const label = (el: HTMLElement) => (el.textContent ?? "").trim().toUpperCase();
function findButton(list: HTMLElement[], attr: string, words: RegExp) {
  return (
    list.find((el) => el.hasAttribute(attr)) ??
    list.find((el) => el.tagName === "BUTTON" && words.test(label(el)))
  );
}
const START_WORDS = /^(RESUME|ENTER ARENA|NEW ARENA|START)$/;
const BACK_WORDS = /^(CLOSE|BACK|DONE|✕|×)$/;

function step(dir: "up" | "down" | "left" | "right", list: HTMLElement[], cur: HTMLElement) {
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of list) {
    if (el === cur) continue;
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - ax;
    const dy = r.top + r.height / 2 - ay;
    const along = dir === "right" ? dx : dir === "left" ? -dx : dir === "down" ? dy : -dy;
    const across = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
    if (along <= 4) continue;
    const score = along + across * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

function nudgeRange(el: HTMLInputElement, dir: number) {
  const stepV = Number(el.step) || 1;
  const min = Number(el.min || 0);
  const max = Number(el.max || 100);
  const v = Math.max(
    min,
    Math.min(max, Math.round((Number(el.value) + dir * stepV) / stepV) * stepV),
  );
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, String(Number(v.toFixed(4))));
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const focusOn = (el: HTMLElement) => {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest" });
};

function menuFrame(rep: { dir: string; next: number }) {
  if(controlState.capturing&&!controlState.captureMenu)return;
  const p = pollPad();
  if (!p.connected) return;
  const root = topMenu();
  if (!root) return;
  const list = items(root);
  if (list.length === 0) return;
  const cur =
    document.activeElement instanceof HTMLElement && list.includes(document.activeElement)
      ? document.activeElement
      : null;
  const primary = () => findButton(list, "data-pad-start", START_WORDS) ?? list[0]!;

  // direction: d-pad or left stick, with key-repeat when held
  const dir =
    p.down[BTN.UP] || p.ly < -0.55
      ? "up"
      : p.down[BTN.DOWN] || p.ly > 0.55
        ? "down"
        : p.down[BTN.LEFT] || p.lx < -0.55
          ? "left"
          : p.down[BTN.RIGHT] || p.lx > 0.55
            ? "right"
            : "";
  const now = performance.now();
  let go = false;
  if (dir !== rep.dir) {
    rep.dir = dir;
    rep.next = now + 380;
    go = dir !== "";
  } else if (dir && now >= rep.next) {
    rep.next = now + 120;
    go = true;
  }
  if (go) {
    if (!cur) focusOn(primary());
    else if (
      cur instanceof HTMLInputElement &&
      cur.type === "range" &&
      (dir === "left" || dir === "right")
    )
      nudgeRange(cur, dir === "left" ? -1 : 1);
    else {
      const n = step(dir as "up", list, cur);
      if (n) focusOn(n);
    }
  }
  if (p.pressed[BTN.A]) {
    consumePress(BTN.A);
    if (!cur) focusOn(primary());
    else if (!(cur instanceof HTMLInputElement && cur.type === "range")) cur.click();
  }
  if (p.pressed[BTN.B]) {
    consumePress(BTN.B);
    findButton(list, "data-pad-back", BACK_WORDS)?.click();
  }
  if (p.pressed[BTN.START]) {
    consumePress(BTN.START);
    findButton(list, "data-pad-start", START_WORDS)?.click();
  }
}

/** Controller menu navigation + the focus-ring style. `menus`: a menu is open (not playing). */
export function PadLayer({ menus }: { menus: boolean }) {
  useEffect(() => {
    installPadShim();
    installControls();
  }, []);
  useEffect(() => {
    if (!menus) return;
    const rep = { dir: "", next: 0 };
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      menuFrame(rep);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [menus]);
  return <style>{CSS}</style>;
}
