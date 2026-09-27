// Co-op downed / revive. A co-op player who runs out of health goes DOWN instead of
// straight to spectating: they lie on the ground, can only crawl, and bleed out over 30 s.
// A teammate who holds R next to them for 3 s brings them back at 40% health (damage to
// the reviver interrupts it). If the bleed-out runs out they are dead as before: every gun
// but the pistol is lost and they respawn at the next wave. If the whole squad is down or
// dead at once, the run ends.
//
// The host owns the table (who is up / down / dead, bleed timers, revive progress) and
// broadcasts it; guests only say "I'm holding R on X" and render what the host sends.
export const BLEED_TIME = 30;
export const REVIVE_TIME = 3;
export const REVIVE_RANGE = 2.6;
export const REVIVE_HP = 0.4;

export const UP = 0;
export const DOWN = 1;
export const DEAD = 2;

export type PState = { st: number; bleed: number; prog: number; by: string; grace?: number };
/** everyone's state by player id ("host" for the host), mirrored from the host */
export const squad = new Map<string, PState>();

/** this client */
export const me = { id: "host", x: 0, z: 0, yaw: 0 };

/** my revive attempt: who I'm reviving (as told to the host) */
export const myRevive = { target: "", mustRelease: false, holding: false };

export function resetRevive() {
  squad.clear();
  myRevive.target = "";
  myRevive.mustRelease = false;
}

export function stateOf(id: string) {
  return squad.get(id)?.st ?? UP;
}

/** a hit on this player: a revive in progress stops and R must be pressed again */
export function reviveInterrupted() {
  if (!myRevive.target) return false;
  myRevive.mustRelease = true;
  return true;
}

export type Player = { id: string; x: number; z: number; hp: number; bledOut: boolean };

/**
 * Host: advance the table. `wants` maps reviver id -> target id (who is holding R on whom).
 * Returns what happened this step.
 */
export function hostReviveStep(dt: number, players: Player[], wants: Map<string, string>) {
  const out: { revived: string[]; bled: string[]; changed: boolean } = { revived: [], bled: [], changed: false };
  const byId = new Map(players.map((p) => [p.id, p]));
  for (const id of [...squad.keys()]) if (!byId.has(id)) squad.delete(id);
  for (const p of players) {
    let s = squad.get(p.id);
    if (!s) squad.set(p.id, (s = { st: UP, bleed: 0, prog: 0, by: "" }));
    const before = `${s.st}|${s.by}|${Math.round(s.prog * 20)}|${Math.ceil(s.bleed)}`;
    // just revived: their new health is still on its way over the network
    if (s.grace && s.grace > 0) {
      s.grace -= dt;
      if (p.hp <= 0) continue;
    }
    if (p.hp > 0) {
      s.st = UP;
      s.prog = 0;
      s.by = "";
    } else if (s.st === UP) {
      s.st = p.bledOut ? DEAD : DOWN;
      s.bleed = BLEED_TIME;
      s.prog = 0;
      s.by = "";
    }
    if (s.st === DOWN) {
      // whoever is holding R on me, alive and close enough
      let by = "";
      wants.forEach((tgt, rid) => {
        if (tgt !== p.id || by) return;
        const r = byId.get(rid);
        if (r && r.hp > 0 && Math.hypot(r.x - p.x, r.z - p.z) <= REVIVE_RANGE) by = rid;
      });
      if (by) {
        if (s.by !== by) s.prog = 0;
        s.by = by;
        s.prog += dt / REVIVE_TIME;
        if (s.prog >= 1) {
          s.st = UP;
          s.prog = 0;
          s.by = "";
          s.grace = 1.5;
          out.revived.push(p.id);
        }
      } else {
        s.by = "";
        s.prog = 0;
        s.bleed -= dt;
        if (s.bleed <= 0) {
          s.st = DEAD;
          s.bleed = 0;
          out.bled.push(p.id);
        }
      }
    }
    const after = `${s.st}|${s.by}|${Math.round(s.prog * 20)}|${Math.ceil(s.bleed)}`;
    if (after !== before) out.changed = true;
  }
  return out;
}

/** compact table for the wire: [id, state, bleed tenths, progress %, reviver] per player */
export function squadMsg() {
  const p: (string | number)[][] = [];
  squad.forEach((s, id) => p.push([id, s.st, Math.round(s.bleed * 10), Math.round(s.prog * 100), s.by]));
  return { type: "pst", p };
}
export function applySquadMsg(m: { p?: unknown }) {
  if (!Array.isArray(m.p)) return;
  const seen = new Set<string>();
  for (const row of m.p as unknown[][]) {
    if (!Array.isArray(row)) continue;
    const id = String(row[0]);
    seen.add(id);
    squad.set(id, { st: Number(row[1]) || 0, bleed: (Number(row[2]) || 0) / 10, prog: (Number(row[3]) || 0) / 100, by: String(row[4] ?? "") });
  }
  for (const id of [...squad.keys()]) if (!seen.has(id)) squad.delete(id);
}
