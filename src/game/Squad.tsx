import { useSimulationFrame as useFrame } from "./useSimulationFrame";
import { avState, AV_WARN, runAt } from "./events/avalanche";
import { actionLabel } from "./input/labels";
import { subscribeActions, subscribeInputReset } from "./input/remap";
import { presentationCamera } from "./PlayerView";
// Co-op squad play: pings (middle mouse or G) and downed / revive (hold R), plus the HUD
// layer that draws them over the 3D view (world-anchored markers, the downed teammates'
// direction and distance, the revive ring, the map-event banner).
import { moveState } from "./input/movement";
import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import { mapEvent } from "./events/mapEvents";
import { playDowned, playPing, playRevive } from "./events/sfx";
import { colorFor, type NetHandle, type RemoteState } from "./net";
import { groundY } from "./terrain";
import { touchInput } from "./touch";
import { aimPing, pingFromMsg, pingMsg, pings, tickPings, type PingWorld } from "./ping";
import {
  DOWN,
  REVIVE_RANGE,
  UP,
  applySquadMsg,
  hostReviveStep,
  me,
  myRevive,
  squad,
  squadMsg,
  type Player,
} from "./revive";

import { hostWants, hudToast, hudView, resetSquad } from "./squadState";

/**
 * Inside the canvas: reads the ping and revive keys, runs the host's revive table and
 * feeds the HUD. `self` carries this player's health and state (from the Game).
 */
export function SquadDriver({
  net,
  remotes,
  self,
  world,
  myNum,
  onRevived,
  onBleedOut,
}: {
  net: NetHandle | null;
  remotes: React.MutableRefObject<Map<string, RemoteState>>;
  self: React.MutableRefObject<{ hp: number; bledOut: boolean; playing: boolean }>;
  world: React.MutableRefObject<PingWorld | null>;
  myNum: number;
  onRevived: () => void;
  onBleedOut: () => void;
}) {
  const camera = useThree((s) => s.camera);
  const pingReq = useRef(false);
  const holdR = useRef(false);

  const cb = useRef({ onRevived, onBleedOut, net, myNum });
  cb.current = { onRevived, onBleedOut, net, myNum };
  useEffect(
    () =>
      subscribeActions((a, down, repeat) => {
        if (a === "ping" && down && !repeat) pingReq.current = true;
        if (a === "revive") holdR.current = down;
      }),
    [],
  );

  useEffect(
    () =>
      subscribeInputReset(() => {
        pingReq.current = false;
        holdR.current = false;
      }),
    [],
  );
  useEffect(() => {
    me.id = net?.self ?? "host";
    if (!net) resetSquad();
  }, [net]);

  const sendT = useRef(0);
  const lastSelf = useRef(UP);
  useFrame((_, raw) => {
    // real seconds (bleed-outs and revives shouldn't stretch when the host's frames dip)
    const dt = Math.min(raw, 0.25);
    hudView.camera = presentationCamera(camera);
    me.x = camera.position.x;
    me.z = camera.position.z;
    me.y = moveState.feet;
    const n = cb.current.net;
    const s = self.current;
    const w = world.current;
    // ---- touch buttons (MobileControls): PING, hold REVIVE ----
    if (touchInput.ping) {
      touchInput.ping = false;
      pingReq.current = true;
    }
    const reviveHeld = holdR.current || touchInput.revive;
    // ---- pings ----
    if (w) tickPings(w.enemies, w.ground, w.band);
    if (pingReq.current) {
      pingReq.current = false;
      if (w && s.playing && s.hp > 0) {
        const p = aimPing(presentationCamera(camera), w, me.id, cb.current.myNum);
        if (p) {
          playPing(p.kind === "enemy", true);
          n?.broadcast(pingMsg(p));
        }
      }
    }
    if (!n) return;
    // ---- revive: hold R next to a downed teammate ----
    let want = "";
    // (never while sprinting: input/movement.ts; holding revive also stops the sprint)
    if (reviveHeld && s.hp > 0 && s.playing && !myRevive.mustRelease && !moveState.sprinting) {
      let bd = REVIVE_RANGE;
      remotes.current.forEach((r) => {
        if (squad.get(r.id)?.st !== DOWN) return;
        const d = Math.hypot(r.x - me.x, (r.sy ?? r.ay ?? groundY(r.x, r.z)) - me.y, r.z - me.z);
        if (d <= bd) {
          bd = d;
          want = r.id;
        }
      });
    }
    if (!reviveHeld) myRevive.mustRelease = false;
    myRevive.holding = reviveHeld;
    if (want !== myRevive.target) {
      myRevive.target = want;
      if (n.role === "host") {
        if (want) hostWants.set("host", want);
        else hostWants.delete("host");
      } else n.broadcast({ type: "rv", id: want, on: want ? 1 : 0 });
    }
    // ---- host: the squad table ----
    if (n.role === "host") {
      const now = performance.now();
      const players: Player[] = [
        { id: "host", x: me.x, y: me.y, z: me.z, hp: s.hp, bledOut: s.bledOut },
      ];
      remotes.current.forEach((r) => {
        if (now - r.last < 4000)
          players.push({
            id: r.id,
            x: r.x,
            y: r.sy ?? r.ay ?? groundY(r.x, r.z),
            z: r.z,
            hp: r.hp,
            bledOut: false,
          });
      });
      const res = hostReviveStep(dt, players, hostWants);
      for (const id of res.revived) {
        if (id === "host") cb.current.onRevived();
        else n.sendTo(id, { type: "revived" });
      }
      for (const id of res.bled) {
        if (id === "host") cb.current.onBleedOut();
        else n.sendTo(id, { type: "bleed" });
      }
      const anyDown = [...squad.values()].some((q) => q.st !== UP);
      sendT.current -= dt;
      if (res.changed || (anyDown && sendT.current <= 0)) {
        sendT.current = 0.2;
        n.broadcast(squadMsg());
      }
    }
    // going down: a sting
    const mine = squad.get(me.id)?.st ?? UP;
    if (mine === DOWN && lastSelf.current !== DOWN) playDowned();
    if (mine === UP && lastSelf.current === DOWN) playRevive();
    lastSelf.current = mine;
  });
  return null;
}

