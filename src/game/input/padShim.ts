// Debug-only fake controller for headless tests (no real pad there): `?padshim=xbox` (or ps,
// switch, generic; add `&padmap=ns` for a non-standard mapping with a d-pad hat) replaces
// navigator.getGamepads() with one scripted pad, driven from the console / test tooling:
//
//   __pad.down(0) / __pad.up(0)      hold / release button 0 (A)
//   __pad.tap(7, 120)                press button 7 (RT) for 120 ms
//   __pad.axis(0, 1)                 left stick right
//   __pad.rumbles                    every vibration request the game made
//   __pad.unplug() / __pad.plug()    disconnect / reconnect
//
// Nothing here runs without the URL parameter.

type FakeButton = { pressed: boolean; touched: boolean; value: number };

const IDS: Record<string, string> = {
  xbox: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)",
  ps: "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)",
  switch: "Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)",
  generic: "USB Gamepad (Vendor: 0079 Product: 0006)",
};

export function installPadShim() {
  if (typeof window === "undefined") return;
  const q = new URLSearchParams(window.location.search);
  const kind = q.get("padshim");
  if (!kind) return;
  const nonStandard = q.get("padmap") === "ns";
  const buttons: FakeButton[] = Array.from({ length: nonStandard ? 12 : 17 }, () => ({
    pressed: false,
    touched: false,
    value: 0,
  }));
  const axes = nonStandard ? [0, 0, 0, 0, 0, 0, 0, 0, 0, 1.2857] : [0, 0, 0, 0];
  const rumbles: unknown[] = [];
  let connected = true;
  const pad = {
    id: IDS[kind] ?? IDS["xbox"]!,
    index: 0,
    connected: true,
    mapping: nonStandard ? "" : "standard",
    timestamp: 0,
    axes,
    buttons,
    vibrationActuator: {
      type: "dual-rumble",
      playEffect: (_t: string, p: unknown) => {
        rumbles.push(p);
        return Promise.resolve("complete");
      },
    },
  };
  const set = (i: number, v: number) => {
    const b = buttons[i];
    if (!b) return;
    b.value = v;
    b.pressed = v > 0.5;
    b.touched = v > 0;
    pad.timestamp = performance.now();
  };
  // d-pad on a non-standard pad: the hat axis (-1 up, then clockwise in steps of 2/7)
  const hat = {
    12: -1,
    15: -1 + (2 / 7) * 2,
    13: -1 + (2 / 7) * 4,
    14: -1 + (2 / 7) * 6,
  } as Record<number, number>;
  const api = {
    down(i: number, v = 1) {
      if (nonStandard && hat[i] !== undefined) axes[9] = hat[i]!;
      else set(i, v);
    },
    up(i: number) {
      if (nonStandard && hat[i] !== undefined) axes[9] = 1.2857;
      else set(i, 0);
    },
    tap(i: number, ms = 90) {
      api.down(i);
      window.setTimeout(() => api.up(i), ms);
    },
    axis(i: number, v: number) {
      axes[i] = v;
      pad.timestamp = performance.now();
    },
    reset() {
      buttons.forEach((_, i) => set(i, 0));
      for (let i = 0; i < 4; i++) axes[i] = 0;
    },
    rumbles,
    unplug() {
      connected = false;
      window.dispatchEvent(Object.assign(new Event("gamepaddisconnected"), { gamepad: pad }));
    },
    plug() {
      connected = true;
      window.dispatchEvent(Object.assign(new Event("gamepadconnected"), { gamepad: pad }));
    },
    pad,
  };
  Object.defineProperty(navigator, "getGamepads", {
    configurable: true,
    value: () => (connected ? [pad, null, null, null] : [null, null, null, null]),
  });
  (window as unknown as { __pad?: unknown }).__pad = api;
  window.setTimeout(() => api.plug(), 0);
}
