// Sounds for map events, pings and revives, built on the shared effects bus (audio.ts).
import { audioBus } from "../audio";

/** a rising-and-falling air-raid siren for `secs` seconds */
export function playAirRaid(secs = 6, vol = 0.16) {
  const b = audioBus();
  if (!b) return;
  const { ctx, out } = b;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  const osc2 = ctx.createOscillator();
  osc2.type = "triangle";
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = 1400;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.6);
  g.gain.setValueAtTime(vol, t0 + secs - 1.2);
  g.gain.linearRampToValueAtTime(0, t0 + secs);
  // the wail: up over ~2.2 s, down again, repeat
  const lo = 240;
  const hi = 620;
  for (let t = 0; t < secs; t += 3) {
    osc.frequency.setValueAtTime(lo, t0 + t);
    osc.frequency.linearRampToValueAtTime(hi, t0 + t + 1.8);
    osc.frequency.linearRampToValueAtTime(lo, t0 + t + 3);
    osc2.frequency.setValueAtTime(lo * 1.5, t0 + t);
    osc2.frequency.linearRampToValueAtTime(hi * 1.5, t0 + t + 1.8);
    osc2.frequency.linearRampToValueAtTime(lo * 1.5, t0 + t + 3);
  }
  const m2 = ctx.createGain();
  m2.gain.value = 0.35;
  osc.connect(f);
  osc2.connect(m2).connect(f);
  f.connect(g).connect(out);
  osc.start(t0);
  osc2.start(t0);
  osc.stop(t0 + secs + 0.1);
  osc2.stop(t0 + secs + 0.1);
}

/** a deep rumble (avalanche, collapsing things) */
export function playRumble(secs = 4, vol = 0.5) {
  const b = audioBus();
  if (!b) return;
  const { ctx, out, noise } = b;
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(90, t0);
  f.frequency.linearRampToValueAtTime(260, t0 + secs * 0.7);
  f.Q.value = 2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + secs * 0.6);
  g.gain.linearRampToValueAtTime(0, t0 + secs);
  src.connect(f).connect(g).connect(out);
  src.start(t0);
  src.stop(t0 + secs + 0.1);
}

/** the power dying / coming back: a heavy relay clunk and a falling (or rising) hum */
export function playPowerClunk(on: boolean, vol = 0.35) {
  const b = audioBus();
  if (!b) return;
  const { ctx, out, noise } = b;
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = 500;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
  src.connect(f).connect(g).connect(out);
  src.start(t0);
  src.stop(t0 + 0.2);
  const hum = ctx.createOscillator();
  hum.type = "sawtooth";
  hum.frequency.setValueAtTime(on ? 40 : 120, t0);
  hum.frequency.exponentialRampToValueAtTime(on ? 120 : 30, t0 + 0.9);
  const hf = ctx.createBiquadFilter();
  hf.type = "lowpass";
  hf.frequency.value = 400;
  const hg = ctx.createGain();
  hg.gain.setValueAtTime(vol * 0.35, t0);
  hg.gain.exponentialRampToValueAtTime(0.001, t0 + 1);
  hum.connect(hf).connect(hg).connect(out);
  hum.start(t0);
  hum.stop(t0 + 1.05);
}

/** a train whistle / ship horn style blast */
export function playHorn(vol = 0.2, low = false) {
  const b = audioBus();
  if (!b) return;
  const { ctx, out } = b;
  const t0 = ctx.currentTime;
  for (const [fq, gm] of low ? [[110, 1], [165, 0.6]] : [[520, 1], [660, 0.7], [780, 0.5]]) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = fq!;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = low ? 600 : 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol * gm!, t0 + 0.15);
    g.gain.setValueAtTime(vol * gm!, t0 + 1.2);
    g.gain.linearRampToValueAtTime(0, t0 + 1.6);
    o.connect(f).connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + 1.7);
  }
}

/** ping: a bright two-note blip (enemy pings are sharper) */
export function playPing(enemy: boolean, mine: boolean) {
  const b = audioBus();
  if (!b) return;
  const { ctx, out } = b;
  const t0 = ctx.currentTime;
  const notes = enemy ? [1175, 1568] : [988, 1319];
  notes.forEach((fq, i) => {
    const o = ctx.createOscillator();
    o.type = enemy ? "square" : "sine";
    o.frequency.value = fq;
    const g = ctx.createGain();
    const at = t0 + i * 0.075;
    const v = (mine ? 0.12 : 0.09) * (enemy ? 0.7 : 1);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(v, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.16);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + 0.18);
  });
}

/** revive: a warm rising chord */
export function playRevive() {
  const b = audioBus();
  if (!b) return;
  const { ctx, out } = b;
  const t0 = ctx.currentTime;
  [523, 659, 784, 1047].forEach((fq, i) => {
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = fq;
    const g = ctx.createGain();
    const at = t0 + i * 0.07;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.12, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.6);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + 0.65);
  });
}

/** going down: a falling tone */
export function playDowned() {
  const b = audioBus();
  if (!b) return;
  const { ctx, out } = b;
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(420, t0);
  o.frequency.exponentialRampToValueAtTime(70, t0 + 0.9);
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = 900;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.25, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 1);
  o.connect(f).connect(g).connect(out);
  o.start(t0);
  o.stop(t0 + 1.05);
}
