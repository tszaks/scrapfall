// Procedural Web Audio: per-gun shot sounds, little UI blips and a synthwave loop.
let ctx: AudioContext | null = null;
let musicGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muffle: BiquadFilterNode | null = null;
let windGain: GainNode | null = null;
let windFilter: BiquadFilterNode | null = null;
let vol = { music: 0.5, sfx: 0.7 };

export function initAudio() {
  if (typeof window === "undefined") return;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.8;
    // weather muffling (the alpine blizzard): a lowpass that is wide open by default
    muffle = ctx.createBiquadFilter();
    muffle.type = "lowpass";
    muffle.frequency.value = 20000;
    master.connect(muffle).connect(ctx.destination);
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
  // iOS/Safari: a zero-length buffer on a real gesture clears the hardware mute flag
  try {
    const s = ctx.createBufferSource();
    s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    s.connect(ctx.destination);
    s.start(0);
  } catch { /* already unlocked */ }
}

// Browsers block audio until the visitor interacts with the page. Any click,
// tap or key press anywhere wakes the sound up, not just the START button.
let unlockHooked = false;
export function hookAudioUnlock() {
  if (unlockHooked || typeof window === "undefined") return;
  unlockHooked = true;
  const wake = () => initAudio();
  ["pointerdown", "touchstart", "keydown", "mousedown"].forEach((ev) =>
    window.addEventListener(ev, wake, { passive: true }));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && ctx && ctx.state === "suspended") void ctx.resume();
  });
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

type Sfx = "shard" | "hurt" | "buy" | "pickup" | "deny" | "turret" | "thud" | "horn";
export function playSfx(kind: Sfx) {
  if (kind === "thud") {
    // dull body-meets-bumper thump
    tone({ wave: "sine", f0: 110, f1: 40, dur: 0.3, gain: 0.7, noise: 0.8, cut: 700 });
    tone({ wave: "square", f0: 70, f1: 45, dur: 0.12, gain: 0.25, noise: 0, cut: 400 });
  }
  if (kind === "horn") {
    tone({ wave: "square", f0: 392, f1: 392, dur: 0.32, gain: 0.12, noise: 0, cut: 2200 });
    tone({ wave: "square", f0: 494, f1: 494, dur: 0.32, gain: 0.1, noise: 0, cut: 2200 });
  }
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

/** Blizzard muffling, 0 (clear) .. 1 (everything sounds far away through driving snow). */
export function setMuffle(k: number) {
  if (!ctx || !muffle) return;
  const f = 20000 * Math.pow(900 / 20000, Math.max(0, Math.min(1, k)));
  muffle.frequency.setTargetAtTime(f, ctx.currentTime, 0.2);
}

/** Howling wind bed for the blizzard, 0 (silent) .. 1. Started lazily on first use. */
export function setWindNoise(k: number) {
  if (!ctx || !noiseBuf) return;
  if (!windGain) {
    if (k <= 0.001) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.Q.value = 0.8;
    windFilter.frequency.value = 500;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    // the wind bypasses the muffle filter (it is the thing doing the muffling)
    src.connect(windFilter).connect(windGain).connect(ctx.destination);
    src.start();
  }
  const g = Math.max(0, Math.min(1, k)) * 0.22 * vol.sfx;
  windGain.gain.setTargetAtTime(g, ctx.currentTime, 0.3);
  windFilter?.frequency.setTargetAtTime(380 + k * 520, ctx.currentTime, 0.4);
}

// ---- police sirens: a couple of persistent voices steered every frame by the traffic ----
type SirenVoice = { osc: OscillatorNode; osc2: OscillatorNode; filter: BiquadFilterNode; gain: GainNode; pan: StereoPannerNode | null };
const sirenVoices: SirenVoice[] = [];
/**
 * Drive siren voice `slot`: pitch in Hz, gain 0..~0.2 (0 = silent), stereo pan -1..1 and
 * brightness 0..1 (distant sirens sound muffled). Each call also schedules a fade to
 * silence, so if the frames stop (tab hidden, game closed) the siren dies out by itself.
 */
export function setSiren(slot: number, freq: number, gain: number, pan: number, bright = 1) {
  if (!ctx || !sfxGain) return;
  let v = sirenVoices[slot];
  if (!v) {
    if (gain <= 0) return;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    const osc2 = ctx.createOscillator();
    osc2.type = "square";
    const mix2 = ctx.createGain();
    mix2.gain.value = 0.3;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.value = 0;
    osc.connect(filter);
    osc2.connect(mix2).connect(filter);
    filter.connect(g);
    const p = typeof ctx.createStereoPanner === "function" ? ctx.createStereoPanner() : null;
    if (p) g.connect(p).connect(sfxGain);
    else g.connect(sfxGain);
    osc.start();
    osc2.start();
    v = { osc, osc2, filter, gain: g, pan: p };
    sirenVoices[slot] = v;
  }
  const now = ctx.currentTime;
  v.osc.frequency.setTargetAtTime(freq, now, 0.012);
  v.osc2.frequency.setTargetAtTime(freq * 1.006, now, 0.012);
  v.filter.frequency.setTargetAtTime(700 + 2600 * Math.max(0, Math.min(1, bright)), now, 0.05);
  const g = v.gain.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(Math.max(0, Math.min(0.22, gain)), now + 0.05);
  g.linearRampToValueAtTime(0, now + 0.6);
  if (v.pan) v.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), now, 0.03);
}

