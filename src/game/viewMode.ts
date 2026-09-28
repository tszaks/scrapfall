import { useSyncExternalStore } from "react";
export type ViewMode = "first" | "third";
const KEY = "scrapfall-view";
let mode: ViewMode = "first";
try {
  if (typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "third") mode = "third";
} catch {
  /* private browsing */
}
const listeners = new Set<() => void>();
export const getViewMode = () => mode;
export function setViewMode(next: ViewMode) {
  mode = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* optional preference */
  }
  listeners.forEach((f) => f());
}
export const toggleView = () => setViewMode(mode === "first" ? "third" : "first");
export const useViewMode = () =>
  useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    getViewMode,
    () => "first" as ViewMode,
  );
