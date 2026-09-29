// Procedural Web Audio: per-gun shot sounds, little UI blips and a synthwave loop.
let ctx: AudioContext | null = null;
let musicGain: GainNode | null = null;
let musicFilter: BiquadFilterNode | null = null;
let sfxGain: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let vol = { music: 0.5, sfx: 0.7 };
/** menu/lounge mode: muffled, drumless version of the arena track */
let menuMode = false;

export function initAudio() {
  if (typeof window === "undefined") return;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicFilter = ctx.createBiquadFilter();
    musicFilter.type = "lowpass";
    musicFilter.frequency.value = menuMode ? 5000 : 18000;
    sfxGain = ctx.createGain();
    musicGain.connect(musicFilter).connect(master);
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
  if (musicGain) musicGain.gain.value = vol.music * (menuMode ? 0.26 : 0.35);
  if (sfxGain) sfxGain.gain.value = vol.sfx * 0.6;
}
/** Menu screens hear the arena track through "blast doors": muffled, no drums. */
export function setMusicMenu(on: boolean) {
  if (menuMode === on) return;
  menuMode = on;
  applyVol();
  if (musicFilter && ctx) {
    musicFilter.frequency.cancelScheduledValues(ctx.currentTime);
    musicFilter.frequency.setValueAtTime(musicFilter.frequency.value, ctx.currentTime);
    musicFilter.frequency.exponentialRampToValueAtTime(on ? 5000 : 18000, ctx.currentTime + (on ? 0.6 : 0.9));
  }
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
  revolver: [{ wave: "square", f0: 300, f1: 60, dur: 0.3, gain: 0.5, noise: 1.1, cut: 2500 }],
  minigun: [{ wave: "square", f0: 700, f1: 250, dur: 0.04, gain: 0.16, noise: 0.5, cut: 4000 }],
  crossbow: [{ wave: "triangle", f0: 900, f1: 180, dur: 0.12, gain: 0.3, noise: 0.3, cut: 3500, q: 5 }],
  plasma: [{ wave: "sawtooth", f0: 500, f1: 1500, dur: 0.15, gain: 0.25, noise: 0, cut: 5000, q: 6 }],
  voidorb: [{ wave: "sine", f0: 90, f1: 400, dur: 0.5, gain: 0.5, noise: 0.2, cut: 2000, q: 8 }],
  shatter: [{ wave: "triangle", f0: 2200, f1: 400, dur: 0.25, gain: 0.3, noise: 0.8, cut: 7000 }],
  tesla: [
    { wave: "sawtooth", f0: 1200, f1: 400, dur: 0.14, gain: 0.25, noise: 0.3, cut: 7000, q: 12 },
    { wave: "square", f0: 60, f1: 50, dur: 0.14, gain: 0.2, noise: 0, cut: 800 },
  ],
};

export function playGun(w: string, quiet = false) {
  (GUN_SOUNDS[w] ?? GUN_SOUNDS['pistol']!).forEach((t) =>
    tone(quiet ? { ...t, gain: t.gain * 0.3, cut: Math.min(t.cut, 1400) } : t));
}

