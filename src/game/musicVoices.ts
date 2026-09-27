// Extra instrument voices for the music sequencer (audio.ts): twangy guitar, a whistled
// melody, harmonica, surf guitar, bells, chimes, an organ pad, clip-clop and sleigh bells.
// Every voice is a handful of short-lived nodes per note, the same budget as the original
// `tone()` notes; nothing here runs per frame.

export type Voice = "twang" | "whistle" | "harmonica" | "surf" | "bell" | "glock" | "organ" | "harp";

export type MusicOut = {
  ctx: BaseAudioContext;
  out: AudioNode;
  /** reverb send (a single shared convolver), or null */
  verb: AudioNode | null;
  noise: AudioBuffer;
};

/** notes played per voice (instrumentation: the offline audio harness reads it) */
export const voiceStats: Record<string, number> = {};
const count = (k: string) => (voiceStats[k] = (voiceStats[k] ?? 0) + 1);

/** one reverb impulse (a decaying stereo noise tail), generated once per context */
export function makeReverb(ctx: BaseAudioContext, seconds = 2.2, decay = 3.2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const k = i / len;
      // a few ms of pre-delay, then a smooth exponential tail
      d[i] = i < ctx.sampleRate * 0.012 ? 0 : (Math.random() * 2 - 1) * Math.pow(1 - k, decay);
    }
  }
  const conv = ctx.createConvolver();
  conv.buffer = buf;
  return conv;
}

function env(g: GainNode, t: number, peak: number, attack: number, dur: number, release = 0.08) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.setValueAtTime(Math.max(0.0002, peak), t + Math.max(attack, dur - release));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

/** output stage of one note: dry to the music bus, `wet` of it to the reverb */
function outStage(M: MusicOut, wet: number) {
  const g = M.ctx.createGain();
  g.connect(M.out);
  if (M.verb && wet > 0) {
    const s = M.ctx.createGain();
    s.gain.value = wet;
    g.connect(s).connect(M.verb);
  }
  return g;
}

function osc(M: MusicOut, type: OscillatorType, f: number, t: number, stop: number) {
  const o = M.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  o.start(t);
  o.stop(stop);
  return o;
}

/** a slow vibrato on an oscillator: an LFO into its frequency, fading in after `delay` */
function vibrato(M: MusicOut, target: AudioParam, f: number, rate: number, depth: number, t: number, delay: number, stop: number) {
  const lfo = osc(M, "sine", rate, t, stop);
  const d = M.ctx.createGain();
  d.gain.setValueAtTime(0, t);
  d.gain.linearRampToValueAtTime(f * depth, t + delay + 0.25);
  lfo.connect(d).connect(target);
}

/**
 * Play one note. `dur` is the held length in seconds; plucked voices ring out on their own.
 */
