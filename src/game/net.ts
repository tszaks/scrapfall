import Peer, { type DataConnection } from "peerjs";
import { connectionTimedOut } from "./netHeartbeat";
import { loadIceServers } from "./iceServers";
import { CONNECT_TIMEOUT, joinFailure } from "./joinErrors";

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
  rs?: number;
  ski?: boolean;
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
// v9 clears Pier door approaches and grades Whiteout entrance thresholds.
// v10 rebuilds Dry Gulch as a multi-district boomtown (new street grid, decks, districts)
// v11 brings in Toby's 1.0.3-1.0.6: hazards, endless overtime, shard and stat fixes
// — all new or changed messages, so rooms split from v9/v10 clients.
// v12 keeps lane clutter and door approaches out of Dry Gulch's generated town,
// so host and guest would disagree on props with v11 peers.
// v13 re-tunes movement, enemy chase speed and hazard warning windows.
// v14 adds effective shot spread and retunes player projectile speed and lifetime.
// v15 ground enemies collide with traffic and rendered map geometry.
// v16 raises player movement to a middle pace while retaining enemy chase speeds.
// v17 preserves corpse positions and adds playtest recovery, shared rides and ping removal.
// v18 isolates development maps and rooms from the public build.
// v19 updates public-map environmental geometry for the realism pass.
// v20 updates public-map vegetation and construction detail geometry.
// v21 adds lower-facade relief and denser branched crowns without changing navigation.
// v22 replaces Whiteout spruce and adds chalet construction detail.
// Development rooms use a separate namespace: a public peer must never join a
// developer's Nuketown room and build a different map from the same seed.
const PREFIX = import.meta.env?.DEV ? "scrapfall-dev-arena-v22-" : "scrapfall-ts-arena-v22-";
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

/** A room retains its code when authority moves to a surviving guest. The public
 * PeerJS id is a single-writer lease: only one survivor can claim it. */
