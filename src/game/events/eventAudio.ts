// Sounds for the big map events: the Dry Gulch TRAIN ROBBERY (steam whistle, then a running
// gunfight around the station) and the Whiteout Pass AVALANCHE (a rumble that builds through
// the warning, the slab cracking, the roar of the run, debris, a long tail). On the effects bus.
import { ambienceListener, ambienceNearest } from "../ambience";
import { audioBus } from "../audio";
import { whistle } from "../western/sound";
import { AV_WARN } from "./avalanche";

type Bus = NonNullable<ReturnType<typeof audioBus>>;
/** offline rendering (the audio harness) drives the timers itself */
const offline = (ctx: BaseAudioContext) => typeof OfflineAudioContext !== "undefined" && ctx instanceof OfflineAudioContext;

function noiseHit(b: Bus, out: AudioNode, t: number, o: { type: BiquadFilterType; f: number; f1?: number | undefined; q?: number; dur: number; gain: number; attack?: number; loop?: boolean }) {
  const { ctx } = b;
  const s = ctx.createBufferSource();
  s.buffer = b.noise;
  s.loop = !!o.loop;
  const f = ctx.createBiquadFilter();
  f.type = o.type;
  f.frequency.setValueAtTime(o.f, t);
  if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
  f.Q.value = o.q ?? 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack ?? 0.003));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  s.connect(f).connect(g).connect(out);
  s.start(t, Math.random() * 0.5);
  s.stop(t + o.dur + 0.05);
}

function toneHit(b: Bus, out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, gain: number) {
  const { ctx } = b;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// ---------------------------------------------------------------------------------------
// train robbery

const robbery = { until: 0, next: 0, timer: 0 as number | ReturnType<typeof setInterval> };

/** where the fight is: the station if the map has one, relative to the listener */
function fightPlace() {
  const me = ambienceListener();
  if (!me) return { d: 60, pan: 0 };
  const st = ambienceNearest("station", me.x, me.z) ?? ambienceNearest("saloon", me.x, me.z);
  if (!st) return { d: 60, pan: 0 };
  // gunmen are strung along the platform, not all on one spot
  const x = st.x + (Math.random() - 0.5) * 50;
  const z = st.z + (Math.random() - 0.5) * 30;
  const dx = x - me.x;
  const dz = z - me.z;
  const d = Math.hypot(dx, dz) || 1;
  return { d, pan: Math.max(-0.9, Math.min(0.9, (dx * -me.fz + dz * me.fx) / d)) };
}

/** one shot (or a quick pair): report, body thump, the canyon slapback, maybe a ricochet */
function gunshot(b: Bus, t: number, boost = 1) {
  const { ctx } = b;
  const { d, pan } = fightPlace();
  // gunfire carries across a desert town: never below ~40% however far away you are
  const k = Math.max(0.4, 1 / (1 + d / 35)) * boost;
  const g = ctx.createGain();
  g.gain.value = 0.9 * k;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = Math.min(ctx.sampleRate * 0.45, 700 + 10000 * Math.exp(-d / 110));
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  g.connect(lp).connect(p).connect(b.out);
  const rifle = Math.random() < 0.35;
  const n = Math.random() < 0.3 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const at = t + i * (rifle ? 0.9 : 0.22);
    noiseHit(b, g, at, { type: rifle ? "highpass" : "lowpass", f: rifle ? 900 : 3200, f1: rifle ? undefined : 700, dur: rifle ? 0.16 : 0.12, gain: 0.5 });
    toneHit(b, g, at, "sine", 140, 45, 0.16, 0.35);
    // the slapback off the canyon walls and the false fronts
    noiseHit(b, g, at + 0.28 + Math.random() * 0.25, { type: "lowpass", f: 1400, f1: 500, dur: 0.35, gain: 0.12, attack: 0.02 });
  }
  if (Math.random() < 0.15) toneHit(b, g, t + 0.05, "sine", 2600, 900, 0.4, 0.06);
  // disconnect the per-shot chain once it's done
  const keep = ctx.createConstantSource();
  keep.offset.value = 0;
  keep.connect(g);
  keep.start(t);
  keep.stop(t + 2.5);
  keep.onended = () => {
    g.disconnect();
    lp.disconnect();
    p.disconnect();
  };
}

/** schedule the next second or so of the gunfight (a timer calls this; so does the harness) */
export function pumpEventAudio() {
  const b = audioBus();
  if (!b) return;
  const now = b.ctx.currentTime;
  if (now > robbery.until) return;
  if (robbery.next < now) robbery.next = now + 0.05;
  const left = robbery.until - now;
  while (robbery.next < now + 1.2 && robbery.next < robbery.until - 4) {
    gunshot(b, robbery.next);
    // fire comes in bursts with lulls; hottest in the middle, thinning as the train leaves
    const heat = Math.min(1, left / 20);
    robbery.next += Math.random() < 0.2 ? 1.5 + Math.random() * 2.5 : (0.25 + Math.random() * 0.9) / (0.5 + heat);
  }
}

