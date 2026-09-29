import Peer, { type DataConnection } from "peerjs";
import { connectionTimedOut } from "./netHeartbeat";

// loose on purpose: messages are tiny ad-hoc payloads
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NetMsg = any;

export type NetHandle = {
  role: "host" | "guest";
  code: string;
  self: string;
  /** host: send to every guest. guest: send to the host. */
  broadcast: (m: NetMsg) => void;
  sendTo: (id: string, m: NetMsg) => void;
  peers: () => string[];
  close: () => void;
};

export type RemoteState = {
  id: string;
  x: number;
  z: number;
  yaw: number;
  pitch?: number;
  hp: number;
  weapon: string;
  color: string;
  /** 1 = host, 2-4 = guests */
  num: number;
  /** building access: zone code (0 street; see access/world.ts) and floor height */
  az?: number;
  /** building access: elevator button presses so far (the host compares counts) */
  ap?: number;
  ay?: number | undefined;
  /** Explicit support height on an open structure; sn marks an upper lookout. */
  sy?: number | undefined;
  sn?: number;
  /** mid-jump: feet above the ground (m), 0 on foot (input/movement.ts) */
  jy?: number;
  /** alpine: the chairlift chair this player is riding, -1 on foot */
  rc?: number;
  /** Pacific Pier Ferris cabin, -1 on foot. */
  wr?: number;
  last: number;
  // render smoothing
  rx: number;
  rz: number;
  ry: number;
};

/** player 1 (host) white, player 2 purple, player 3 orange, player 4 pink */
export const PLAYER_COLORS = ["#ffffff", "#a855f7", "#f97316", "#ec4899"];
export const colorFor = (num: number) => PLAYER_COLORS[Math.max(0, Math.min(3, num - 1))]!;

// Scrapfall name, but a distinct room namespace: Toby's plain 1.0.2 build and this
// big-map build speak different message sets, so they must not join each other's rooms.
// v5 adds rendered-shape physics and persistent shared tumbleweeds. Older clients
// have different physical maps and cannot interpret that state; keep rooms separate.
// v6 adds shared match weather, ballistic trajectories, Longshot and the fifth map.
// v7 reserves generated doorway approaches and aligns physical door/window openings.
// v8 furnishes Pier/Whiteout interiors and adds pier activities
// v9 brings in Toby's 1.0.3/1.0.4: shootable hazards, endless overtime mutators,
// single-use shards and per-player kill credit — all new or changed messages.
const PREFIX = "scrapfall-ts-arena-v9-";
/** ms without a word from a guest before the host drops it */
const HEARTBEAT = 5000;
/** player-to-player chatter the host forwards to the other guests */
const RELAYED = new Set(["t", "fire", "pause", "resume", "dep", "ping", "pick", "shard", "haz"]);
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeCode() {
  let s = "";
  for (let i = 0; i < 4; i++) s += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  return s;
}

type Opts = {
  onMsg: (m: NetMsg) => void;
  onPeers: (ids: string[]) => void;
  onClose?: () => void;
};

export async function hostRoom(opts: Opts): Promise<NetHandle> {
  const code = makeCode();
  const peer = new Peer(PREFIX + code, { debug: 0 });
  await new Promise<void>((resolve, reject) => {
    peer.on("open", () => resolve());
    peer.on("error", (e) => reject(e));
  });

  const conns = new Map<string, DataConnection>();
  const list = () => [...conns.keys()];
  // After the initial world-loading grace, a guest silent for5s is gone.
  // A closed tab often never sends PeerJS "close"; guests normally send at20Hz.
  const heard = new Map<string, { at: number; opened: number }>();
  const drop = new Map<string, () => void>();
  const beat = setInterval(() => {
    const now = performance.now();
    heard.forEach((t, id) => {
      if (connectionTimedOut(now, t.at, t.opened, HEARTBEAT)) drop.get(id)?.();
    });
    // keep-alive both ways, also while menus / pause stop the game's own traffic
    conns.forEach((c) => {
      if (c.open) c.send({ type: "hb", from: "host" });
    });
  }, 1000);

  const handle: NetHandle = {
    role: "host",
    code,
    self: "host",
    broadcast: (m) => {
      const payload = { ...m, from: m.from ?? "host" };
      conns.forEach((c) => {
        if (c.open) c.send(payload);
      });
    },
    sendTo: (id, m) => {
      const c = conns.get(id);
      if (c?.open) c.send({ ...m, from: "host" });
    },
    peers: list,
    close: () => {
      clearInterval(beat);
      conns.forEach((c) => c.close());
      peer.destroy();
    },
  };

  peer.on("connection", (conn) => {
    conn.on("open", () => {
      conns.set(conn.peer, conn);
      const now = performance.now();
      heard.set(conn.peer, { at: now, opened: now });
      opts.onPeers(list());
      opts.onMsg({ type: "joined", from: conn.peer });
    });
    conn.on("data", (raw) => {
      if (!conns.has(conn.peer)) return; // timed out already
      heard.get(conn.peer)!.at = performance.now();
      if ((raw as NetMsg)?.type === "hb") return;
      const m = { ...(raw as NetMsg), from: conn.peer };
      // relay player-to-player chatter to the other guests
      if (RELAYED.has(m.type)) {
        conns.forEach((c, id) => {
          if (id !== conn.peer && c.open) c.send(m);
        });
      }
      opts.onMsg(m);
    });
    const gone = () => {
      if (conns.get(conn.peer) !== conn) return; // already dropped (or replaced)
      conns.delete(conn.peer);
      heard.delete(conn.peer);
      drop.delete(conn.peer);
      opts.onPeers(list());
      opts.onMsg({ type: "left", from: conn.peer });
      try {
        conn.close();
      } catch {
        /* already closed */
      }
    };
    drop.set(conn.peer, gone);
    conn.on("close", gone);
    conn.on("error", gone);
  });

  return handle;
}

export async function joinRoom(code: string, opts: Opts): Promise<NetHandle> {
  const peer = new Peer(PREFIX + code + "-" + Math.random().toString(36).slice(2, 8), { debug: 0 });
  await new Promise<void>((resolve, reject) => {
    peer.on("open", () => resolve());
    peer.on("error", (e) => reject(e));
  });
  const conn = peer.connect(PREFIX + code, { reliable: false });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("No arena with that code")), 12000);
    conn.on("open", () => {
      clearTimeout(t);
      resolve();
    });
    peer.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
  });

  // heartbeat: the host streams snapshots many times a second; 8 s of silence = it's gone
  const openedAt = performance.now();
  let heardAt = openedAt;
  let closed = false;
  const lost = () => {
    if (closed) return;
    closed = true;
    clearInterval(beat);
    opts.onClose?.();
  };
  const beat = setInterval(() => {
    if (connectionTimedOut(performance.now(), heardAt, openedAt, HEARTBEAT + 3000)) lost();
    else if (conn.open) conn.send({ type: "hb" });
  }, 1000);
  conn.on("data", (raw) => {
    heardAt = performance.now();
    if ((raw as NetMsg)?.type === "hb") return;
    opts.onMsg(raw as NetMsg);
  });
  conn.on("close", lost);

  const self = peer.id;
  return {
    role: "guest",
    code,
    self,
    broadcast: (m) => {
      if (conn.open) conn.send({ ...m, from: self });
    },
    sendTo: (_id, m) => {
      if (conn.open) conn.send({ ...m, from: self });
    },
    peers: () => ["host"],
    close: () => {
      closed = true;
      clearInterval(beat);
      conn.close();
      peer.destroy();
    },
  };
}
