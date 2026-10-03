import test from "node:test";
import assert from "node:assert/strict";
import { rolldown } from "rolldown";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
const fake = `import {EventEmitter} from 'node:events';
const peers=globalThis.__scrapfallRoomTestPeers??=new Map();
class Conn extends EventEmitter {
 constructor(peer,metadata){super();this.peer=peer;this.metadata=metadata;this.open=false;}
 send(m){const other=this.other;if(this.open&&other?.open)queueMicrotask(()=>other.emit('data',structuredClone(m)));}
 close(){if(!this.open)return;this.open=false;this.emit('close');if(this.other?.open){this.other.open=false;this.other.emit('close');}}
}
export default class Peer extends EventEmitter {
 constructor(id){super();this.id=id;this.open=false;this.destroyed=false;this.connections=[];setTimeout(()=>{if(peers.has(id))this.emit('error',{type:'unavailable-id'});else{peers.set(id,this);this.open=true;this.emit('open',id);}},0);}
 connect(id,options){const c=new Conn(id,options?.metadata);this.connections.push(c);setTimeout(()=>{const target=peers.get(id);if(!target){this.emit('error',{type:'peer-unavailable'});return;}const other=new Conn(this.id,options?.metadata);c.other=other;other.other=c;target.connections.push(other);target.emit('connection',other);c.open=other.open=true;other.emit('open');c.emit('open');},0);return c;}
 destroy(){this.destroyed=true;this.open=false;if(peers.get(this.id)===this)peers.delete(this.id);this.connections.forEach(c=>c.close());}
 reconnect(){}
}`;
async function buildNet(development) {
  const bundle = await rolldown({
    input: "src/game/net.ts",
    platform: "node",
    plugins: [
      {
        name: "local-peer-test",
        transform(code, id) {
          if (id.endsWith("/net.ts"))
            return code.replaceAll(
              "import.meta.env?.MODE",
              JSON.stringify(development ? "development" : "production"),
            );
        },
        resolveId(id) {
          if (id === "peerjs") return "\0peer";
          if (id === "./iceServers") return "\0ice";
        },
        load(id) {
          if (id === "\0peer") return fake;
          if (id === "\0ice") return "export async function loadIceServers(){return []}";
        },
      },
    ],
  });
  const { output } = await bundle.generate({ format: "esm" });
  await bundle.close();
  const dir = await mkdtemp(`${tmpdir()}/scrapfall-room-test-`);
  await writeFile(`${dir}/net.mjs`, output[0].code);
  return import(pathToFileURL(`${dir}/net.mjs`));
}
const net = await buildNet(false);
const devNet = await buildNet(true);
const wait = async (fn, ms = 12000) => {
  const start = Date.now();
  while (!fn()) {
    assert.ok(Date.now() - start < ms, "recovery exceeded deadline");
    await new Promise((r) => setTimeout(r, 20));
  }
};
test("host departure keeps code, elects one survivor, reconnects others and accepts a new join", async () => {
  const handles = [],
    logs = [[], [], [], []];
  const opts = (i) => ({
    onMsg: (m) => logs[i].push(m),
    onPeers: () => {},
    onClose: () => logs[i].push({ type: "failed" }),
  });
  try {
    const h = await net.hostRoom(opts(0));
    handles.push(h);
    const a = await net.joinRoom(h.code, opts(1));
    handles.push(a);
    const b = await net.joinRoom(h.code, opts(2));
    handles.push(b);
    await wait(() => h.peers().length === 2);
    await new Promise((r) => setTimeout(r, 20));
    h.close();
    await wait(() => a.role === "host" || b.role === "host");
    const successor = a.role === "host" ? a : b,
      other = successor === a ? b : a;
    await wait(() => successor.peers().length === 1);
    assert.equal(successor.code, h.code);
    assert.equal(other.role, "guest");
    other.broadcast({ type: "t", x: 42 });
    await wait(() => logs[successor === a ? 1 : 2].some((m) => m.type === "t" && m.x === 42));
    const c = await net.joinRoom(h.code, opts(3));
    handles.push(c);
    await wait(() => successor.peers().length === 2);
    assert.equal(
      logs.flat().some((m) => m.type === "failed"),
      false,
    );
  } finally {
    handles.forEach((h) => h.close());
    await new Promise((r) => setTimeout(r, 150));
  }
});
test("exact code validation rejects transcribed five-character codes", async () => {
  await assert.rejects(
    () => net.joinRoom("FZM4M", { onMsg: () => {}, onPeers: () => {} }),
    /four-character/,
  );
});

test("a public client cannot join a development room by its code", async () => {
  const opts = { onMsg: () => {}, onPeers: () => {} };
  const host = await devNet.hostRoom(opts);
  let guest;
  try {
    await assert.rejects(() => net.joinRoom(host.code, opts));
    guest = await devNet.joinRoom(host.code, opts);
    await wait(() => host.peers().length === 1);
    assert.equal(guest.role, "guest");
  } finally {
    guest?.close();
    host.close();
  }
});