async function room(code: string, initialHost: boolean, opts: Opts): Promise<NetHandle> {
  const iceServers = await loadIceServers();
  const roomId = PREFIX + code;
  const guestId = roomId + "-" + Math.random().toString(36).slice(2, 10);
  let peer: Peer;
  let upstream: DataConnection | null = null;
  let stopped = false;
  let recovering = false;
  let recoveryFailed = false;
  let members: string[] = [];
  let heardAt = performance.now();
  let openedAt = heardAt;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const conns = new Map<string, DataConnection>();
  const heard = new Map<string, number>();
  const send = (c: DataConnection | null, m: NetMsg) => { if (c?.open) c.send(m); };
  const handle: NetHandle = {
    role: initialHost ? "host" : "guest", code, self: initialHost ? "host" : guestId,
    broadcast: m => {
      const payload = {...m, from: handle.self};
      if (handle.role === "host") conns.forEach(c => send(c,payload));
      else send(upstream,payload);
    },
    sendTo: (id,m) => handle.role === "host" ? send(conns.get(id) ?? null,{...m,from:"host"}) : send(upstream,{...m,from:handle.self}),
    peers: () => handle.role === "host" ? [...conns.keys()] : ["host"],
    close: () => {
      if(stopped) return;
      stopped=true; clearInterval(beat); clearTimeout(retry);
      // Graceful exit gives peers the same immediate signal as a lost connection.
      if(handle.role === "host") conns.forEach(c=>send(c,{type:"handoff",from:"host",members:[...conns.keys()].sort()}));
      setTimeout(()=>{upstream?.close();conns.forEach(c=>c.close());peer?.destroy()},100);
    },
  };
  const publish = () => {
    members=[...conns.keys()].sort();
    conns.forEach(c=>send(c,{type:"members",members,from:"host"}));
    opts.onPeers(members);
  };
  const accept = (conn: DataConnection) => {
    conn.on("open",()=>{
      if(stopped || conns.size>=3) { conn.close(); return; }
      conns.set(conn.peer,conn); heard.set(conn.peer,performance.now()); publish();
      opts.onMsg({type:"joined",from:conn.peer,recovering:conn.metadata?.recovering===true});
    });
    conn.on("data",raw=>{
      if(conns.get(conn.peer)!==conn) return;
      heard.set(conn.peer,performance.now());
      const m={...(raw as NetMsg),from:conn.peer};
      if(m.type==="hb") return;
      if(RELAYED.has(m.type)) conns.forEach((c,id)=>{if(id!==conn.peer)send(c,m)});
      opts.onMsg(m);
    });
    const gone=()=>{
      if(conns.get(conn.peer)!==conn)return;
      conns.delete(conn.peer);heard.delete(conn.peer);publish();opts.onMsg({type:"left",from:conn.peer});conn.close();
    };
    conn.on("close",gone);conn.on("error",gone);
  };
  const openPeer = (id: string) => new Promise<Peer>((resolve,reject)=>{
    const p=new Peer(id,{debug:0,config:{iceServers}});
    const timeout=setTimeout(()=>{p.destroy();reject(new Error("Signalling timeout"))},12000);
    p.on("open",()=>{clearTimeout(timeout);resolve(p)});
    p.on("connection",accept);
    p.on("error",err=>{clearTimeout(timeout); if(!p.open){p.destroy();reject(err)}});
    p.on("disconnected",()=>{if(!stopped && !p.destroyed) p.reconnect()});
  });
  const connect = (resume: boolean) => new Promise<void>((resolve,reject)=>{
    const c=peer.connect(roomId,{reliable:true,metadata:{recovering:resume}});
    let settled=false;
    const timeout=setTimeout(()=>{c.close();reject(joinFailure(CONNECT_TIMEOUT,"Connection timed out"))},12000);
    c.on("open",()=>{
      if(stopped){c.close();return;}
      settled=true;clearTimeout(timeout);upstream=c;heardAt=openedAt=performance.now();
      if(recovering){recovering=false;opts.onMsg({type:"reconnected"});send(c,{type:"world-ready"})}
      resolve();
    });
    c.on("data",raw=>{
      heardAt=performance.now(); const m=raw as NetMsg;
      if(m.type==="members"){members=Array.isArray(m.members)?m.members.filter((x:unknown)=>typeof x==="string"):[];return;}
      if(m.type==="handoff"){members=m.members??members;lost();return;}
      if(m.type!=="hb") opts.onMsg(m);
    });
    c.on("error",err=>{clearTimeout(timeout);if(!settled)reject(err);else lost()});
    c.on("close",()=>{clearTimeout(timeout);if(!settled)reject(new Error("Room closed"));else lost()});
    // peer-unavailable is emitted on Peer, not DataConnection.
    const failed=(err: unknown)=>{if(!settled){clearTimeout(timeout);reject(err)}};
    peer.once("error",failed);
    c.on("open",()=>peer.off("error",failed));
  });
  let attempt=0;
  const recover = async () => {
    if(stopped || !recovering)return;
    attempt++;
    const rank=Math.max(0,members.indexOf(guestId));
    try {
      // First attempt reconnects a transiently lost guest to the existing host.
      if(attempt===1 || attempt%2===1) await connect(true);
      else {
        // Stagger the claim. If the first candidate also left, the next one takes over.
        await new Promise(r=>setTimeout(r,rank*1200));
        if(stopped || !recovering)return;
        const replacement=await openPeer(roomId);
        if(stopped){replacement.destroy();return;}
        peer.destroy();peer=replacement;upstream=null;
        const oldSelf=handle.self;handle.role="host";handle.self="host";recovering=false;
        opts.onMsg({type:"authority",oldSelf});
        publish();
      }
    } catch {
      if(stopped)return;
      if(attempt>=8){recovering=false;recoveryFailed=true;opts.onClose?.();return;}
      retry=setTimeout(()=>void recover(),1000);
    }
  };
  const lost=()=>{
    if(stopped || recovering || recoveryFailed || handle.role==="host")return;
    recovering=true;attempt=0;upstream=null;
    opts.onMsg({type:"reconnecting"});
    retry=setTimeout(()=>void recover(),300);
  };
  const beat=setInterval(()=>{
    if(stopped)return;
    const now=performance.now();
    if(handle.role==="host") conns.forEach((c,id)=>{
      if(now-(heard.get(id)??now)>15000)c.close();else send(c,{type:"hb",from:"host"});
    });
    else if(!recovering && !recoveryFailed){
      if(connectionTimedOut(now,heardAt,openedAt,HEARTBEAT+3000))lost();
      else send(upstream,{type:"hb"});
    }
  },1000);
  try {
    peer=await openPeer(initialHost?roomId:guestId);
    if(!initialHost)await connect(false);
    return handle;
  }catch(err){stopped=true;clearInterval(beat);peer!?.destroy();throw err;}
}
export async function hostRoom(opts: Opts): Promise<NetHandle> { return room(makeCode(),true,opts); }
export async function joinRoom(code: string, opts: Opts): Promise<NetHandle> {
  const normalized=code.trim().toUpperCase();
  if(!/^[A-HJ-NP-Z2-9]{4}$/.test(normalized))throw new Error("Enter the exact four-character room code.");
  return room(normalized,false,opts);
}
