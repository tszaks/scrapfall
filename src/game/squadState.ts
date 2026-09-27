// Squad state shared between the canvas driver, the HUD and the network handler.
import type * as THREE from "three";

import { playPing } from "./events/sfx";
import type { NetMsg } from "./net";
import { pingFromMsg, pings } from "./ping";
import { applySquadMsg, myRevive, squad } from "./revive";

/** the camera the HUD projects through (set from inside the canvas) */
export const hudView = { camera: null as THREE.Camera | null };
/** host: who each player is holding R on (reviver id -> target id) */
export const hostWants = new Map<string, string>();

export type SquadCallbacks = {
  isHost: () => boolean;
  numOf: (id: string) => number;
  onRevived: () => void;
  onBleedOut: () => void;
};

/** network messages for pings and revives; returns true if handled */
export function handleSquadMsg(m: NetMsg, cb: SquadCallbacks) {
  switch (m.type) {
    case "ping": {
      const p = pingFromMsg(m, cb.numOf(String(m.from ?? "host")));
      playPing(p.kind === "enemy", false);
      return true;
    }
    case "pst":
      if (!cb.isHost()) applySquadMsg(m);
      return true;
    case "rv":
      if (cb.isHost()) {
        const from = String(m.from ?? "");
        if (m.on && m.id) hostWants.set(from, String(m.id));
        else hostWants.delete(from);
      }
      return true;
    case "revived":
      cb.onRevived();
      return true;
    case "bleed":
      cb.onBleedOut();
      return true;
  }
  return false;
}

export function resetSquad() {
  hostWants.clear();
  squad.clear();
  myRevive.target = "";
  myRevive.mustRelease = false;
  pings.length = 0;
}