export function playSfx(kind: "shard" | "hurt" | "buy" | "pickup" | "deny" | "turret" | "boom") {
  if (kind === "boom") {
    // hazard prop rupturing: deep thump plus a long debris hiss
    tone({ wave: "sine", f0: 180, f1: 34, dur: 0.5, gain: 0.5, noise: 0.9, cut: 900 });
    if (ctx) tone({ wave: "sawtooth", f0: 90, f1: 40, dur: 0.7, gain: 0.22, noise: 1.6, cut: 2200 }, sfxGain, ctx.currentTime + 0.02);
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
  toxic: { roots: [40, 43, 40, 38], bpm: 104, arp: [0, 0, 12, 3, 0, 6, 12, 1], lead: "sawtooth", leadCut: 900, bass: "square", kick: [0, 3, 10], snare: [6, 14], hat: "odd", arpRate: 1, oct: 12, bassRate: 1, leadLen: 0.8, swing: 0.15 },
};
const MAP_STYLE: Record<string, string> = {
  "Dust Basin": "desert", "Canyon Mesa": "desert", "Frost Shelf": "ice", "Glacier Rift": "ice",
  "Mossy Woods": "forest", "Ash Crater": "magma", "Cherry Grove": "blossom",
  "Sunken Abyss": "abyss", "Neon Spire": "cyber", "Toxic Hollow": "toxic",
  "Whiteout Pass": "ice",
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

// Dedicated menu theme: slow, dark D-minor march — its own piece, not a map track.
const MENU_BPM = 72;
const MENU_ROOTS = [38, 34, 36, 33]; // D, Bb, C, A
const MENU_MOTIF = [[12, 10, 7, 5], [10, 7, 5, 3], [7, 10, 12, 15], [12, 13, 12, 7]];
function scheduleMenuStep(s: number, t: number, stepDur: number) {
  if (!musicGain) return;
  const bar = Math.floor(s / 16) % 4;
  const phrase = Math.floor(s / 64) % 2;
  const i = s % 16;
  const root = MENU_ROOTS[bar]!;
  const barLen = stepDur * 16;
  if (i === 0) {
    tone({ wave: "sine", f0: midi(root), f1: midi(root), dur: barLen, gain: 0.4, noise: 0, cut: 400 }, musicGain, t);
    const third = bar === 3 ? 16 : 15;
    [12, third, 19].forEach((iv) =>
      tone({ wave: "sawtooth", f0: midi(root + iv), f1: midi(root + iv), dur: barLen, gain: 0.06, noise: 0, cut: 1100, q: 2 }, musicGain, t));
  }
  // war-drum pulse
  if (i === 0 || i === 3 || i === 8 || (bar === 3 && (i === 12 || i === 14))) {
    tone({ wave: "sine", f0: 95, f1: 38, dur: 0.45, gain: i === 0 ? 0.8 : 0.5, noise: 0.15, cut: 500 }, musicGain, t);
  }
  if (i === 8 && phrase === 1) tone({ wave: "triangle", f0: 200, f1: 110, dur: 0.3, gain: 0.25, noise: 0.9, cut: 2200 }, musicGain, t);
  // solemn horn motif, second phrase only
  if (phrase === 1 && i % 4 === 0) {
    const n = root + 24 + MENU_MOTIF[bar]![i / 4]!;
    tone({ wave: "triangle", f0: midi(n), f1: midi(n), dur: stepDur * 3.6, gain: 0.13, noise: 0, cut: 2400 }, musicGain, t);
    tone({ wave: "triangle", f0: midi(n), f1: midi(n), dur: stepDur * 3.6, gain: 0.04, noise: 0, cut: 1400 }, musicGain, t + stepDur * 3);
  }
}

function scheduleStep(s: number, t0: number, stepDur: number) {
  if (!musicGain) return;
  if (menuMode) { scheduleMenuStep(s, t0, stepDur); return; }
  const S = style;
  const bar = Math.floor(s / 16) % 4;
  const i = s % 16;
  const t = t0 + (i % 2 === 1 ? (S.swing ?? 0) * stepDur : 0);
  const root = S.roots[bar]!;
  if (!menuMode) {
    if (S.kick.includes(i) || (intense && i % 4 === 0)) tone({ wave: "sine", f0: 150, f1: 40, dur: 0.22, gain: 0.9, noise: 0, cut: 600 }, musicGain, t);
    if (S.snare.includes(i)) {
      if (S.wood) tone({ wave: "sine", f0: 900, f1: 700, dur: 0.05, gain: 0.35, noise: 0.1, cut: 4000, q: 6 }, musicGain, t);
      else tone({ wave: "triangle", f0: 220, f1: 120, dur: 0.16, gain: 0.3, noise: 0.8, cut: 3500 }, musicGain, t);
    }
    const hat = S.hat === "all" || (S.hat === "odd" && i % 2 === 1) || (S.hat === "off" && i % 4 === 2) || intense;
    if (hat) tone({ wave: "square", f0: 0, f1: 0, dur: S.hat === "off" ? 0.08 : 0.04, gain: 0.12, noise: 1, cut: 9000 }, musicGain, t);
  } else if (i === 0 || i === 8) {
    // soft heartbeat pulse keeps the menu loop grounded without a drum kit
    tone({ wave: "sine", f0: 110, f1: 45, dur: 0.5, gain: 0.5, noise: 0, cut: 420 }, musicGain, t);
  }
  const bRate = S.bassRate ?? 2;
  if (i % bRate === 0 || intense) {
    const bassNote = bRate === 1 ? (i % 2 ? root + 12 : root) : i % 4 === 2 ? root + 12 : root;
    const bDur = S.bassRate ? Math.min(2.5, stepDur * bRate * 0.9) : 0.14;
    tone({ wave: S.bass, f0: midi(bassNote), f1: midi(bassNote), dur: bDur, gain: 0.35, noise: 0, cut: S.bass === "square" && bRate === 1 ? 500 + (i % 8) * 180 : 700, q: bRate === 1 ? 10 : 6 }, musicGain, t);
  }
  if ((S.pad || menuMode) && i === 0) {
    [0, 7, 15].forEach((iv) => tone({ wave: "sine", f0: midi(root + 12 + iv), f1: midi(root + 12 + iv), dur: stepDur * 16, gain: menuMode ? 0.13 : 0.08, noise: 0, cut: 3000 }, musicGain, t));
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
    const bpm = menuMode ? MENU_BPM : style.bpm + (intense ? 20 : 0);
    const stepDur = 60 / bpm / 4;
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
