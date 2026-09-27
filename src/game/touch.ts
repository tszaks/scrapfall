// Shared touch-control state. The on-screen controls write here and the
// render loop reads (and drains) it each frame, so no React state is involved.
export const touchInput = {
  moveX: 0, // strafe, -1..1
  moveZ: 0, // forward, -1..1
  lookX: 0, // accumulated look delta in px, drained per frame
  lookY: 0,
  fire: false,
  ability: false, // one-shot
  swap: 0, // one-shot: -1 previous weapon, 1 next weapon
  pick: null as string | null, // one-shot: equip this weapon directly (tapped HUD chip)
};


export function resetTouchInput() {
  touchInput.moveX = 0;
  touchInput.moveZ = 0;
  touchInput.lookX = 0;
  touchInput.lookY = 0;
  touchInput.fire = false;
  touchInput.ability = false;
  touchInput.swap = 0;
  touchInput.pick = null;
}


export function isTouchDevice() {
  if (typeof window === "undefined") return false;
  return navigator.maxTouchPoints > 0 || "ontouchstart" in window;
}
