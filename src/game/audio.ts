// Procedural Web Audio: per-gun shot sounds, little UI blips and a synthwave loop.
let ctx: AudioContext | null = null;
let musicGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let vol = { music: 0.5, sfx: 0.7 };

export function initAudio() {
  if (typeof window === "undefined") return;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    sfxGain = ctx.createGain();
    musicGain.connect(master);
    sfxGain.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    applyVol();
  }
  if (ctx.state === "suspended") void ctx.resume();
}

function applyVol() {
  if (musicGain) musicGain.gain.value = vol.music * 0.35;
  if (sfxGain) sfxGain.gain.value = vol.sfx * 0.6;
}
export function setVolumes(music: number, sfx: number) {
  vol = { music, sfx };
  applyVol();
}

type Tone = { wave: OscillatorType; f0: number; f1: number; dur: number; gain: number; noise: number; cut: number; q?: number };
function tone(t: Tone, out: AudioNode | null = sfxGain, at = 0) {
  if (!ctx || !out) return;
  const now = (at || ctx.currentTime) + 0.001;
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(t.cut, now);
  f.frequency.exponentialRampToValueAtTime(Math.max(80, t.cut * 0.25), now + t.dur);
  f.Q.value = t.q ?? 1;
  g.gain.setValueAtTime(t.gain, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + t.dur);
  f.connect(g).connect(out);
  if (t.f0 > 0) {
    const o = ctx.createOscillator();
    o.type = t.wave;
    o.frequency.setValueAtTime(t.f0, now);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, t.f1), now + t.dur);
    o.connect(f);
    o.start(now);
    o.stop(now + t.dur + 0.02);
  }
  if (t.noise > 0 && noiseBuf) {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    const ng = ctx.createGain();
    ng.gain.value = t.noise;
    n.connect(ng).connect(f);
    n.start(now, Math.random() * 0.5);
    n.stop(now + t.dur + 0.02);
  }
}

const GUN_SOUNDS: Record<string, Tone[]> = {
  pistol: [{ wave: "square", f0: 520, f1: 140, dur: 0.1, gain: 0.35, noise: 0.6, cut: 3000 }],
  scatter: [{ wave: "sawtooth", f0: 180, f1: 50, dur: 0.28, gain: 0.4, noise: 1.2, cut: 2200 }],
  smg: [{ wave: "square", f0: 900, f1: 300, dur: 0.05, gain: 0.2, noise: 0.4, cut: 4500 }],
  rail: [{ wave: "sawtooth", f0: 2400, f1: 120, dur: 0.45, gain: 0.35, noise: 0.2, cut: 6000, q: 8 }],
  cannon: [{ wave: "sine", f0: 120, f1: 30, dur: 0.6, gain: 0.8, noise: 0.9, cut: 900 }],
  rebound: [{ wave: "triangle", f0: 300, f1: 900, dur: 0.16, gain: 0.45, noise: 0, cut: 3000, q: 4 }],
  harpoon: [{ wave: "sawtooth", f0: 700, f1: 200, dur: 0.18, gain: 0.3, noise: 0.5, cut: 5000, q: 6 }],
  cryo: [{ wave: "sine", f0: 1800, f1: 2600, dur: 0.12, gain: 0.25, noise: 0.2, cut: 8000, q: 10 }],
  flak: [{ wave: "square", f0: 220, f1: 60, dur: 0.35, gain: 0.45, noise: 1, cut: 1600 }],
  tesla: [
    { wave: "sawtooth", f0: 1200, f1: 400, dur: 0.14, gain: 0.25, noise: 0.3, cut: 7000, q: 12 },
    { wave: "square", f0: 60, f1: 50, dur: 0.14, gain: 0.2, noise: 0, cut: 800 },
  ],
};

export function playGun(w: string, quiet = false) {
  (GUN_SOUNDS[w] ?? GUN_SOUNDS['pistol']!).forEach((t) =>
    tone(quiet ? { ...t, gain: t.gain * 0.3, cut: Math.min(t.cut, 1400) } : t));
}