/** Enemy telegraph cues (newer enemy types). `vol` fades them with distance. */
export type EnemySfx = "aim" | "lock" | "snipe" | "click" | "throw" | "charge" | "spin" | "launch" | "boom" | "heal" | "cloak" | "buzz" | "block";
export function playEnemySfx(kind: EnemySfx, vol = 1) {
  if (!ctx || vol <= 0.02) return;
  const v = Math.min(1, vol);
  const at = ctx.currentTime;
  const t = (x: Tone, delay = 0) => tone({ ...x, gain: x.gain * v }, sfxGain, delay ? at + delay : 0);
  if (kind === "aim") t({ wave: "sine", f0: 880, f1: 900, dur: 0.12, gain: 0.12, noise: 0, cut: 6000 });
  if (kind === "lock") {
    t({ wave: "square", f0: 1760, f1: 1760, dur: 0.07, gain: 0.14, noise: 0, cut: 8000 });
    t({ wave: "square", f0: 1760, f1: 1760, dur: 0.07, gain: 0.14, noise: 0, cut: 8000 }, 0.12);
  }
  if (kind === "snipe") t({ wave: "sawtooth", f0: 1800, f1: 90, dur: 0.5, gain: 0.4, noise: 0.8, cut: 7000, q: 4 });
  if (kind === "click") {
    t({ wave: "square", f0: 1200, f1: 900, dur: 0.04, gain: 0.14, noise: 0.3, cut: 5000 });
    t({ wave: "square", f0: 1200, f1: 900, dur: 0.04, gain: 0.14, noise: 0.3, cut: 5000 }, 0.14);
  }
  if (kind === "throw") t({ wave: "triangle", f0: 300, f1: 700, dur: 0.18, gain: 0.18, noise: 0.4, cut: 3000 });
  if (kind === "charge") t({ wave: "sawtooth", f0: 70, f1: 240, dur: 0.95, gain: 0.3, noise: 0.5, cut: 1200, q: 3 });
  if (kind === "spin") t({ wave: "sawtooth", f0: 60, f1: 420, dur: 1.1, gain: 0.2, noise: 0.2, cut: 2000, q: 6 });
  if (kind === "launch") t({ wave: "sawtooth", f0: 200, f1: 60, dur: 0.5, gain: 0.3, noise: 1.2, cut: 2500 });
  if (kind === "boom") {
    t({ wave: "sine", f0: 90, f1: 30, dur: 0.7, gain: 0.8, noise: 1.3, cut: 1100 });
    t({ wave: "square", f0: 55, f1: 35, dur: 0.3, gain: 0.3, noise: 0, cut: 500 });
  }
  if (kind === "heal") t({ wave: "sine", f0: 660, f1: 1320, dur: 0.35, gain: 0.14, noise: 0, cut: 7000 });
  if (kind === "cloak") t({ wave: "sine", f0: 2400, f1: 600, dur: 0.5, gain: 0.12, noise: 0.15, cut: 9000, q: 12 });
  if (kind === "buzz") t({ wave: "sawtooth", f0: 190, f1: 230, dur: 0.35, gain: 0.12, noise: 0.1, cut: 2400, q: 5 });
  if (kind === "block") t({ wave: "triangle", f0: 1500, f1: 700, dur: 0.08, gain: 0.12, noise: 0.2, cut: 7000, q: 6 });
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
  // ice: cold bells over a relentless sub pulse — freezing, not restful
  ice: { roots: [50, 48, 45, 46], bpm: 104, arp: [0, 7, 12, 15, 19, 15, 12, 7], lead: "sine", leadCut: 9000, bass: "sine", kick: [0, 6, 8], snare: [4, 12], hat: "off", pad: true, arpRate: 2, oct: 12, bassRate: 2, leadLen: 1.2, echo: true },
  // forest: primal war drums and a tense minor pluck line
  forest: { roots: [45, 43, 41, 45], bpm: 128, arp: [0, 3, 7, 10, 12, 10, 7, 3], lead: "triangle", leadCut: 3200, bass: "square", kick: [0, 3, 6, 8, 11], snare: [4, 12], hat: "odd", arpRate: 1, oct: 12, bassRate: 2, leadLen: 0.7, wood: true },
  // magma: heavy, fast, distorted (kept as-is)
  magma: { roots: [40, 40, 41, 38], bpm: 136, arp: [0, 1, 7, 6, 0, 12, 1, 7], lead: "sawtooth", leadCut: 1800, bass: "sawtooth", kick: [0, 3, 6, 8, 11, 14], snare: [4, 12], hat: "all" },
  // blossom: driving ronin duel — sharp koto accents over taiko hits
  blossom: { roots: [45, 41, 40, 43], bpm: 124, arp: [0, 1, 5, 7, 8, 7, 5, 1], lead: "triangle", leadCut: 3200, bass: "square", kick: [0, 4, 6, 10, 12], snare: [4, 12], hat: "odd", arpRate: 1, oct: 12, bassRate: 2, leadLen: 0.7, swing: 0.1 },

  // abyss: very slow, deep sub drones and a lonely sonar ping
  abyss: { roots: [33, 36, 31, 34], bpm: 64, arp: [24, 19, 24, 31], lead: "sine", leadCut: 2500, bass: "sine", kick: [0, 10], snare: [], hat: "none", pad: true, arpRate: 8, oct: 12, bassRate: 16, leadLen: 5, echo: true },
  // cyber: four-on-the-floor electro, octave-jumping saw bass, off-beat hats
  cyber: { roots: [45, 45, 43, 48], bpm: 128, arp: [0, 12, 7, 12, 3, 12, 10, 12], lead: "square", leadCut: 6000, bass: "sawtooth", kick: [0, 4, 8, 12], snare: [4, 12], hat: "off", arpRate: 1, bassRate: 1, leadLen: 0.5 },
  // toxic: lurching industrial acid line, resonant squelch, broken beat
  // vice: 80s synthwave cruise, gated snare, echoing saw lead over pads
  vice: {
    roots: [45, 41, 43, 40],
    bpm: 108,
    arp: [0, 7, 12, 15, 12, 7, 3, 7],
    lead: "sawtooth",
    leadCut: 3200,
    bass: "sawtooth",
    kick: [0, 8],
    snare: [4, 12],
    hat: "off",
    pad: true,
    arpRate: 2,
    oct: 12,
    bassRate: 2,
    leadLen: 1.2,
    echo: true,
  },
  // alpine: an oompah-less mountain waltz: bells and a warm pad, wood clicks, soft bass
  alpine: {
    roots: [50, 55, 57, 52],
    bpm: 96,
    arp: [0, 4, 7, 12, 7, 4, 9, 7],
    lead: "triangle",
    leadCut: 5200,
    bass: "sine",
    kick: [0, 12],
    snare: [8],
    hat: "none",
    pad: true,
    arpRate: 2,
    oct: 12,
    bassRate: 8,
    leadLen: 1.8,
    echo: true,
    wood: true,
  },
  toxic: { roots: [40, 43, 40, 38], bpm: 104, arp: [0, 0, 12, 3, 0, 6, 12, 1], lead: "sawtooth", leadCut: 900, bass: "square", kick: [0, 3, 10], snare: [6, 14], hat: "odd", arpRate: 1, oct: 12, bassRate: 1, leadLen: 0.8, swing: 0.15 },
};
const MAP_STYLE: Record<string, string> = {
  "Dust Basin": "desert", "Canyon Mesa": "desert", "Frost Shelf": "ice", "Glacier Rift": "ice",
  "Mossy Woods": "forest", "Ash Crater": "magma", "Cherry Grove": "blossom",
  "Sunken Abyss": "abyss", "Neon Spire": "cyber", "Toxic Hollow": "toxic",
  "Vice Heights": "vice",
  "Whiteout Pass": "alpine",
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
  initAudio(); // safe if already running; also resumes a suspended context
  if (!ctx || timer !== null) return;
  nextT = ctx.currentTime + 0.05;
  timer = window.setInterval(() => {
    if (!ctx) return;
    if (ctx.state === "suspended") { void ctx.resume(); return; }
    const stepDur = 60 / (style.bpm + (intense ? 20 : 0)) / 4;
    // after a tab switch or a late unlock the clock jumps; never replay the backlog
    if (nextT < ctx.currentTime) nextT = ctx.currentTime + 0.02;
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

// ---- projectile / impact sounds (combat effects) ----
export type ImpactSound =
  | "metal" | "wall" | "boom" | "burst" | "ricochet" | "shatter" | "zap" | "thunk" | "splash" | "crack" | "casing" | "fizz";
const IMPACTS: Record<ImpactSound, Tone[]> = {
  // bullet on robot plating: bright clank with a short ring
  metal: [
    { wave: "square", f0: 1900, f1: 900, dur: 0.05, gain: 0.12, noise: 0.5, cut: 7000, q: 6 },
    { wave: "sine", f0: 3100, f1: 2600, dur: 0.09, gain: 0.05, noise: 0, cut: 9000, q: 12 },
  ],
  // bullet into concrete: dull chip
  wall: [{ wave: "triangle", f0: 420, f1: 120, dur: 0.06, gain: 0.12, noise: 0.9, cut: 2200 }],
  // BOOMER shell: deep thump plus a long gravelly tail
  boom: [
    { wave: "sine", f0: 90, f1: 28, dur: 0.9, gain: 0.9, noise: 0, cut: 600 },
    { wave: "sawtooth", f0: 60, f1: 30, dur: 0.7, gain: 0.35, noise: 1.4, cut: 1400 },
  ],
  // FLAK air burst: sharp crack that rolls off
  burst: [
    { wave: "square", f0: 260, f1: 70, dur: 0.4, gain: 0.35, noise: 1.3, cut: 2600 },
    { wave: "sine", f0: 120, f1: 40, dur: 0.45, gain: 0.35, noise: 0, cut: 500 },
  ],
  // REBOUNDER bounce: rising zing
  ricochet: [{ wave: "triangle", f0: 1500, f1: 3800, dur: 0.16, gain: 0.16, noise: 0.15, cut: 9000, q: 8 }],
  // GLACIER shard shattering: glassy tinkle
  shatter: [
    { wave: "sine", f0: 3400, f1: 2200, dur: 0.18, gain: 0.1, noise: 0.35, cut: 11000, q: 14 },
    { wave: "triangle", f0: 5200, f1: 4100, dur: 0.12, gain: 0.06, noise: 0, cut: 12000, q: 16 },
  ],
  // TESLA arc: buzzy crackle
  zap: [
    { wave: "sawtooth", f0: 140, f1: 90, dur: 0.18, gain: 0.16, noise: 0.8, cut: 5200, q: 3 },
    { wave: "square", f0: 2400, f1: 900, dur: 0.1, gain: 0.05, noise: 0.4, cut: 8000, q: 5 },
  ],
  // HARPOON sticking: woody thunk
  thunk: [{ wave: "sine", f0: 260, f1: 90, dur: 0.14, gain: 0.35, noise: 0.35, cut: 1500 }],
  splash: [{ wave: "sine", f0: 500, f1: 150, dur: 0.3, gain: 0.12, noise: 1.2, cut: 3200 }],
  // LANCE punching through: high snap
  crack: [{ wave: "sawtooth", f0: 3200, f1: 500, dur: 0.1, gain: 0.16, noise: 0.6, cut: 9000, q: 4 }],
  // spent brass hitting the floor
  casing: [{ wave: "sine", f0: 4200, f1: 3800, dur: 0.05, gain: 0.025, noise: 0, cut: 12000, q: 18 }],
  fizz: [{ wave: "sine", f0: 900, f1: 300, dur: 0.12, gain: 0.08, noise: 0.5, cut: 5000 }],
};
const lastImpact: Partial<Record<ImpactSound, number>> = {};
/** a positional-ish impact: quieter and duller with distance, throttled so a hose of bullets stays sane */
export function playImpact(kind: ImpactSound, dist = 0) {
  if (!ctx || dist > 70) return;
  const now = ctx.currentTime;
  const gap = kind === "boom" ? 0.08 : kind === "casing" ? 0.06 : 0.035;
  if (now - (lastImpact[kind] ?? -1) < gap) return;
  lastImpact[kind] = now;
  const k = Math.max(0.12, 1 - dist / 70);
  const far = dist > 18;
  IMPACTS[kind].forEach((t) => tone({ ...t, gain: t.gain * k, cut: far ? Math.min(t.cut, 1800) : t.cut }));
}