// ---------------------------------------------------------------------------------------
// HUD: markers over the 3D view

const MAX_PINGS = 12;
const MAX_DOWN = 3;
const _v = new THREE.Vector3();
const _q = new THREE.Vector3();

type Proj = { x: number; y: number; on: boolean; dist: number };
function project(
  cam: THREE.Camera,
  x: number,
  y: number,
  z: number,
  W: number,
  H: number,
  out: Proj,
) {
  _v.set(x, y, z);
  out.dist = cam.position.distanceTo(_v);
  _q.copy(_v).applyMatrix4(cam.matrixWorldInverse);
  const behind = _q.z > -0.1;
  _v.project(cam);
  let nx = _v.x;
  let ny = _v.y;
  if (behind) {
    nx = -nx;
    ny = -ny;
    if (Math.abs(nx) < 1e-3 && Math.abs(ny) < 1e-3) ny = -1;
  }
  const on = !behind && Math.abs(nx) < 0.96 && Math.abs(ny) < 0.94;
  if (!on) {
    // pin to the screen edge, in the right direction
    const m = Math.max(Math.abs(nx) / 0.92, Math.abs(ny) / 0.86, 1e-3);
    nx /= m;
    ny /= m;
  }
  out.x = (nx * 0.5 + 0.5) * W;
  out.y = (-ny * 0.5 + 0.5) * H;
  out.on = on;
  return out;
}

const KIND_ICON: Record<string, string> = {
  enemy: "◆",
  loc: "▼",
  gun: "■",
  heal: "✚",
  crate: "▣",
  elev: "⇅",
};