export function playSfx(kind: "shard" | "hurt" | "buy" | "pickup" | "deny" | "turret") {
  if (kind === "turret") {
    // mechanical pneumatic pop + metallic ring, distinct from the music's square arps
    tone({ wave: "triangle", f0: 240, f1: 90, dur: 0.07, gain: 0.22, noise: 1.1, cut: 2600 });
    if (ctx) tone({ wave: "sine", f0: 2100, f1: 1500, dur: 0.05, gain: 0.08, noise: 0, cut: 9000, q: 10 }, sfxGain, ctx.currentTime + 0.01);
  }

  if (kind === "shard") tone({ wave: "sine", f0: 1400 + Math.random() * 300, f1: 2400, dur: 0.08, gain: 0.18, noise: 0, cut: 9000 });
  if (kind === "hurt") tone({ wave: "sawtooth", f0: 160, f1: 60, dur: 0.25, gain: 0.45, noise: 0.5, cut: 1200 });
  if (kind === "pickup") tone({ wave: "triangle", f0: 500, f1: 1100, dur: 0.2, gain: 0.3, noise: 0, cut: 6000 });
  if (kind === "deny") tone({ wave: "square", f0: 140, f1: 120, dur: 0.15, gain: 0.25, noise: 0, cut: 1200 });
  if (kind === "buy") {
    tone({ wave: "square", f0: 660, f1: 660, dur: 0.1, gain: 0.25, noise: 0, cut: 5000 });
    if (ctx) tone({ wave: "square", f0: 990, f1: 990, dur: 0.18, gain: 0.25, noise: 0, cut: 5000 }, sfxGain, ctx.currentTime + 0.09);
  }
}

