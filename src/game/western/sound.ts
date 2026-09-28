// Procedural sound for Dry Gulch: the steam whistle, the rumble and chuff of the freight,
// and the howl of a dust storm. Built on the game's shared audio graph (audio.ts).
import { audioOut } from "../audio";

/** distance falloff: full volume within ~20 m, still audible across the map */
const fall = (d: number) => 1 / (1 + Math.max(0, d - 20) / 90);

/**
 * A three-chime steam whistle (the classic A-C#-E chord of a 19th century freight), with
 * the breathy hiss of steam. `long` is a full blast, otherwise a short toot.
 */
export function whistle(dist: number, pan: number, long = true) {
  const A = audioOut();
  if (!A) return;
  const { ctx, out, noise } = A;
  const now = ctx.currentTime + 0.01;
  const dur = long ? 1.5 : 0.42;
  const g = ctx.createGain();
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-0.9, Math.min(0.9, pan));
  const vol = 0.42 * fall(dist);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(vol, now + 0.09);
  g.gain.setValueAtTime(vol, now + dur - 0.2);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.25);
  // far away the high end is lost in the air
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 5200 * fall(dist) + 700;
  g.connect(lp).connect(p).connect(out);
  for (const f of [440, 554.4, 659.3]) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    // the pitch sags in, then settles as the steam pressure builds
    o.frequency.setValueAtTime(f * 0.93, now);
    o.frequency.exponentialRampToValueAtTime(f, now + 0.18);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = f * 2;
    bp.Q.value = 2.5;
    const og = ctx.createGain();
    og.gain.value = 0.55;
    o.connect(bp).connect(og).connect(g);
    o.start(now);
    o.stop(now + dur + 0.3);
  }
  const n = ctx.createBufferSource();
  n.buffer = noise;
  n.loop = true;
  const nf = ctx.createBiquadFilter();
  nf.type = "bandpass";
  nf.frequency.value = 2400;
  nf.Q.value = 0.8;
  const ng = ctx.createGain();
  ng.gain.value = 0.12;
  n.connect(nf).connect(ng).connect(g);
  n.start(now);
  n.stop(now + dur + 0.3);
}

/** a continuous rumble + chuff + clatter voice for the train (one per scene) */
export function trainVoice() {
  const A = audioOut();
  if (!A) return null;
  const { ctx, out, noise } = A;
  const rumble = ctx.createBufferSource();
  rumble.buffer = noise;
  rumble.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 110;
  lp.Q.value = 0.7;
  const rg = ctx.createGain();
  rg.gain.value = 0;
  const pan = ctx.createStereoPanner();
  rumble.connect(lp).connect(rg).connect(pan).connect(out);
  rumble.start();
  let nextChuff = 0;
  let nextClack = 0;
  const burst = (at: number, f: number, q: number, dur: number, gain: number) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.playbackRate.value = 0.6 + Math.random() * 0.3;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = f;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    s.connect(bp).connect(g).connect(pan);
    s.start(at, Math.random() * 0.5);
    s.stop(at + dur + 0.05);
  };
  return {
    /** dist: metres to the nearest car; loco: metres to the loco; speed m/s; panV -1..1 */
    update(dist: number, loco: number, speed: number, panV: number) {
      const now = ctx.currentTime;
      const near = dist < 900 ? fall(dist) : 0;
      rg.gain.setTargetAtTime(0.55 * near * Math.min(1, speed / 6 + 0.15), now, 0.15);
      pan.pan.setTargetAtTime(Math.max(-0.8, Math.min(0.8, panV)), now, 0.1);
      // chuffs from the stack, four per driver turn (capped so it reads as chuffing)
      const loud = loco < 700 ? fall(loco) : 0;
      if (speed > 0.3 && loud > 0.02) {
        const rate = Math.min(7, (speed / (Math.PI * 1.6)) * 4);
        if (nextChuff < now) nextChuff = now;
        while (nextChuff < now + 0.1) {
          burst(nextChuff, 520, 1.2, 0.16, 0.5 * loud);
          nextChuff += 1 / Math.max(0.8, rate);
        }
      }
      // wheel clatter over the rail joints, a pair per car length
      if (speed > 1 && near > 0.03) {
        if (nextClack < now) nextClack = now;
        while (nextClack < now + 0.1) {
          burst(nextClack, 2600, 6, 0.05, 0.35 * near);
          burst(nextClack + 0.11, 2300, 6, 0.05, 0.3 * near);
          nextClack += 11 / speed;
        }
      }
    },
    stop() {
      rumble.stop();
      rumble.disconnect();
    },
  };
}

/** a pistol shot at a distance: a sharp crack and its echo off the buildings */
export function pistolShot(dist: number, pan: number) {
  const A = audioOut();
  if (!A) return;
  const { ctx, out, noise } = A;
  const now = ctx.currentTime + 0.005 + dist / 340;
  const vol = 0.5 * fall(dist);
  if (vol < 0.01) return;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-0.9, Math.min(0.9, pan));
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 900 + 6000 * fall(dist);
  lp.connect(p).connect(out);
  for (const [dt, g] of [
    [0, 1],
    [0.13 + Math.random() * 0.05, 0.3],
  ] as const) {
    const n = ctx.createBufferSource();
    n.buffer = noise;
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(vol * g, now + dt);
    gn.gain.exponentialRampToValueAtTime(0.0001, now + dt + 0.18);
    n.connect(gn).connect(lp);
    n.start(now + dt, Math.random() * 0.5);
    n.stop(now + dt + 0.2);
  }
}