export function HudOverlay({
  remotes,
  active,
  coop,
  numOf,
}: {
  remotes: React.MutableRefObject<Map<string, RemoteState>>;
  active: boolean;
  coop: boolean;
  numOf: (id: string) => number;
}) {
  const teamEls = useRef<(HTMLDivElement | null)[]>([]);
  const compassEl = useRef<HTMLDivElement>(null);
  const hazardEl = useRef<HTMLDivElement>(null);
  const pingEls = useRef<(HTMLDivElement | null)[]>([]);
  const boxEls = useRef<(HTMLDivElement | null)[]>([]);
  const downEls = useRef<(HTMLDivElement | null)[]>([]);
  const promptEl = useRef<HTMLDivElement>(null);
  const selfEl = useRef<HTMLDivElement>(null);
  const bannerEl = useRef<HTMLDivElement>(null);
  const toastEl = useRef<HTMLDivElement>(null);
  const ringEl = useRef<SVGCircleElement>(null);
  const selfRingEl = useRef<SVGCircleElement>(null);
  const state = useRef({ active, coop, numOf });
  state.current = { active, coop, numOf };

  useEffect(() => {
    let raf = 0;
    const P: Proj = { x: 0, y: 0, on: false, dist: 0 };
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cam = hudView.camera;
      const W = window.innerWidth;
      const H = window.innerHeight;
      const { active: on, coop: co, numOf: num } = state.current;
      const now = performance.now();
      const compass = compassEl.current;
      if (compass) {
        compass.style.display = on && cam ? "block" : "none";
        if (cam && on) {
          cam.getWorldDirection(_q);
          const bearing = (Math.atan2(_q.x, -_q.z) * 180 / Math.PI + 360) % 360;
          const label = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(bearing / 45) % 8];
          const text = `${label} · ${Math.round(bearing)}°`;
          if (compass.textContent !== text) compass.textContent = text;
        }
      }
      let teamCount = 0;
      if (on && co && cam) remotes.current.forEach(r => {
        if (now - r.last > 5000 || r.hp <= 0 || teamCount >= MAX_DOWN) return;
        const el = teamEls.current[teamCount++];
        if (!el) return;
        project(cam, r.x, (r.sy ?? r.ay ?? groundY(r.x, r.z)) + 2.5 + (r.jy ?? 0), r.z, W, H, P);
        el.style.display = "block";
        el.style.transform = `translate(${Math.max(90, Math.min(W-90, P.x))}px, ${Math.max(110, Math.min(H-80, P.y))}px) translate(-50%,-100%)`;
        el.style.setProperty("--pc", colorFor(num(r.id)));
        const text = `${P.on ? "◆" : "➤"} P${num(r.id)} · ${Math.round(P.dist)}m`;
        if (el.textContent !== text) el.textContent = text;
      });
      for (let i=teamCount;i<MAX_DOWN;i++) if(teamEls.current[i]) teamEls.current[i]!.style.display="none";
      const hazard = hazardEl.current;
      const plan = avState.plan;
      if (hazard) {
        hazard.style.display = on && cam && plan ? "block" : "none";
        if (on && cam && plan) {
          const front = runAt(plan, Math.max(0,avState.front));
          project(cam, front.x, groundY(front.x,front.z)+4, front.z, W,H,P);
          hazard.style.transform = `translate(${Math.max(130,Math.min(W-130,P.x))}px, ${Math.max(140,Math.min(H-100,P.y))}px) translate(-50%,-50%)`;
          const bearing=(Math.atan2(front.x-cam.position.x,cam.position.z-front.z)*180/Math.PI+360)%360;
          const dir=["N","NE","E","SE","S","SW","W","NW"][Math.round(bearing/45)%8];
          const text=avState.t<AV_WARN ? `⚠ AVALANCHE ${dir} · ${Math.ceil(AV_WARN-avState.t)}s · LEAVE ${plan.name}` : avState.front<plan.total ? `⚠ SNOW FRONT ${dir} · ${Math.round(P.dist)}m` : "SNOW SETTLING · KEEP CLEAR";
          if(hazard.textContent!==text) hazard.textContent=text;
        }
      }
      // ---- pings ----
      for (let i = 0; i < MAX_PINGS; i++) {
        const el = pingEls.current[i];
        const box = boxEls.current[i];
        const p = pings[i];
        if (!el || !box) continue;
        if (!p || !cam || !on) {
          // (skip the DOM write when already hidden: style sets are not free, and this
          // loop used to touch every slot every frame)
          if (el.style.display !== "none") el.style.display = "none";
          if (box.style.display !== "none") box.style.display = "none";
          continue;
        }
        project(cam, p.x, p.y + (p.kind === "enemy" ? 0.35 : 0.6), p.z, W, H, P);
        P.dist=cam.position.distanceTo(_v.set(p.x,p.y,p.z));
        const col = colorFor(p.num);
        const age = (now - p.born) / 1000;
        const fade = Math.min(1, (p.life - age) / 0.8);
        el.style.display = "block";
        el.style.opacity = String(Math.max(0, fade));
        const px = P.on ? P.x : Math.min(W - 70, Math.max(70, P.x));
        const py = P.on ? P.y : Math.min(H - 20, Math.max(40, P.y));
        el.style.transform = `translate(${px}px, ${py}px) translate(-50%, -100%) scale(${age < 0.25 ? 1.6 - age * 2.4 : 1})`;
        el.style.setProperty("--pc", col);
        const label = p.kind === "loc" ? "" : p.label;
        el.dataset["kind"] = p.kind;
        const txt = `${KIND_ICON[p.kind] ?? "◆"} ${label}${label ? " · " : ""}${Math.round(P.dist)}m · ${Math.max(0, Math.ceil(p.life-age))}s`;
        if (el.textContent !== txt) el.textContent = txt;
        // enemy: corner brackets round the body
        if (p.kind === "enemy" && P.on) {
          const top = { ...P };
          project(cam, p.x, p.y, p.z, W, H, top);
          const foot = { ...P };
          const gy = p.y - 2.2;
          project(cam, p.x, gy, p.z, W, H, foot);
          const h = Math.max(18, Math.abs(foot.y - top.y) * 1.15);
          const w = h * 0.7;
          box.style.display = "block";
          box.style.opacity = String(Math.max(0, fade));
          box.style.width = `${w}px`;
          box.style.height = `${h}px`;
          box.style.transform = `translate(${top.x - w / 2}px, ${top.y - h * 0.06}px)`;
          box.style.setProperty("--pc", col);
        } else box.style.display = "none";
      }
      // ---- downed teammates: where they are and how long they have ----
      let k = 0;
      let prompt = "";
      let promptProg = 0;
      if (co && cam && on) {
        remotes.current.forEach((r) => {
          const s = squad.get(r.id);
          if (!s || s.st !== DOWN || k >= MAX_DOWN) return;
          const el = downEls.current[k++];
          if (!el) return;
          project(cam, r.x, (r.sy ?? r.ay ?? groundY(r.x, r.z)) + 0.8, r.z, W, H, P);
          el.style.display = "flex";
          // off screen: pinned to the edge, kept whole
          const px = P.on ? P.x : Math.min(W - 130, Math.max(130, P.x));
          const py = P.on ? P.y : Math.min(H - 24, Math.max(24, P.y));
          el.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
          el.style.setProperty("--pc", colorFor(num(r.id)));
          const who = num(r.id) === 1 ? "HOST" : `P${num(r.id)}`;
          const txt = `✚ ${who} DOWN · ${Math.round(P.dist)}m · ${Math.ceil(s.bleed)}s${s.by ? " · REVIVING" : ""}`;
          if (el.textContent !== txt) el.textContent = txt;
          el.style.opacity = P.on ? "1" : "0.85";
          const d = Math.hypot(r.x - me.x, (r.sy ?? r.ay ?? groundY(r.x, r.z)) - me.y, r.z - me.z);
          if (d <= REVIVE_RANGE && !prompt) {
            prompt =
              s.by === me.id ? `REVIVING ${who}` : `HOLD ${actionLabel("revive")} TO REVIVE ${who}`;
            promptProg = s.by === me.id ? s.prog : 0;
          }
        });
      }
      for (let i = k; i < MAX_DOWN; i++) {
        const el = downEls.current[i];
        if (el && el.style.display !== "none") el.style.display = "none";
      }
      const pe = promptEl.current;
      if (pe) {
        const want = prompt ? "flex" : "none";
        if (pe.style.display !== want) pe.style.display = want;
        if (prompt) {
          const t = pe.querySelector("span");
          if (t && t.textContent !== prompt) t.textContent = prompt;
          if (ringEl.current)
            ringEl.current.style.strokeDashoffset = String(113 * (1 - promptProg));
        }
      }
      // ---- me, down ----
      const mine = squad.get(me.id);
      const se = selfEl.current;
      if (se) {
        const down = co && on && mine?.st === DOWN;
        const sd = down ? "block" : "none";
        if (se.style.display !== sd) se.style.display = sd;
        if (down && mine) {
          const by = mine.by ? (num(mine.by) === 1 ? "HOST" : `P${num(mine.by)}`) : "";
          const a = se.querySelector("[data-t]");
          const b = se.querySelector("[data-s]");
          const ta = `BLEEDING OUT · ${Math.ceil(mine.bleed)}s`;
          const tb = by ? `${by} IS REVIVING YOU` : "CRAWL TO COVER · A TEAMMATE CAN REVIVE YOU";
          if (a && a.textContent !== ta) a.textContent = ta;
          if (b && b.textContent !== tb) b.textContent = tb;
          if (selfRingEl.current)
            selfRingEl.current.style.strokeDashoffset = String(113 * (1 - mine.prog));
        }
      }
      // ---- toast ----
      const te = toastEl.current;
      if (te) {
        const age = (now - hudToast.at) / 1000;
        const show = age < 2.8;
        const td = show ? "block" : "none";
        if (te.style.display !== td) te.style.display = td;
        const active = show ? "true" : "false";
        if (te.dataset["active"] !== active) te.dataset["active"] = active;
        if (show) {
          te.style.opacity = String(Math.min(1, (2.8 - age) / 0.5));
          if (te.textContent !== hudToast.text) te.textContent = hudToast.text;
        }
      }
      // ---- map event banner ----
      const be = bannerEl.current;
      const bn = mapEvent.banner;
      if (be) {
        const age = bn ? (now - bn.at) / 1000 : 99;
        const show = on && age < 4.5;
        const bd = show ? "block" : "none";
        if (be.style.display !== bd) be.style.display = bd;
        if (show && bn) {
          be.style.opacity = String(Math.min(1, (4.5 - age) / 0.6, age / 0.15));
          be.style.background = bn.color;
          const a = be.querySelector("[data-t]");
          const b = be.querySelector("[data-s]");
          if (a && a.textContent !== bn.title) a.textContent = `⚠ ${bn.title} ⚠`;
          if (b && b.textContent !== bn.sub) b.textContent = bn.sub;
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [remotes]);

  return (
    <div className="pointer-events-none fixed inset-0 z-10 overflow-hidden font-mono">
      <div ref={compassEl} data-compass className="absolute left-1/2 top-16 -translate-x-1/2 rounded bg-black/75 px-3 py-1 text-sm font-bold text-white" />
      <div ref={hazardEl} className="hud-down" style={{display:"none",borderColor:"#ffcf6b"}} />
      {Array.from({length:MAX_DOWN},(_,i)=><div key={`team${i}`} ref={el=>{teamEls.current[i]=el}} className="hud-ping" data-teammate style={{display:"none"}} />)}
      <style>{`
        .hud-ping { position:absolute; left:0; top:0; white-space:nowrap; font-size:12px; font-weight:700;
          letter-spacing:0.12em; color:#f7eeda; padding:2px 7px; border-radius:4px;
          background:rgba(20,16,12,0.72); border:2px solid var(--pc); box-shadow:0 0 10px var(--pc); }
        .hud-ping[data-kind="enemy"] { color:#ffd9d4; border-color:#ff3a2a; border-left:7px solid var(--pc); box-shadow:0 0 12px #ff3a2a; }
        .hud-box { position:absolute; left:0; top:0; }
        .hud-box::before, .hud-box::after { content:""; position:absolute; inset:0; border:3px solid #ff3a2a;
          filter: drop-shadow(0 0 4px #ff3a2a); }
        .hud-box::before { clip-path: polygon(0 0,32% 0,32% 5%,5% 5%,5% 32%,0 32%, 0 68%,5% 68%,5% 95%,32% 95%,32% 100%,0 100%); }
        .hud-box::after { clip-path: polygon(68% 0,100% 0,100% 32%,95% 32%,95% 5%,68% 5%, 68% 95%,95% 95%,95% 68%,100% 68%,100% 100%,68% 100%); }
        .hud-down { position:absolute; left:0; top:0; white-space:nowrap; font-size:12px; font-weight:700;
          letter-spacing:0.12em; color:#fff; padding:3px 8px; border-radius:5px; background:rgba(179,38,30,0.88);
          border:2px solid var(--pc); animation: hudpulse 0.9s ease-in-out infinite alternate; }
        @keyframes hudpulse { from { box-shadow:0 0 4px #ff4a3a; } to { box-shadow:0 0 16px #ff4a3a; } }
      `}</style>
      {Array.from({ length: MAX_PINGS }, (_, i) => (
        <div
          key={`b${i}`}
          ref={(e) => {
            boxEls.current[i] = e;
          }}
          className="hud-box"
          style={{ display: "none" }}
        />
      ))}
      {Array.from({ length: MAX_PINGS }, (_, i) => (
        <div
          key={`p${i}`}
          ref={(e) => {
            pingEls.current[i] = e;
          }}
          className="hud-ping"
          style={{ display: "none" }}
        />
      ))}
      {Array.from({ length: MAX_DOWN }, (_, i) => (
        <div
          key={`d${i}`}
          ref={(e) => {
            downEls.current[i] = e;
          }}
          className="hud-down"
          style={{ display: "none" }}
        />
      ))}
      <div
        ref={promptEl}
        className="absolute left-1/2 top-[60%] -translate-x-1/2 items-center gap-3 rounded-lg bg-[#2b2118]/85 px-4 py-2 text-sm font-bold tracking-[0.2em] text-[#f3e6cf]"
        style={{ display: "none" }}
      >
        <svg width="40" height="40" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="18" fill="none" stroke="#f3e6cf33" strokeWidth="4" />
          <circle
            ref={ringEl}
            cx="20"
            cy="20"
            r="18"
            fill="none"
            stroke="#5fe08a"
            strokeWidth="4"
            strokeDasharray="113"
            strokeDashoffset="113"
            transform="rotate(-90 20 20)"
          />
        </svg>
        <span />
      </div>
      <div
        ref={selfEl}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-[#2b2118]/85 px-8 py-5 text-center text-[#f3e6cf]"
        style={{ display: "none" }}
      >
        <div className="text-2xl font-bold tracking-[0.3em] text-[#e8322a]">DOWN</div>
        <div data-t className="mt-2 text-sm font-bold tracking-[0.25em]" />
        <div className="mt-3 flex justify-center">
          <svg width="46" height="46" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="18" fill="none" stroke="#f3e6cf33" strokeWidth="4" />
            <circle
              ref={selfRingEl}
              cx="20"
              cy="20"
              r="18"
              fill="none"
              stroke="#5fe08a"
              strokeWidth="4"
              strokeDasharray="113"
              strokeDashoffset="113"
              transform="rotate(-90 20 20)"
            />
          </svg>
        </div>
        <div data-s className="mt-2 text-[11px] tracking-[0.2em] opacity-80" />
      </div>
      <div
        ref={toastEl}
        data-hud-toast
        data-active="false"
        className="hud-context-notice rounded-md bg-[#2b2118]/85 px-4 py-1.5 text-xs font-bold tracking-[0.25em] text-[#f3e6cf]"
        style={{ display: "none" }}
      />
      <div
        ref={bannerEl}
        className="absolute left-1/2 top-[14%] -translate-x-1/2 rounded-lg px-7 py-2.5 text-center text-[#f7eeda] shadow-lg"
        style={{ display: "none" }}
      >
        <div data-t className="text-xl font-bold tracking-[0.35em]" />
        <div data-s className="mt-0.5 text-[11px] tracking-[0.25em] opacity-85" />
      </div>
    </div>
  );
}
