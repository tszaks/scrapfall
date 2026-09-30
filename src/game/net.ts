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

const PREFIX = "scrapfall-arena-v1-";
/** ms of silence before the host lets a guest's slot go */
const HEARTBEAT = 5000;
/** joining rebuilds the whole map, so hold off judging silence at first */
const JOIN_GRACE = 15000;
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
  // a guest that goes quiet is gone: browsers often never fire "close" on a shut tab,
  // and a stale slot used to block the 4th player from ever joining
  const heard = new Map<string, { at: number; opened: number }>();
  const drop = new Map<string, () => void>();
  const beat = setInterval(() => {
    const now = Date.now();
    heard.forEach((t, id) => {
      if (now - t.opened >= JOIN_GRACE && now - t.at > HEARTBEAT) drop.get(id)?.();
    });
    conns.forEach((c) => { if (c.open) c.send({ type: "hb", from: "host" }); });
  }, 1000);

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
    close: () => { clearInterval(beat); conns.forEach((c) => c.close()); peer.destroy(); },
  };

  peer.on("connection", (conn) => {
    conn.on("open", () => {
      // a room holds the host plus three guests
      if (conns.size >= 3) {
        try { conn.send({ type: "full", from: "host" }); } catch { /* already gone */ }
        setTimeout(() => { try { conn.close(); } catch { /* already closed */ } }, 300);
        return;
      }
      conns.set(conn.peer, conn);
      const now = Date.now();
      heard.set(conn.peer, { at: now, opened: now });
      opts.onPeers(list());
      opts.onMsg({ type: "joined", from: conn.peer });
    });
    conn.on("data", (raw) => {
      if (!conns.has(conn.peer)) return; // dropped already
      heard.get(conn.peer)!.at = Date.now();
      if ((raw as NetMsg)?.type === "hb") return;
      const m = { ...(raw as NetMsg), from: conn.peer };
      // relay player-to-player chatter to the other guests
      if (m.type === "t" || m.type === "fire" || m.type === "pause" || m.type === "resume" || m.type === "pick" || m.type === "shard" || m.type === "haz") {
        conns.forEach((c, id) => { if (id !== conn.peer && c.open) c.send(m); });
      }
      opts.onMsg(m);
    });
    const gone = () => {
      if (conns.get(conn.peer) !== conn) return; // already dropped or replaced
      conns.delete(conn.peer);
      heard.delete(conn.peer);
      drop.delete(conn.peer);
      opts.onPeers(list());
      opts.onMsg({ type: "left", from: conn.peer });
      try { conn.close(); } catch { /* already closed */ }
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
    conn.on("open", () => { clearTimeout(t); resolve(); });
    peer.on("error", (e) => { clearTimeout(t); reject(e); });
  });

  // the host answers a fourth guest with "full" right after the link opens
  let full = false;
  const early = (raw: unknown) => { if ((raw as NetMsg)?.type === "full") full = true; };
  conn.on("data", early);
  await new Promise<void>((r) => setTimeout(r, 700));
  conn.off("data", early);
  if (full) {
    try { conn.close(); } catch { /* already closed */ }
    peer.destroy();
    throw new Error("That arena is already full");
  }

  // the host chatters constantly; a long silence means the room is gone
  const openedAt = Date.now();
  let heardAt = openedAt;
  let closed = false;
  const lost = () => {
    if (closed) return;
    closed = true;
    clearInterval(beat);
    opts.onClose?.();
  };
  const beat = setInterval(() => {
    const now = Date.now();
    if (now - openedAt >= JOIN_GRACE && now - heardAt > HEARTBEAT + 3000) lost();
    else if (conn.open) conn.send({ type: "hb", from: peer.id });
  }, 1000);

  conn.on("data", (raw) => {
    heardAt = Date.now();
    if ((raw as NetMsg)?.type === "hb") return;
    opts.onMsg(raw as NetMsg);
  });
  conn.on("close", lost);


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