// ---- music: tiny lookahead step sequencer, one style per map ----
type Style = {
  roots: number[]; bpm: number; arp: number[]; lead: OscillatorType; leadCut: number;
  bass: OscillatorType; kick: number[]; snare: number[]; hat: "odd" | "all" | "none" | "off"; pad?: boolean;
  /** lead plays every N sixteenths (default 2) */ arpRate?: number;
  /** lead octave shift in semitones (default 24) */ oct?: number;
  /** bass plays every N sixteenths (default 2) */ bassRate?: number;
  /** lead note length multiplier */ leadLen?: number;
  /** delayed echo on the lead */ echo?: boolean;
  /** swing amount 0..0.5 of a step on odd sixteenths */ swing?: number;
  /** woody click percussion instead of snare noise */ wood?: boolean;
};
const STYLES: Record<string, Style> = {
  // desert: swung, twangy minor groove with a walking bass
  desert: { roots: [45, 41, 48, 43], bpm: 116, arp: [0, 3, 5, 6, 7, 10, 7, 3], lead: "sawtooth", leadCut: 1800, bass: "triangle", kick: [0, 7, 10], snare: [4, 12], hat: "off", arpRate: 3, oct: 12, bassRate: 4, swing: 0.28, leadLen: 1.6 },
  // ice: sparse, slow music-box bells with long echoes, no drums to speak of
  ice: { roots: [62, 57, 59, 55], bpm: 76, arp: [0, 7, 12, 16, 19, 16, 12, 7], lead: "sine", leadCut: 9000, bass: "sine", kick: [0], snare: [], hat: "none", pad: true, arpRate: 4, oct: 12, bassRate: 16, leadLen: 3, echo: true },
  // forest: bouncy major pentatonic plucks, woodblock clicks, fast tempo
  forest: { roots: [55, 60, 57, 62], bpm: 132, arp: [0, 4, 7, 12, 9, 7, 4, 2], lead: "triangle", leadCut: 5000, bass: "square", kick: [0, 8], snare: [4, 10, 12], hat: "none", arpRate: 1, oct: 12, bassRate: 8, leadLen: 0.6, wood: true },
  // magma: heavy, fast, distorted (kept as-is)
  magma: { roots: [40, 40, 41, 38], bpm: 136, arp: [0, 1, 7, 6, 0, 12, 1, 7], lead: "sawtooth", leadCut: 1800, bass: "sawtooth", kick: [0, 3, 6, 8, 11, 14], snare: [4, 12], hat: "all" },
  // blossom: gentle waltz-like koto plucks over pads (Japanese in-scale)
  blossom: { roots: [57, 52, 53, 50], bpm: 90, arp: [0, 1, 5, 7, 8, 12, 8, 5], lead: "triangle", leadCut: 3500, bass: "sine", kick: [0], snare: [12], hat: "none", pad: true, arpRate: 3, oct: 12, bassRate: 16, leadLen: 2.2, echo: true },
  // abyss: very slow, deep sub drones and a lonely sonar ping
  abyss: { roots: [33, 36, 31, 34], bpm: 64, arp: [24, 19, 24, 31], lead: "sine", leadCut: 2500, bass: "sine", kick: [0, 10], snare: [], hat: "none", pad: true, arpRate: 8, oct: 12, bassRate: 16, leadLen: 5, echo: true },
  // cyber: four-on-the-floor electro, octave-jumping saw bass, off-beat hats
  cyber: { roots: [45, 45, 43, 48], bpm: 128, arp: [0, 12, 7, 12, 3, 12, 10, 12], lead: "square", leadCut: 6000, bass: "sawtooth", kick: [0, 4, 8, 12], snare: [4, 12], hat: "off", arpRate: 1, bassRate: 1, leadLen: 0.5 },
  // toxic: lurching industrial acid line, resonant squelch, broken beat
  toxic: { roots: [40, 43, 40, 38], bpm: 104, arp: [0, 0, 12, 3, 0, 6, 12, 1], lead: "sawtooth", leadCut: 900, bass: "square", kick: [0, 3, 10], snare: [6, 14], hat: "odd", arpRate: 1, oct: 12, bassRate: 1, leadLen: 0.8, swing: 0.15 },
};
const MAP_STYLE: Record<string, string> = {
  "Dust Basin": "desert", "Canyon Mesa": "desert", "Frost Shelf": "ice", "Glacier Rift": "ice",
  "Mossy Woods": "forest", "Ash Crater": "magma", "Cherry Grove": "blossom",
  "Sunken Abyss": "abyss", "Neon Spire": "cyber", "Toxic Hollow": "toxic",
};
let style: Style = STYLES['desert']!;
export function setMusicTheme(mapName: string) {
  style = STYLES[MAP_STYLE[mapName] ?? "desert"]!;
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
let timer: number | null = null;
let step = 0;
let nextT = 0;
let intense = false;

export function setMusicIntensity(boss: boolean) {
  intense = boss;
}

function scheduleStep(s: number, t0: number, stepDur: number) {
  if (!musicGain) return;
  const S = style;
  const bar = Math.floor(s / 16) % 4;
  const i = s % 16;
  const t = t0 + (i % 2 === 1 ? (S.swing ?? 0) * stepDur : 0);
  const root = S.roots[bar]!;
  if (S.kick.includes(i) || (intense && i % 4 === 0)) tone({ wave: "sine", f0: 150, f1: 40, dur: 0.22, gain: 0.9, noise: 0, cut: 600 }, musicGain, t);
  if (S.snare.includes(i)) {
    if (S.wood) tone({ wave: "sine", f0: 900, f1: 700, dur: 0.05, gain: 0.35, noise: 0.1, cut: 4000, q: 6 }, musicGain, t);
    else tone({ wave: "triangle", f0: 220, f1: 120, dur: 0.16, gain: 0.3, noise: 0.8, cut: 3500 }, musicGain, t);
  }
  const hat = S.hat === "all" || (S.hat === "odd" && i % 2 === 1) || (S.hat === "off" && i % 4 === 2) || intense;
  if (hat) tone({ wave: "square", f0: 0, f1: 0, dur: S.hat === "off" ? 0.08 : 0.04, gain: 0.12, noise: 1, cut: 9000 }, musicGain, t);
  const bRate = S.bassRate ?? 2;
  if (i % bRate === 0 || intense) {
    const bassNote = bRate === 1 ? (i % 2 ? root + 12 : root) : i % 4 === 2 ? root + 12 : root;
    const bDur = S.bassRate ? Math.min(2.5, stepDur * bRate * 0.9) : 0.14;
    tone({ wave: S.bass, f0: midi(bassNote), f1: midi(bassNote), dur: bDur, gain: 0.35, noise: 0, cut: S.bass === "square" && bRate === 1 ? 500 + (i % 8) * 180 : 700, q: bRate === 1 ? 10 : 6 }, musicGain, t);
  }
  if (S.pad && i === 0) {
    [0, 7, 15].forEach((iv) => tone({ wave: "sine", f0: midi(root + 12 + iv), f1: midi(root + 12 + iv), dur: stepDur * 16, gain: 0.08, noise: 0, cut: 3000 }, musicGain, t));
  }
  const rate = S.arpRate ?? 2;
  if (intense || i % rate === 0) {
    const idx = Math.floor(s / rate);
    const n = root + (S.oct ?? 24) + S.arp[idx % S.arp.length]!;
    const base = S.lead === "sine" ? 0.25 : 0.12;
    const dur = base * (S.leadLen ?? 1);
    const g = S.lead === "sine" ? 0.14 : 0.1;
    tone({ wave: S.lead, f0: midi(n), f1: midi(n), dur, gain: g, noise: 0, cut: S.leadCut }, musicGain, t);
    if (S.echo) tone({ wave: S.lead, f0: midi(n), f1: midi(n), dur, gain: g * 0.35, noise: 0, cut: S.leadCut * 0.6 }, musicGain, t + stepDur * 3);
  }
}

export function startMusic() {
  if (!ctx || timer !== null) return;
  nextT = ctx.currentTime + 0.05;
  timer = window.setInterval(() => {
    if (!ctx) return;
    const stepDur = 60 / (style.bpm + (intense ? 20 : 0)) / 4;
    while (nextT < ctx.currentTime + 0.12) {
      scheduleStep(step, nextT, stepDur);
      step++;
      nextT += stepDur;
    }
  }, 25);
}

export function stopMusic() {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
}