export function playVoice(M: MusicOut, v: Voice, f: number, t: number, dur: number, gain: number) {
  const { ctx } = M;
  count(v);
  if (v === "twang" || v === "harp" || v === "surf") {
    // plucked string: bright attack that darkens fast; the twang is the pitch settling
    const ring = v === "harp" ? 1.4 : v === "surf" ? 0.9 : 0.55;
    const end = t + ring + 0.05;
    const out = outStage(M, v === "surf" ? 0.55 : v === "harp" ? 0.45 : 0.2);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = v === "twang" ? 4 : 1.5;
    const top = v === "harp" ? 2600 : v === "surf" ? 3800 : 4800;
    lp.frequency.setValueAtTime(top, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.5), t + ring * 0.6);
    const g = ctx.createGain();
    env(g, t, gain, 0.004, ring, ring * 0.9);
    g.connect(lp).connect(out);
    const types: OscillatorType[] = v === "harp" ? ["triangle"] : v === "surf" ? ["square", "sawtooth"] : ["sawtooth", "sawtooth"];
    types.forEach((ty, i) => {
      const o = osc(M, ty, f, t, end);
      const bend = v === "twang" ? 1.018 : 1.004;
      o.frequency.setValueAtTime(f * bend * (i ? 1.004 : 1), t);
      o.frequency.exponentialRampToValueAtTime(f * (i ? 1.003 : 1), t + 0.06);
      const og = ctx.createGain();
      og.gain.value = 1 / types.length;
      o.connect(og).connect(g);
    });
    if (v === "surf") {
      // the surf guitar's spring-tank shimmer: a fast tremolo on the ring
      const lfo = osc(M, "sine", 7.5, t, end);
      const d = ctx.createGain();
      d.gain.value = gain * 0.25;
      lfo.connect(d).connect(g.gain);
    }
    return;
  }
  if (v === "whistle") {
    // a whistled tune: pure tone, a little scoop into the note, vibrato that blooms late
    const end = t + dur + 0.2;
    const out = outStage(M, 0.6);
    const g = ctx.createGain();
    env(g, t, gain, 0.06, dur + 0.15, 0.14);
    g.connect(out);
    const o = osc(M, "sine", f * 0.965, t, end);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
    vibrato(M, o.frequency, f, 5.6, 0.012, t, 0.18, end);
    o.connect(g);
    // breath
    const n = ctx.createBufferSource();
    n.buffer = M.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = f * 2;
    bp.Q.value = 6;
    const ng = ctx.createGain();
    ng.gain.value = 0.05;
    n.connect(bp).connect(ng).connect(g);
    n.start(t, Math.random() * 0.5);
    n.stop(end);
    return;
  }
  if (v === "harmonica") {
    // reedy: square + saw through a nasal band, bent up into pitch, breathy tremolo
    const end = t + dur + 0.15;
    const out = outStage(M, 0.3);
    const g = ctx.createGain();
    env(g, t, gain, 0.05, dur + 0.1, 0.12);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = Math.min(2400, f * 2.5);
    bp.Q.value = 1.2;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3200;
    g.connect(bp).connect(lp).connect(out);
    (["square", "sawtooth"] as OscillatorType[]).forEach((ty) => {
      const o = osc(M, ty, f * 0.94, t, end);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
      const og = ctx.createGain();
      og.gain.value = 0.5;
      o.connect(og).connect(g);
    });
    const lfo = osc(M, "sine", 5.2, t, end);
    const d = ctx.createGain();
    d.gain.value = gain * 0.3;
    lfo.connect(d).connect(g.gain);
    return;
  }
  if (v === "bell" || v === "glock") {
    // inharmonic partials, the high ones dying first
    const partials = v === "bell" ? [[1, 1], [2, 0.5], [2.76, 0.35], [5.4, 0.14], [8.93, 0.06]] : [[1, 1], [4, 0.3], [9.2, 0.08]];
    const ring = v === "bell" ? Math.max(1.6, dur) : 0.7;
    const out = outStage(M, 0.5);
    partials.forEach(([m, a], i) => {
      const g = ctx.createGain();
      const r = ring / (1 + i * 0.8);
      env(g, t, gain * a!, 0.003, r, r * 0.95);
      g.connect(out);
      osc(M, "sine", f * m!, t, t + r + 0.05).connect(g);
    });
    return;
  }
  // organ: stacked sines with a slow tremolo, for pads and calliope
  const end = t + dur + 0.2;
  const out = outStage(M, 0.35);
  const g = ctx.createGain();
  env(g, t, gain, 0.08, dur + 0.15, 0.2);
  g.connect(out);
  [[1, 1], [2, 0.45], [3, 0.2]].forEach(([m, a]) => {
    const og = ctx.createGain();
    og.gain.value = a!;
    osc(M, "sine", f * m!, t, end).connect(og).connect(g);
  });
  const lfo = osc(M, "sine", 5.8, t, end);
  const d = ctx.createGain();
  d.gain.value = gain * 0.15;
  lfo.connect(d).connect(g.gain);
}

/** coconut-shell clip-clop: a hollow woody knock, `hi` for the brighter hoof */
export function playClop(M: MusicOut, t: number, hi: boolean, gain = 0.3) {
  const { ctx } = M;
  count("clop");
  const f = hi ? 1250 : 850;
  const g = ctx.createGain();
  env(g, t, gain, 0.002, 0.07, 0.06);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = f;
  bp.Q.value = 5;
  g.connect(bp).connect(M.out);
  const o = osc(M, "triangle", f * 1.3, t, t + 0.09);
  o.frequency.exponentialRampToValueAtTime(f * 0.8, t + 0.05);
  o.connect(g);
  const n = ctx.createBufferSource();
  n.buffer = M.noise;
  const ng = ctx.createGain();
  ng.gain.value = 0.6;
  n.connect(ng).connect(g);
  n.start(t, Math.random() * 0.5);
  n.stop(t + 0.08);
}

/** a soft shake of sleigh bells */
export function playJingle(M: MusicOut, t: number, gain = 0.06) {
  const { ctx } = M;
  count("jingle");
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 6500;
  const out = outStage(M, 0.3);
  hp.connect(out);
  for (let k = 0; k < 3; k++) {
    const at = t + k * 0.028;
    const n = ctx.createBufferSource();
    n.buffer = M.noise;
    const g = ctx.createGain();
    env(g, at, gain * (1 - k * 0.25), 0.002, 0.12, 0.1);
    n.connect(g).connect(hp);
    n.start(at, Math.random() * 0.5);
    n.stop(at + 0.14);
  }
}