/** The payroll train is hit: whistles as it pulls in, then a running gunfight for `secs`. */
export function playTrainRobbery(secs = 58) {
  const b = audioBus();
  if (!b) return;
  const { ctx } = b;
  const me = ambienceListener();
  const st = me ? ambienceNearest("station", me.x, me.z) : null;
  const d = st && me ? Math.hypot(st.x - me.x, st.z - me.z) : 120;
  // the alarm has to land: the whistles are heard as if from the platform's edge at most
  const dw = Math.min(d, 22);
  whistle(dw, 0.2, true);
  setAt(ctx, 1.9, () => whistle(dw, 0.2, false));
  setAt(ctx, 2.6, () => whistle(dw, 0.2, true));
  // the hold-up starts with a volley: shots under the whistle from the first second
  const t0 = ctx.currentTime;
  for (const [dt, boost] of [[0.4, 2.2], [0.6, 2], [0.95, 2.1], [1.5, 1.9], [2.1, 2], [2.4, 1.8], [3.0, 2.1], [3.4, 1.8], [3.9, 2], [4.5, 1.9], [5.0, 1.8], [5.6, 2], [6.2, 1.8], [6.7, 1.9]] as const) gunshot(b, t0 + dt, boost);
  // two short blasts as it pulls out again
  setAt(ctx, secs - 6, () => whistle(d, 0.2, false));
  setAt(ctx, secs - 5.3, () => whistle(d, 0.2, false));
  robbery.until = ctx.currentTime + secs;
  robbery.next = ctx.currentTime + 6; // after the opening volley, the running fight
  if (typeof window !== "undefined" && !offline(ctx)) {
    if (robbery.timer) clearInterval(robbery.timer);
    robbery.timer = setInterval(() => {
      pumpEventAudio();
      if (ctx.currentTime > robbery.until) {
        clearInterval(robbery.timer);
        robbery.timer = 0;
      }
    }, 400);
  }
}

/** run `f` at audio time now + `delay` (the whistle helper schedules from "now") */
const pending: { at: number; f: () => void }[] = [];
function setAt(ctx: BaseAudioContext, delay: number, f: () => void) {
  pending.push({ at: ctx.currentTime + delay, f });
  if (!offline(ctx)) setTimeout(flushPending, delay * 1000 + 5);
}
/** fire any delayed cues that are due (timers call this; the offline harness calls it too) */
export function flushPending() {
  const b = audioBus();
  if (!b) return;
  const now = b.ctx.currentTime;
  for (let i = pending.length - 1; i >= 0; i--) {
    if (pending[i]!.at <= now + 0.02) {
      const p = pending.splice(i, 1)[0]!;
      p.f();
    }
  }
}

// ---------------------------------------------------------------------------------------
// avalanche

/**
 * The avalanche, in time with the event: a sub rumble swelling through the AV_WARN seconds of
 * warning (the slab cracks at the start), the roar and powder hiss of the run peaking as it
 * comes down, debris thumping in it, and a long settling tail.
 */
export function playAvalanche(secs = 26) {
  const b = audioBus();
  if (!b) return;
  const { ctx, out } = b;
  const t0 = ctx.currentTime + 0.02;
  const peak = t0 + AV_WARN + 5;
  const end = t0 + secs;
  const bed = (type: BiquadFilterType, f0: number, fPeak: number, q: number, g0: number, gPeak: number, from: number) => {
    const s = ctx.createBufferSource();
    s.buffer = b.noise;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.linearRampToValueAtTime(fPeak, peak);
    f.frequency.linearRampToValueAtTime(f0, end);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.setValueAtTime(g0, from);
    g.gain.exponentialRampToValueAtTime(gPeak, peak);
    g.gain.setValueAtTime(gPeak, peak + 4);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    s.connect(f).connect(g).connect(out);
    s.start(t0, Math.random() * 0.5);
    s.stop(end + 0.05);
  };
  // the ground-shaking sub rumble: already heavy in the first second of the warning
  bed("lowpass", 55, 140, 1.5, 0.4, 0.7, t0 + 0.01);
  // a low-mid growl so the warning is heard on small speakers too
  bed("bandpass", 130, 260, 1, 0.3, 0.4, t0 + 0.01);
  // the impact that starts it: a deep boom and a broadband crack as the slab lets go
  toneHit(b, out, t0, "sine", 75, 28, 1.6, 0.9);
  noiseHit(b, out, t0, { type: "lowpass", f: 2400, f1: 200, dur: 0.9, gain: 0.55, attack: 0.004 });
  // the roar of the moving snow: from the break
  bed("bandpass", 180, 520, 0.8, 0.01, 0.32, t0 + AV_WARN - 0.5);
  // powder hiss riding on top
  bed("highpass", 1800, 3000, 0.5, 0.005, 0.06, t0 + AV_WARN);
  // the slab fracturing: a heavy whumpf and a couple of sharp cracks
  noiseHit(b, out, t0 + 0.1, { type: "lowpass", f: 400, f1: 70, dur: 1.2, gain: 0.5, attack: 0.01 });
  noiseHit(b, out, t0 + 0.25, { type: "highpass", f: 1500, dur: 0.12, gain: 0.25 });
  noiseHit(b, out, t0 + AV_WARN - 0.3, { type: "highpass", f: 1200, dur: 0.18, gain: 0.3 });
  noiseHit(b, out, t0 + AV_WARN - 0.25, { type: "lowpass", f: 300, f1: 60, dur: 1.5, gain: 0.45, attack: 0.02 });
  // tumbling debris: trees and blocks of ice in the flow
  for (let t = t0 + AV_WARN + 1; t < peak + 6; t += 0.3 + Math.random() * 0.8) {
    noiseHit(b, out, t, { type: "lowpass", f: 260, f1: 60, dur: 0.4, gain: 0.12 + Math.random() * 0.15, attack: 0.01 });
    if (Math.random() < 0.2) noiseHit(b, out, t + 0.05, { type: "bandpass", f: 1400, q: 3, dur: 0.1, gain: 0.08 }); // a trunk snapping
  }
}
