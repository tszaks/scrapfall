import Peer, { type DataConnection } from "peerjs";

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
  hp: number;
  weapon: string;
  color: string;
  /** 1 = host, 2-4 = guests */
  num: number;
  last: number;
  // render smoothing
  rx: number;
  rz: number;
  ry: number;
};

/** player 1 (host) white, player 2 purple, player 3 orange, player 4 pink */
export const PLAYER_COLORS = ["#ffffff", "#a855f7", "#f97316", "#ec4899"];
export const colorFor = (num: number) => PLAYER_COLORS[Math.max(0, Math.min(3, num - 1))]!;

const PREFIX = "dustfield-arena-v1-";
/** player-to-player chatter the host forwards to the other guests */
const RELAYED = new Set(["t", "fire", "pause", "resume", "dep"]);
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

  const handle: NetHandle = {
    role: "host",
    code,
    self: "host",
    broadcast: (m) => {
      const payload = { ...m, from: m.from ?? "host" };
      conns.forEach((c) => { if (c.open) c.send(payload); });
    },
    sendTo: (id, m) => {
      const c = conns.get(id);
      if (c?.open) c.send({ ...m, from: "host" });
    },
    peers: list,
    close: () => { conns.forEach((c) => c.close()); peer.destroy(); },
  };

  peer.on("connection", (conn) => {
    conn.on("open", () => {
      conns.set(conn.peer, conn);
      opts.onPeers(list());
      opts.onMsg({ type: "joined", from: conn.peer });
    });
    conn.on("data", (raw) => {
      const m = { ...(raw as NetMsg), from: conn.peer };
      // relay player-to-player chatter to the other guests
      if (RELAYED.has(m.type)) {
        conns.forEach((c, id) => { if (id !== conn.peer && c.open) c.send(m); });
      }
      opts.onMsg(m);
    });
    const gone = () => {
      conns.delete(conn.peer);
      opts.onPeers(list());
      opts.onMsg({ type: "left", from: conn.peer });
    };
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
    conn.on("open", () => { clearTimeout(t); resolve(); });
    peer.on("error", (e) => { clearTimeout(t); reject(e); });
  });

  conn.on("data", (raw) => opts.onMsg(raw as NetMsg));
  conn.on("close", () => opts.onClose?.());

  const self = peer.id;
  return {
    role: "guest",
    code,
    self,
    broadcast: (m) => { if (conn.open) conn.send({ ...m, from: self }); },
    sendTo: (_id, m) => { if (conn.open) conn.send({ ...m, from: self }); },
    peers: () => ["host"],
    close: () => { conn.close(); peer.destroy(); },
  };
}
