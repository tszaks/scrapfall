// Background soundscapes: one procedural, layered ambience per map, under the music and effects.
//
// How it is built (and why it stays cheap):
// - Beds: a few looping noise / oscillator voices per map (wind, traffic wash, surf, hum), each
//   through its own filter, level, lowpass and stereo pan. Built ONCE when the map loads and then
//   only steered (setTargetAtTime), ~15 times a second. The noise buffers are generated once.
// - Spots: positional beds follow the nearest emitter of their kind (the nearest neon sign, the
//   saloon, the chairlift cable, the shoreline): louder and brighter up close, panned by the
//   listener's facing.
// - Events: short one-shots (a horn, a gull, a coyote, a church bell) fire at randomised
//   intervals, a few seconds apart at most, and clean themselves up. A live-node cap keeps
//   bursts bounded.
// - Tunes: the saloon piano and the pier's carnival organ are tiny note schedulers that play
//   into a positional channel.
// Night vs sunset and the map's weather hazard change which layers play and how loud.
import { ambienceOut, weatherLevel } from "./audio";

// ---------------------------------------------------------------------------------------
// public state

export type AmbienceTime = "night" | "sunset";
/** An emitter position (world metres). */
export type AmbSpot = { x: number; z: number };

type Env = {
  x: number;
  y: number;
  z: number;
  /** listener facing (unit vector on the ground plane) */
  fx: number;
  fz: number;
  night: boolean;
  /** 0..1 grid power where the listener stands (a blackout drops it): electric layers follow it */
  power: number;
  /** 0..1, eased: the boss round's hazard, or the map's live weather */
  hazard: number;
  /** 0..1, eased: Vice Heights rain (its own soundscape, separate from the hazard) */
  rain: number;
  /** 0..1, eased: a blackout is on somewhere in the city */
  blackout: number;
  /** seconds since the scene started */
  t: number;
};

const scene = {
  map: "",
  layout: "",
  world: null as unknown,
  night: true,
  power: 1,
  active: false,
  hazardTarget: 0,
  weather: 0,
  rain: 0,
  blackout: false,
  indoor: 0,
  /** a moving emitter: the loudest nearby car (tyres on wet road), and its speed */
  tyre: { x: 0, z: 0, speed: 0 },
  /** positions registered by map code (setAmbienceSpots), merged over the derived ones */
  extraSpots: {} as Record<string, AmbSpot[]>,
  dirty: true,
};

/** Which map is loaded. `layout` is the big-map generator ("city", "alpine", "western", "beach"),
 * `world` the generated layout object (positions are read from it, duck-typed). */
export function setAmbienceScene(map: string, layout: string, world: unknown) {
  if (scene.map === map && scene.layout === layout && scene.world === world) return;
  scene.map = map;
  scene.layout = layout;
  scene.world = world;
  scene.extraSpots = {};
  scene.dirty = true;
}
export function setAmbienceTime(t: AmbienceTime) {
  scene.night = t === "night";
}
/** Grid power at the listener, 0..1 (map events: the Vice Heights blackout kills the neon). */
export function setAmbiencePower(p: number) {
  scene.power = Math.max(0, Math.min(1, p));
}
/** On while the game is being played (mirrors the music): paused / menus fade it out. */
export function setAmbienceActive(on: boolean) {
  scene.active = on;
  if (!rt) return;
  const now = rt.ctx.currentTime;
  rt.pause.gain.cancelScheduledValues(now);
  rt.pause.gain.setTargetAtTime(on ? 1 : 0, now, on ? 0.6 : 0.15);
}
/** The map's hazard is live (the boss round). Eases in over ~8 s. */
export function setAmbienceHazard(on: boolean) {
  scene.hazardTarget = on ? 1 : 0;
}
/** Live weather strength 0..1 from map code (a dust storm), on top of the boss-round hazard. */
/** Rain strength 0..1 (Vice Heights: cityWeather's rainIntensity()). Its own layers, not the hazard. */
export function setAmbienceRain(k: number) {
  scene.rain = Math.max(0, Math.min(1, k));
}
/** A blackout is on (Vice Heights): car alarms and an alarmed crowd in the dark. */
export function setAmbienceBlackout(on: boolean) {
  scene.blackout = on;
}
/**
 * How enclosed the listener is, 0 (outside) .. 1 (sealed in an elevator car). The whole
 * ambience goes through a low-pass and loses some level, so the city and the rain sound
 * muffled through walls, not just quieter.
 */
export function setIndoor(amount: number) {
  scene.indoor = Math.max(0, Math.min(1, amount));
}
/** The nearest moving car (Traffic.tsx): its tyres hiss on wet roads. */
export function setAmbienceTraffic(speed: number, x: number, z: number) {
  scene.tyre.speed = speed;
  scene.tyre.x = x;
  scene.tyre.z = z;
}
export function setAmbienceWeather(k: number) {
  scene.weather = Number.isFinite(k) ? Math.max(0, Math.min(1, k)) : 0;
}
/**
 * Emitter positions from map code, by kind ("saloon", "horses", "windmill", "sign", "carnival",
 * "wheel", "skate", "crowd", "church", "fire", "cable", "tower"...). Replaces the derived list for
 * each kind given.
 */
export function setAmbienceSpots(spots: Record<string, AmbSpot[]>) {
  scene.extraSpots = { ...scene.extraSpots, ...spots };
  if (rt) rt.spots = { ...rt.spots, ...spots };
}

/** For the offline harness: live and persistent node counts. */
export function ambienceStats() {
  return {
    profile: rt?.profile ?? "",
    persistent: rt?.persistent ?? 0,
    live: rt ? liveNodes(rt) : 0,
    fired: rt?.fired ?? 0,
    rain: rt?.rain ?? 0,
    blackout: rt?.blackout ?? 0,
    indoor: rt?.indoor ?? 0,
    layers: rt ? rt.layers.map((l) => ({ name: l.name, gain: Math.round(l.lastGain * 1000) / 1000 })) : [],
  };
}

// ---------------------------------------------------------------------------------------
// runtime (rebuilt when the map changes)

type Chan = { level: GainNode; lp: BiquadFilterNode; pan: StereoPannerNode | null; input: AudioNode };
type Drift = { v: number; target: number; next: number; lo: number; hi: number; every: [number, number] };
type Layer = {
  name: string;
  chan: Chan;
  /** base gain of the layer */
  gain: number;
  /** 0..1 level from the environment (and the spot distance when positional) */
  level: (e: Env, d: Dist | null) => number;
  spot?: string | undefined;
  ref?: number | undefined;
  range?: number | undefined;
  /** a filter whose frequency drifts (wind gusts, traffic swell) */
  sweep?: { param: AudioParam; base: number; spread: number; drift: Drift };
  swell?: Drift;
  /** a tune scheduled into this channel */
  tune?: (at: number, e: Env) => number;
  nextNote?: number;
  lastGain: number;
  /** stop callbacks for its persistent sources */
  srcs: AudioScheduledSourceNode[];
};
type Dist = { d: number; pan: number; behind: number };
type EventDef = {
  name: string;
  every: [number, number];
  /** weight 0..1 from the environment: 0 = never */
  when: (e: Env) => number;
  /** "far": a random direction far away; "overhead": sweeps across; a spot kind: near that emitter */
  at: string;
  range?: number | undefined;
  play: (o: AudioNode, t: number, R: Runtime) => number;
  next: number;
};

type Runtime = {
  ctx: BaseAudioContext;
  bus: AudioNode;
  pause: GainNode;
  noise: AudioBuffer;
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
  profile: string;
  layers: Layer[];
  events: EventDef[];
  spots: Record<string, AmbSpot[]>;
  lines: Record<string, (x: number, z: number) => AmbSpot>;
  persistent: number;
  /** short-lived event sources still playing, with the node count each one holds */
  active: Map<AudioScheduledSourceNode, number>;
  fired: number;
  t0: number;
  lastUpdate: number;
  hazard: number;
  rain: number;
  blackout: number;
  indoor: number;
  /** the enclosure filter: every layer -> pause -> occlusion lowpass + level -> bus */
  occl: BiquadFilterNode;
  occlGain: GainNode;
  /** partly covered spots on this map (the alpine covered bridge): rect + how enclosed */
  cover: (Rect & { k: number })[];
  drops: AudioBuffer;
  patter: AudioBuffer;
};

let rt: Runtime | null = null;
function liveNodes(R: Runtime) {
  let n = 0;
  for (const v of R.active.values()) n += v;
  return n;
}
let bufCtx: BaseAudioContext | null = null;
let bufs: { white: AudioBuffer; pink: AudioBuffer; brown: AudioBuffer; drops: AudioBuffer; patter: AudioBuffer } | null = null;

/** three 5 s noise colours, generated once per audio context */
function noiseBuffers(ctx: BaseAudioContext) {
  if (bufs && bufCtx === ctx) return bufs;
  const len = Math.floor(ctx.sampleRate * 5);
  const mk = () => ctx.createBuffer(1, len, ctx.sampleRate);
  const white = mk();
  const pink = mk();
  const brown = mk();
  const w = white.getChannelData(0);
  const p = pink.getChannelData(0);
  const b = brown.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < len; i++) {
    const r = Math.random() * 2 - 1;
    w[i] = r;
    // Paul Kellet's pink filter
    b0 = 0.99886 * b0 + r * 0.0555179;
    b1 = 0.99332 * b1 + r * 0.0750759;
    b2 = 0.969 * b2 + r * 0.153852;
    b3 = 0.8665 * b3 + r * 0.3104856;
    b4 = 0.55 * b4 + r * 0.5329522;
    b5 = -0.7616 * b5 - r * 0.016898;
    p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + r * 0.5362) * 0.11;
    b6 = r * 0.115926;
    br = (br + 0.02 * r) / 1.02;
    b[i] = br * 3.5;
  }
  // crossfade the ends so the 5 s loop has no click
  const fade = Math.floor(ctx.sampleRate * 0.05);
  for (const d of [w, p, b]) {
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[len - fade + i] = d[len - fade + i]! * (1 - k) + d[i]! * k;
    }
  }
  // rain: sparse heavy drops and a dense patter, as trains of tiny decaying clicks
  const clicks = (perSec: number, decay: number) => {
    const buf = mk();
    const d = buf.getChannelData(0);
    const n = Math.floor(perSec * 5);
    const tail = Math.floor(ctx.sampleRate * decay);
    for (let k = 0; k < n; k++) {
      const at = Math.floor(Math.random() * (len - tail));
      const a = 0.3 + Math.random() * 0.7;
      for (let i = 0; i < tail; i++) d[at + i] = d[at + i]! + (Math.random() * 2 - 1) * a * Math.exp((-6 * i) / tail);
    }
    return buf;
  };
  bufs = { white, pink, brown, drops: clicks(22, 0.012), patter: clicks(260, 0.004) };
  bufCtx = ctx;
  return bufs;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function chan(R: Runtime, bright = 18000): Chan {
  const { ctx } = R;
  const level = ctx.createGain();
  level.gain.value = 0;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = bright;
  lp.Q.value = 0.5;
  const pan = typeof ctx.createStereoPanner === "function" ? ctx.createStereoPanner() : null;
  level.connect(lp);
  if (pan) lp.connect(pan).connect(R.pause);
  else lp.connect(R.pause);
  R.persistent += pan ? 3 : 2;
  return { level, lp, pan, input: level };
}

function drift(lo: number, hi: number, every: [number, number]): Drift {
  const v = rnd(lo, hi);
  return { v, target: v, next: 0, lo, hi, every };
}
function stepDrift(d: Drift, t: number, dt: number) {
  if (t >= d.next) {
    d.target = rnd(d.lo, d.hi);
    d.next = t + rnd(d.every[0], d.every[1]);
  }
  // ease toward the target over roughly the interval
  const k = 1 - Math.exp(-dt / Math.max(0.3, d.every[0] * 0.5));
  d.v += (d.target - d.v) * k;
  return d.v;
}

type FilterSpec = { type: BiquadFilterType; f: number; q?: number };
type BedSpec = {
  name: string;
  src: "white" | "pink" | "brown" | "drops" | "patter" | { osc: OscillatorType; f: number[] };
  filters: FilterSpec[];
  gain: number;
  level: Layer["level"];
  spot?: string;
  ref?: number;
  range?: number;
  /** drift the first filter's frequency by +-spread (fraction) */
  sweep?: { spread: number; every: [number, number] };
  /** drift the level between lo..hi */
  swell?: [number, number, number, number];
  rate?: number;
};

/** a looping bed: noise or oscillators -> filters -> positional channel */
function bed(R: Runtime, b: BedSpec): Layer {
  const { ctx } = R;
  const c = chan(R);
  const filters = b.filters.map((f) => {
    const n = ctx.createBiquadFilter();
    n.type = f.type;
    n.frequency.value = f.f;
    n.Q.value = f.q ?? 0.7;
    return n;
  });
  R.persistent += filters.length;
  let head: AudioNode = c.input;
  for (let i = filters.length - 1; i >= 0; i--) {
    filters[i]!.connect(head);
    head = filters[i]!;
  }
  const srcs: AudioScheduledSourceNode[] = [];
  if (typeof b.src === "string") {
    const s = ctx.createBufferSource();
    s.buffer = R[b.src];
    s.loop = true;
    s.playbackRate.value = b.rate ?? 1;
    s.connect(head);
    // each bed starts at a different point of the buffer so two beds never phase together
    s.start(ctx.currentTime, Math.random() * 4.5);
    srcs.push(s);
    R.persistent += 1;
  } else {
    const mix = ctx.createGain();
    mix.gain.value = 1 / b.src.f.length;
    mix.connect(head);
    R.persistent += 1;
    for (const f of b.src.f) {
      const o = ctx.createOscillator();
      o.type = b.src.osc;
      o.frequency.value = f;
      o.connect(mix);
      o.start();
      srcs.push(o);
      R.persistent += 1;
    }
  }
  const L: Layer = { name: b.name, chan: c, gain: b.gain, level: b.level, spot: b.spot, ref: b.ref, range: b.range, lastGain: 0, srcs };
  if (b.sweep && filters[0]) {
    L.sweep = { param: filters[0].frequency, base: b.filters[0]!.f, spread: b.sweep.spread, drift: drift(-1, 1, b.sweep.every) };
  }
  if (b.swell) L.swell = drift(b.swell[0], b.swell[1], [b.swell[2], b.swell[3]]);
  R.layers.push(L);
  return L;
}

/** a positional channel that a tune schedules notes into */
function tuneLayer(R: Runtime, name: string, spot: string, gain: number, ref: number, range: number, level: Layer["level"], tune: (o: AudioNode, at: number) => number) {
  const c = chan(R);
  const L: Layer = {
    name,
    chan: c,
    gain,
    level,
    spot,
    ref,
    range,
    lastGain: 0,
    srcs: [],
    nextNote: 0,
    tune: (at) => tune(c.input, at),
  };
  R.layers.push(L);
  return L;
}

function ev(R: Runtime, name: string, every: [number, number], at: string, when: EventDef["when"], play: EventDef["play"], range?: number) {
  R.events.push({ name, every, at, when, play, range, next: R.ctx.currentTime + rnd(every[0] * 0.3, every[1]) });
}

// ---------------------------------------------------------------------------------------
// one-shot building blocks (all nodes are short-lived; `track` counts them while alive)

function track(R: Runtime, s: AudioScheduledSourceNode, extra: number, cleanup?: () => void) {
  R.active.set(s, 1 + extra);
  s.onended = () => {
    R.active.delete(s);
    s.disconnect();
    cleanup?.();
  };
}

type Blip = { type?: OscillatorType; f0: number; f1?: number; dur: number; gain: number; attack?: number; vib?: [number, number]; cut?: number; q?: number };
/** an oscillator note with a glide, optional vibrato and lowpass */
function blip(R: Runtime, o: AudioNode, t: number, b: Blip) {
  const { ctx } = R;
  // nothing at or above Nyquist (a bell's high partials): it can't be heard, only warned about
  const nyq = ctx.sampleRate * 0.45;
  if (!(b.f0 > 0) || b.f0 >= nyq || !(b.gain > 0) || !Number.isFinite(t)) return;
  const osc = ctx.createOscillator();
  osc.type = b.type ?? "sine";
  osc.frequency.setValueAtTime(b.f0, t);
  if (b.f1 && b.f1 !== b.f0) osc.frequency.exponentialRampToValueAtTime(Math.min(nyq, Math.max(1, b.f1)), t + b.dur);
  const g = ctx.createGain();
  const a = b.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(b.gain, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + b.dur);
  let extra = 1;
  if (b.cut) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = b.cut;
    f.Q.value = b.q ?? 0.7;
    osc.connect(f).connect(g);
    extra++;
  } else osc.connect(g);
  g.connect(o);
  if (b.vib) {
    const l = ctx.createOscillator();
    l.frequency.value = b.vib[0];
    const d = ctx.createGain();
    d.gain.value = b.f0 * b.vib[1];
    l.connect(d).connect(osc.frequency);
    l.start(t);
    l.stop(t + b.dur + 0.05);
    track(R, l, 1);
  }
  osc.start(t);
  osc.stop(t + b.dur + 0.05);
  track(R, osc, extra);
}

type Burst = { buf?: "white" | "pink" | "brown"; type?: BiquadFilterType; f: number; f1?: number; q?: number; dur: number; gain: number; attack?: number; rate?: number };
/** a filtered noise burst with an envelope (and an optional filter sweep) */
function burst(R: Runtime, o: AudioNode, t: number, b: Burst) {
  const { ctx } = R;
  const s = ctx.createBufferSource();
  s.buffer = b.buf === "pink" ? R.pink : b.buf === "brown" ? R.brown : R.white;
  s.playbackRate.value = b.rate ?? 1;
  const f = ctx.createBiquadFilter();
  f.type = b.type ?? "bandpass";
  f.frequency.setValueAtTime(b.f, t);
  if (b.f1) f.frequency.exponentialRampToValueAtTime(b.f1, t + b.dur);
  f.Q.value = b.q ?? 1;
  const g = ctx.createGain();
  const a = b.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(b.gain, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + b.dur);
  s.connect(f).connect(g).connect(o);
  s.start(t, Math.random() * 4);
  s.stop(t + b.dur + 0.05);
  track(R, s, 2);
}

/** a struck bell: inharmonic partials, high ones dying first */
function bell(R: Runtime, o: AudioNode, t: number, f: number, gain: number, ring = 3) {
  [[1, 1], [2.0, 0.55], [2.76, 0.4], [5.4, 0.18], [8.9, 0.08]].forEach(([m, a], i) =>
    blip(R, o, t, { f0: f * m!, dur: ring / (1 + i * 0.7), gain: gain * a!, attack: 0.003 }));
}

/** a wooden creak: a rough low tone sliding in pitch through a resonant band */
function creak(R: Runtime, o: AudioNode, t: number, f: number, dur: number, gain: number) {
  blip(R, o, t, { type: "sawtooth", f0: f, f1: f * rnd(0.7, 1.4), dur, gain, attack: dur * 0.3, vib: [rnd(18, 32), 0.08], cut: 1100, q: 6 });
}

/**
 * A temporary output for one event: level, distance lowpass and pan (static for the event).
 * Call `done(seconds)` once the event's length is known; the chain is torn down after it.
 */
function place(R: Runtime, gain: number, pan: number, bright: number) {
  const { ctx } = R;
  const g = ctx.createGain();
  g.gain.value = fin(gain, 0);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = Math.min(ctx.sampleRate * 0.45, fin(bright, 18000));
  pan = fin(pan, 0);
  const p = typeof ctx.createStereoPanner === "function" ? ctx.createStereoPanner() : null;
  g.connect(lp);
  if (p) {
    p.pan.value = Math.max(-1, Math.min(1, pan));
    lp.connect(p).connect(R.pause);
  } else lp.connect(R.pause);
  // a silent keeper source so the chain is torn down once the event is over
  const keep = ctx.createConstantSource();
  keep.offset.value = 0;
  keep.connect(g);
  const t0 = ctx.currentTime;
  keep.start(t0);
  track(R, keep, p ? 3 : 2, () => {
    g.disconnect();
    lp.disconnect();
    p?.disconnect();
  });
  return { out: g, pan: p, done: (dur: number) => keep.stop(t0 + dur + 0.5) };
}

// ---------------------------------------------------------------------------------------
// positions

function nearestPoint(list: AmbSpot[] | undefined, x: number, z: number): AmbSpot | null {
  if (!list || list.length === 0) return null;
  let best = list[0]!;
  let bd = Infinity;
  for (const p of list) {
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

/** distance and pan from the listener to a point */
function relTo(e: Env, p: AmbSpot): Dist {
  const dx = p.x - e.x;
  const dz = p.z - e.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) return { d: 0, pan: 0, behind: 0 };
  // camera right = (-fz, fx) on the ground plane
  const side = (dx * -e.fz + dz * e.fx) / d;
  const front = (dx * e.fx + dz * e.fz) / d;
  const near = clamp01(d / 4); // standing on it: centred
  return { d, pan: side * 0.85 * near, behind: clamp01(-front) * near };
}

/** where a spot kind is relative to the listener; maps without data get a fixed virtual spot */
function locate(R: Runtime, e: Env, kind: string): Dist {
  const line = R.lines[kind];
  if (line) return relTo(e, line(e.x, e.z));
  const p = nearestPoint(R.spots[kind], e.x, e.z);
  if (p) return relTo(e, p);
  // no position known (layout not wired): a steady spot ~45 m off in a direction fixed per kind
  let h = 0;
  for (let i = 0; i < kind.length; i++) h = (h * 31 + kind.charCodeAt(i)) % 360;
  const a = (h / 180) * Math.PI;
  return relTo(e, { x: e.x + Math.cos(a) * 45, z: e.z + Math.sin(a) * 45 });
}

/** a finite number, or the fallback */
function fin(v: number, fallback: number) {
  return Number.isFinite(v) ? v : fallback;
}
/** loudness 0..1 at distance d: flat inside `ref`, inverse-square-ish after, gone at `range` */
function falloff(d: number, ref: number, range: number) {
  const k = ref / (ref + Math.max(0, d - ref));
  const edge = clamp01((range - d) / (range * 0.35));
  return k * k * edge;
}
/** distance lowpass: the air eats the highs */
function brightAt(d: number, behind: number) {
  return (600 + 17000 * Math.exp(-d / 70)) * (1 - 0.35 * behind);
}

// ---------------------------------------------------------------------------------------
// update: called every frame by the listener (throttled here)

let lastEnv: Env | null = null;

export function updateAmbience(x: number, y: number, z: number, fx: number, fz: number) {
  const A = ambienceOut();
  if (!A) return;
  if (!rt || rt.ctx !== A.ctx || scene.dirty) build(A.ctx, A.out, A.noise);
  const R = rt!;
  const now = R.ctx.currentTime;
  const dt = now - R.lastUpdate;
  if (dt < 1 / 15) return;
  R.lastUpdate = now;
  const fl = Math.hypot(fx, fz) || 1;
  const hzTarget = Math.max(scene.hazardTarget, scene.weather, weatherLevel());
  R.hazard += (hzTarget - R.hazard) * (1 - Math.exp(-Math.min(dt, 0.5) / 3));
  const ease = (v: number, target: number, tau: number) => v + (target - v) * (1 - Math.exp(-Math.min(dt, 0.5) / tau));
  R.rain = ease(R.rain, scene.rain, 1.5);
  R.blackout = ease(R.blackout, scene.blackout ? 1 : 0, 2);
  // enclosure: the access code's value, or a covered spot of this map (the covered bridge)
  let enc = scene.indoor;
  for (const c of R.cover) if (x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1) enc = Math.max(enc, c.k);
  if (Math.abs(enc - R.indoor) > 0.005) {
    R.indoor = enc;
    // 20 kHz outside, ~320 Hz sealed in; the walls also take ~9 dB off
    R.occl.frequency.setTargetAtTime(Math.min(R.ctx.sampleRate * 0.45, 20000 * Math.pow(320 / 20000, enc)), now, 0.18);
    R.occlGain.gain.setTargetAtTime(1 - 0.65 * enc, now, 0.18);
  }
  R.spots["tyre"] = [{ x: scene.tyre.x, z: scene.tyre.z }];
  const e: Env = { x, y, z, fx: fx / fl, fz: fz / fl, night: scene.night, power: scene.power, hazard: R.hazard, rain: R.rain, blackout: R.blackout, t: now - R.t0 };
  lastEnv = e;
  // while paused the beds are faded out by the pause gain; skip the work too
  if (!scene.active) return;
  for (const L of R.layers) {
    const loc = L.spot ? locate(R, e, L.spot) : null;
    let g = L.level(e, loc) * L.gain;
    if (loc) g *= falloff(loc.d, L.ref ?? 10, L.range ?? 120);
    if (L.swell) g *= stepDrift(L.swell, e.t, dt);
    if (L.sweep) {
      const v = stepDrift(L.sweep.drift, e.t, dt);
      L.sweep.param.setTargetAtTime(fin(L.sweep.base * (1 + v * L.sweep.spread), L.sweep.base), now, 0.4);
    }
    // (a NaN here, e.g. standing exactly on an emitter, would throw and skip the rest of the
    // update: every value set on an AudioParam goes through fin())
    if (!Number.isFinite(g)) g = 0;
    L.lastGain = g;
    L.chan.level.gain.setTargetAtTime(g, now, 0.35);
    if (loc) {
      L.chan.lp.frequency.setTargetAtTime(fin(Math.min(R.ctx.sampleRate * 0.45, brightAt(loc.d, loc.behind)), 18000), now, 0.25);
      L.chan.pan?.pan.setTargetAtTime(Math.max(-1, Math.min(1, fin(loc.pan, 0))), now, 0.15);
    }
    if (L.tune && g > 0.0005) {
      if ((L.nextNote ?? 0) < now) L.nextNote = now + 0.05;
      while (L.nextNote! < now + 0.25) L.nextNote! += L.tune(L.nextNote!, e);
    }
  }
  for (const E of R.events) {
    if (now < E.next) continue;
    E.next = now + rnd(E.every[0], E.every[1]);
    const w = E.when(e);
    if (w <= 0 || Math.random() > w) continue;
    if (liveNodes(R) > 90) continue; // a burst is already playing out: skip rather than pile up
    fire(R, E, e);
  }
}

function fire(R: Runtime, E: EventDef, e: Env) {
  const t = R.ctx.currentTime + 0.03;
  let gain = 1;
  let pan = rnd(-0.9, 0.9);
  let bright = 18000;
  if (E.at === "far") {
    gain = rnd(0.35, 0.8);
    bright = rnd(1200, 3500);
  } else if (E.at === "near") {
    gain = rnd(0.7, 1);
    bright = 16000;
  } else if (E.at !== "overhead") {
    const loc = locate(R, e, E.at);
    const range = E.range ?? 60;
    if (loc.d > range) return;
    // near a spot kind: jitter the source a little around the emitter
    gain = falloff(loc.d, 6, range);
    if (gain < 0.02) return;
    pan = loc.pan;
    bright = brightAt(loc.d, loc.behind);
  }
  const { out, pan: p, done } = place(R, gain, pan, Math.min(R.ctx.sampleRate * 0.45, bright));
  const dur = E.play(out, t, R);
  done(dur + 0.1);
  if (E.at === "overhead" && p) {
    // a pass from one side to the other
    const from = Math.random() < 0.5 ? -1 : 1;
    p.pan.setValueAtTime(from * 0.95, t);
    p.pan.linearRampToValueAtTime(-from * 0.95, t + dur);
  }
  R.fired++;
}

/** Nearest known emitter of a kind (instrumentation / map code); null if the map has none. */
export function ambienceNearest(kind: string, x: number, z: number): AmbSpot | null {
  if (!rt) return null;
  const line = rt.lines[kind];
  return line ? line(x, z) : nearestPoint(rt.spots[kind], x, z);
}

/** the listener's last known state (for code that wants to place a sound) */
export function ambienceListener() {
  return lastEnv;
}

// ---------------------------------------------------------------------------------------
// building a scene

function teardown() {
  if (!rt) return;
  for (const L of rt.layers) {
    for (const s of L.srcs) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
      s.disconnect();
    }
    L.chan.level.disconnect();
    L.chan.lp.disconnect();
    L.chan.pan?.disconnect();
  }
  rt.pause.disconnect();
  rt.occl.disconnect();
  rt.occlGain.disconnect();
  rt = null;
}

function build(ctx: BaseAudioContext, bus: AudioNode, noise: AudioBuffer) {
  teardown();
  scene.dirty = false;
  const b = noiseBuffers(ctx);
  const pause = ctx.createGain();
  pause.gain.value = scene.active ? 1 : 0;
  const occl = ctx.createBiquadFilter();
  occl.type = "lowpass";
  occl.frequency.value = 20000;
  occl.Q.value = 0.4;
  const occlGain = ctx.createGain();
  pause.connect(occl).connect(occlGain).connect(bus);
  const R: Runtime = {
    ctx,
    bus,
    pause,
    noise,
    ...b,
    profile: "",
    layers: [],
    events: [],
    spots: {},
    lines: {},
    persistent: 1,
    active: new Map(),
    fired: 0,
    t0: ctx.currentTime,
    lastUpdate: -1,
    hazard: 0,
    rain: 0,
    blackout: 0,
    indoor: -1,
    occl,
    occlGain,
    cover: [],
  };
  rt = R;
  const key = profileFor(scene.map, scene.layout, scene.world);
  R.profile = key;
  deriveSpots(R, key, scene.world);
  R.spots = { ...R.spots, ...scene.extraSpots };
  (PROFILES[key] ?? PROFILES["dunes"]!)(R);
}

// ---------------------------------------------------------------------------------------
// which soundscape

const MAP_PROFILE: Record<string, string> = {
  "Vice Heights": "vice",
  "Dry Gulch": "gulch",
  "Pacific Pier": "pier",
  "Whiteout Pass": "alpine",
  "Dust Basin": "dunes",
  "Canyon Mesa": "canyon",
  "Frost Shelf": "ice",
  "Glacier Rift": "ice",
  "Mossy Woods": "forest",
  "Ash Crater": "lava",
  "Cherry Grove": "blossom",
  "Sunken Abyss": "abyss",
  "Neon Spire": "cyber",
  "Toxic Hollow": "toxic",
};
const LAYOUT_PROFILE: Record<string, string> = { city: "vice", western: "gulch", beach: "pier", alpine: "alpine" };

/** Map a map name (or, for renamed maps, its layout / world shape) to a soundscape. */
export function profileFor(map: string, layout: string, world: unknown): string {
  const byName = MAP_PROFILE[map];
  if (byName) return byName;
  const w = world as Record<string, unknown> | null;
  if (w && typeof w === "object") {
    if ("beach" in w) return "pier";
    if ("alpine" in w) return "alpine";
    if (w["kind"] === "western") return "gulch";
  }
  return LAYOUT_PROFILE[layout] ?? "dunes";
}
/** Register a soundscape for a map name (a new or renamed map). */
export function registerAmbienceMap(map: string, profile: string) {
  MAP_PROFILE[map] = profile;
  if (scene.map === map) scene.dirty = true;
}

// ---------------------------------------------------------------------------------------
// positions per big map, read (duck-typed) from the generated layout

type Rect = { x0: number; z0: number; x1: number; z1: number };
type AnyBld = Rect & { t: string; front?: number; backdrop?: boolean; coop?: boolean };
type AnyProp = { k: string; x: number; z: number };
const ctr = (r: Rect): AmbSpot => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });
/** the middle of a building's street face */
function frontOf(b: AnyBld): AmbSpot {
  const c = ctr(b);
  if (b.front === 0) return { x: c.x, z: b.z0 };
  if (b.front === 1) return { x: b.x1, z: c.z };
  if (b.front === 2) return { x: c.x, z: b.z1 };
  if (b.front === 3) return { x: b.x0, z: c.z };
  return c;
}
const clampTo = (v: number, a: number, b: number) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), v));
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function deriveSpots(R: Runtime, key: string, world: unknown) {
  const w = world as Record<string, unknown> | null;
  if (!w || typeof w !== "object") return;
  try {
    if (key === "vice") viceSpots(R, w);
    else if (key === "alpine") alpineSpots(R, w);
    else if (key === "gulch") gulchSpots(R, w);
    else if (key === "pier") pierSpots(R, w);
  } catch {
    // a layout shape we don't understand: the virtual spots take over
  }
}

function viceSpots(R: Runtime, w: Record<string, unknown>) {
  const half = Number(w["half"]) || 300;
  const roadX = arr<{ c: number; cls: string }>(w["roadX"]);
  const roadZ = arr<{ c: number; cls: string }>(w["roadZ"]);
  const roadLine = (busy: boolean) => (x: number, z: number): AmbSpot => {
    let best: AmbSpot = { x: 0, z: 0 };
    let bd = Infinity;
    for (const r of roadX) {
      if (busy && r.cls === "side") continue;
      const p = { x: r.c, z: clampTo(z, -half, half) };
      const d = Math.abs(x - r.c);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    for (const r of roadZ) {
      if (busy && r.cls === "side") continue;
      const d = Math.abs(z - r.c);
      if (d < bd) {
        bd = d;
        best = { x: clampTo(x, -half, half), z: r.c };
      }
    }
    return best;
  };
  if (roadX.length + roadZ.length > 0) {
    R.lines["road"] = roadLine(false);
    R.lines["street"] = roadLine(true);
  }
  const waterZ = Number(w["waterZ"]);
  // the surf is a few metres past the waterfront railing
  if (Number.isFinite(waterZ)) R.lines["water"] = (x, z) => ({ x, z: Math.max(z, waterZ + 8) });
  const park = w["park"] as Rect | null;
  if (park) R.lines["park"] = (x, z) => ({ x: clampTo(x, park.x0, park.x1), z: clampTo(z, park.z0, park.z1) });
  const signs: AmbSpot[] = [];
  for (const b of arr<AnyBld>(w["buildings"])) {
    if (b.backdrop) continue;
    if (["diner", "hotel", "gas", "mall", "corner", "low", "convention"].includes(b.t)) signs.push(frontOf(b));
  }
  R.spots["sign"] = signs;
  R.spots["awning"] = arr<AnyBld>(w["buildings"]).filter((b) => !b.backdrop).map(frontOf);
}

function alpineSpots(R: Runtime, w: Record<string, unknown>) {
  const a = w["alpine"] as Record<string, unknown>;
  const blds = arr<AnyBld>(a["buildings"]);
  R.spots["fire"] = blds.filter((b) => ["chalet", "lodge", "hotel", "cafe", "hut"].includes(b.t)).map(ctr);
  R.spots["church"] = blds.filter((b) => b.t === "church").map(ctr);
  const lift = a["lift"] as { x: number; supports: { z: number; kind: string }[] } | undefined;
  if (lift && lift.supports.length > 1) {
    const zs = lift.supports.map((s) => s.z);
    const z0 = Math.min(...zs);
    const z1 = Math.max(...zs);
    R.lines["cable"] = (_x, z) => ({ x: lift.x, z: clampTo(z, z0, z1) });
    R.spots["tower"] = lift.supports.map((s) => ({ x: lift.x, z: s.z }));
    R.spots["station"] = lift.supports.filter((s) => s.kind !== "tower").map((s) => ({ x: lift.x, z: s.z }));
  }
  const br = a["bridge"] as { x0: number; x1: number; z: number; w: number } | undefined;
  // under the covered bridge's roof: half enclosed (open ends, the creek below)
  if (br) R.cover.push({ x0: br.x0, x1: br.x1, z0: br.z - br.w / 2, z1: br.z + br.w / 2, k: 0.45 });
  if (br) R.spots["bridge"] = [{ x: (br.x0 + br.x1) / 2, z: br.z }];
  const trees = arr<{ x: number; z: number }>(a["trees"]);
  // every 25th tree is enough to place "snow sliding off a branch" near the forest edge
  R.spots["trees"] = trees.filter((_, i) => i % 25 === 0).map((t) => ({ x: t.x, z: t.z }));
}

function gulchSpots(R: Runtime, w: Record<string, unknown>) {
  const blds = arr<AnyBld>(w["buildings"]);
  const props = arr<AnyProp>(w["props"]);
  const of = (t: string) => blds.filter((b) => b.t === t).map(frontOf);
  R.spots["saloon"] = of("saloon");
  R.spots["horses"] = [...of("stable"), ...props.filter((p) => p.k === "horse" || p.k === "hitch").map((p) => ({ x: p.x, z: p.z }))];
  R.spots["windmill"] = props.filter((p) => p.k === "windmill").map((p) => ({ x: p.x, z: p.z }));
  R.spots["sign"] = [
    ...props.filter((p) => p.k === "sign").map((p) => ({ x: p.x, z: p.z })),
    ...blds.filter((b) => (b as { sign?: number }).sign !== undefined && (b as { sign?: number }).sign! >= 0).map(frontOf),
  ];
  R.spots["church"] = of("church");
  const station = w["station"] as AmbSpot | undefined;
  if (station) R.spots["station"] = [station];
  // Dry Gulch runs its own visible train (western/Train.tsx): no ambient one on top
  if (w["portals"]) R.spots["ownTrain"] = [{ x: 0, z: 0 }];
}

function pierSpots(R: Runtime, w: Record<string, unknown>) {
  const b = w["beach"] as Record<string, unknown>;
  const seaX = Number(w["seaX"]);
  // the break line: the waves run up the wet sand ~40 m inland of the surf line
  const shore = Number.isFinite(seaX) ? seaX + 40 : -68;
  R.lines["shore"] = (x, z) => ({ x: Math.min(x, shore), z });
  const pts = (v: unknown) => (v && typeof v === "object" && "x" in (v as object) ? [v as AmbSpot] : []);
  const wheel = pts(b["wheel"]);
  R.spots["wheel"] = wheel;
  const coaster = b["coaster"] as { station?: Rect } | undefined;
  R.spots["carnival"] = [...wheel, ...pts(b["carousel"]), ...pts(b["drop"]), ...(coaster?.station ? [ctr(coaster.station)] : [])];
  if (b["skate"]) R.spots["skate"] = [ctr(b["skate"] as Rect)];
  const blds = arr<AnyBld>(b["buildings"]);
  R.spots["crowd"] = [...R.spots["carnival"], ...blds.filter((_, i) => i % 3 === 0).map(ctr)];
  // the pier deck: out over the water around the rides
  R.spots["pier"] = R.spots["carnival"];
  R.spots["shoreX"] = [{ x: shore, z: 0 }];
}

// ---------------------------------------------------------------------------------------
// shared layers

const always = () => 1;
const nightOnly = (e: Env) => (e.night ? 1 : 0);
const dayOnly = (e: Env) => (e.night ? 0 : 1);
const hz = (e: Env) => e.hazard;

/** gusty wind bed; `pitch` shifts the band */
function windBed(R: Runtime, name: string, gain: number, pitch: number, level: Layer["level"] = always) {
  bed(R, {
    name,
    src: "pink",
    filters: [{ type: "bandpass", f: 420 * pitch, q: 0.9 }, { type: "highpass", f: 90 }],
    gain,
    level,
    sweep: { spread: 0.5, every: [2.5, 7] },
    swell: [0.45, 1, 3, 9],
  });
}
/** the hazard storm: a roaring low band and a hissing high one */
function stormBeds(R: Runtime, name: string, gain: number, lowF: number, hiF: number) {
  bed(R, { name: name + " roar", src: "brown", filters: [{ type: "lowpass", f: lowF, q: 0.8 }], gain: gain * 1.4, level: hz, swell: [0.55, 1, 1.5, 4], sweep: { spread: 0.4, every: [1.5, 4] } });
  bed(R, { name: name + " hiss", src: "white", filters: [{ type: "bandpass", f: hiF, q: 0.7 }], gain: gain * 0.35, level: hz, swell: [0.4, 1, 1, 3.5], sweep: { spread: 0.45, every: [1, 3] } });
}
/** a field of crickets: two chirping voices that drift against each other */
function crickets(R: Runtime, name: string, gain: number, spot: string | undefined, ref: number, range: number, level: Layer["level"]) {
  const { ctx } = R;
  const c = chan(R);
  const L: Layer = { name, chan: c, gain, level, spot, ref, range, lastGain: 0, srcs: [] };
  for (const [f, pulse, gate] of [[4500, 29, 1.7], [4950, 33, 2.3]] as const) {
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const a = ctx.createGain();
    a.gain.value = 0.5;
    const b = ctx.createGain();
    b.gain.value = 0.5;
    const lfoA = ctx.createOscillator();
    lfoA.type = "square";
    lfoA.frequency.value = pulse;
    const dA = ctx.createGain();
    dA.gain.value = 0.5;
    const lfoB = ctx.createOscillator();
    lfoB.type = "square";
    lfoB.frequency.value = gate;
    const dB = ctx.createGain();
    dB.gain.value = 0.5;
    lfoA.connect(dA).connect(a.gain);
    lfoB.connect(dB).connect(b.gain);
    o.connect(a).connect(b).connect(c.input);
    o.start();
    lfoA.start();
    lfoB.start();
    L.srcs.push(o, lfoA, lfoB);
    R.persistent += 7;
  }
  R.layers.push(L);
}

/** murmuring crowd: two formant bands of pink noise that swell */
function crowdBed(R: Runtime, name: string, gain: number, spot: string, ref: number, range: number, level: Layer["level"]) {
  bed(R, { name, src: "pink", filters: [{ type: "bandpass", f: 520, q: 1.6 }, { type: "lowpass", f: 1800 }], gain, level, spot, ref, range, swell: [0.5, 1, 0.8, 2.5], sweep: { spread: 0.25, every: [0.4, 1.4] } });
}

// ---------------------------------------------------------------------------------------
// event sounds

function horn(R: Runtime, o: AudioNode, t: number) {
  const f = rnd(330, 470);
  const n = Math.random() < 0.35 ? 2 : 1;
  for (let k = 0; k < n; k++) {
    const at = t + k * rnd(0.3, 0.45);
    const d = rnd(0.2, 0.55);
    blip(R, o, at, { type: "square", f0: f, dur: d, gain: 0.05, attack: 0.02, cut: 1600 });
    blip(R, o, at, { type: "square", f0: f * 1.26, dur: d, gain: 0.04, attack: 0.02, cut: 1600 });
  }
  return 1.2;
}
function farSiren(R: Runtime, o: AudioNode, t: number) {
  // a slow wail rising and falling, very far away
  const dur = rnd(5, 8);
  const { ctx } = R;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.03, t + 1.2);
  g.gain.setValueAtTime(0.03, t + dur - 1.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1400;
  for (let k = 0; k < dur; k += 2.2) {
    osc.frequency.setValueAtTime(650, t + k);
    osc.frequency.linearRampToValueAtTime(1250, t + k + 1.1);
    osc.frequency.linearRampToValueAtTime(650, t + k + 2.2);
  }
  osc.connect(lp).connect(g).connect(o);
  osc.start(t);
  osc.stop(t + dur + 0.05);
  track(R, osc, 2);
  return dur;
}
function helicopter(R: Runtime, o: AudioNode, t: number) {
  // rotor chop: low noise gated at ~5 Hz, swelling in and out as it passes
  const dur = rnd(14, 20);
  const { ctx } = R;
  const s = ctx.createBufferSource();
  s.buffer = R.brown;
  s.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 380;
  const chop = ctx.createGain();
  chop.gain.value = 0.5;
  const lfo = ctx.createOscillator();
  lfo.type = "triangle";
  lfo.frequency.setValueAtTime(5.2, t);
  lfo.frequency.linearRampToValueAtTime(4.6, t + dur); // a hint of doppler
  const depth = ctx.createGain();
  depth.gain.value = 0.5;
  lfo.connect(depth).connect(chop.gain);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + dur * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(lp).connect(chop).connect(g).connect(o);
  // turbine whine
  const w = ctx.createOscillator();
  w.frequency.setValueAtTime(1900, t);
  w.frequency.linearRampToValueAtTime(1780, t + dur);
  const wg = ctx.createGain();
  wg.gain.value = 0.012;
  w.connect(wg).connect(g);
  s.start(t, Math.random() * 4);
  s.stop(t + dur);
  lfo.start(t);
  lfo.stop(t + dur);
  w.start(t);
  w.stop(t + dur);
  track(R, s, 4);
  track(R, lfo, 1);
  track(R, w, 1);
  return dur;
}
function waveCrash(R: Runtime, o: AudioNode, t: number, gain = 0.3) {
  // a breaker: builds, crashes, then the wash hisses back down the sand
  burst(R, o, t, { buf: "pink", type: "lowpass", f: 500, f1: 2400, q: 0.5, dur: 1.6, gain: gain * 0.6, attack: 1.1 });
  burst(R, o, t + 1.1, { buf: "white", type: "lowpass", f: 3500, f1: 600, q: 0.5, dur: rnd(2.5, 3.8), gain: gain * 0.5, attack: 0.15 });
  return 5;
}
function gull(R: Runtime, o: AudioNode, t: number) {
  const n = Math.floor(rnd(2, 5));
  let at = t;
  for (let k = 0; k < n; k++) {
    const f = rnd(1500, 2100);
    const long = k === 0 || Math.random() < 0.3;
    blip(R, o, at, { type: "sawtooth", f0: f, f1: f * (long ? 0.7 : 0.85), dur: long ? 0.45 : 0.16, gain: 0.03, attack: 0.03, vib: [rnd(30, 45), 0.03], cut: 3200, q: 3 });
    at += long ? rnd(0.5, 0.7) : rnd(0.18, 0.26);
  }
  return at - t;
}
function coyote(R: Runtime, o: AudioNode, t: number) {
  // a rising howl, then a few yips
  blip(R, o, t, { type: "triangle", f0: 480, f1: 820, dur: 1.1, gain: 0.05, attack: 0.3, vib: [6, 0.02], cut: 2400 });
  blip(R, o, t + 1.05, { type: "triangle", f0: 820, f1: 560, dur: 0.9, gain: 0.04, attack: 0.05, vib: [6, 0.02], cut: 2400 });
  let at = t + 2.2;
  for (let k = 0; k < Math.floor(rnd(2, 5)); k++) {
    blip(R, o, at, { type: "triangle", f0: rnd(900, 1200), f1: rnd(600, 800), dur: 0.14, gain: 0.03, cut: 2800 });
    at += rnd(0.18, 0.3);
  }
  return at - t;
}
function whinny(R: Runtime, o: AudioNode, t: number) {
  blip(R, o, t, { type: "sawtooth", f0: 1100, f1: 520, dur: 1.2, gain: 0.035, attack: 0.08, vib: [11, 0.06], cut: 2600, q: 4 });
  burst(R, o, t + 1.2, { buf: "pink", f: 700, q: 1.5, dur: 0.35, gain: 0.08, attack: 0.03 }); // snort
  return 1.8;
}
function hooves(R: Runtime, o: AudioNode, t: number) {
  const n = Math.floor(rnd(2, 5));
  for (let k = 0; k < n; k++) {
    const at = t + k * rnd(0.25, 0.5);
    blip(R, o, at, { type: "triangle", f0: rnd(160, 220), f1: 90, dur: 0.09, gain: 0.08 });
    burst(R, o, at, { f: 1200, q: 3, dur: 0.05, gain: 0.05 });
  }
  if (Math.random() < 0.5) burst(R, o, t + n * 0.4, { buf: "pink", f: 600, q: 1.2, dur: 0.4, gain: 0.07, attack: 0.05 }); // snort
  return n * 0.5 + 0.5;
}
function crackle(R: Runtime, o: AudioNode, t: number) {
  const n = Math.floor(rnd(4, 10));
  for (let k = 0; k < n; k++) burst(R, o, t + rnd(0, 1.5), { f: rnd(1800, 4500), q: 2, dur: rnd(0.01, 0.035), gain: rnd(0.04, 0.12) });
  burst(R, o, t, { buf: "brown", type: "lowpass", f: 300, dur: 1.6, gain: 0.05, attack: 0.4 }); // the fire's breath
  return 1.7;
}
function chime(R: Runtime, o: AudioNode, t: number) {
  // a few wind-chime tubes knocked by a breeze (pentatonic)
  const scale = [0, 2, 4, 7, 9, 12, 14];
  const n = Math.floor(rnd(2, 5));
  for (let k = 0; k < n; k++) bell(R, o, t + k * rnd(0.12, 0.4), 880 * Math.pow(2, scale[Math.floor(Math.random() * scale.length)]! / 12), 0.018, 2.4);
  return n * 0.4 + 2.4;
}
function bird(R: Runtime, o: AudioNode, t: number) {
  const n = Math.floor(rnd(3, 8));
  const f = rnd(2600, 4200);
  let at = t;
  for (let k = 0; k < n; k++) {
    const up = Math.random() < 0.5;
    blip(R, o, at, { f0: f * (up ? 0.8 : 1.15), f1: f * (up ? 1.2 : 0.75), dur: rnd(0.05, 0.12), gain: 0.025, attack: 0.01 });
    at += rnd(0.07, 0.16);
  }
  return at - t;
}
function bubbles(R: Runtime, o: AudioNode, t: number, low = false) {
  const n = Math.floor(rnd(3, 9));
  for (let k = 0; k < n; k++) {
    const f = low ? rnd(120, 300) : rnd(400, 1200);
    blip(R, o, t + rnd(0, 1.2), { f0: f, f1: f * rnd(1.6, 2.4), dur: rnd(0.04, 0.1), gain: low ? 0.07 : 0.03, attack: 0.005 });
  }
  return 1.4;
}
function iceCreak(R: Runtime, o: AudioNode, t: number) {
  // a deep groan through the sheet, sometimes a sharp crack after it
  blip(R, o, t, { type: "sawtooth", f0: rnd(55, 85), f1: rnd(40, 110), dur: rnd(0.8, 1.8), gain: 0.06, attack: 0.3, vib: [rnd(9, 16), 0.1], cut: 420, q: 5 });
  if (Math.random() < 0.4) burst(R, o, t + rnd(0.6, 1.2), { f: 2400, f1: 500, q: 1.2, dur: 0.12, gain: 0.1 });
  return 2;
}

// ---------------------------------------------------------------------------------------
// tunes

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** saloon honky-tonk: stride bass and chords, a wandering melody, two slightly detuned strings */
function honkyTonk(R: Runtime) {
  let step = 0;
  const prog = [48, 48, 53, 53, 48, 48, 55, 55]; // C C F F C C G G (bars)
  let mel = 72;
  return (o: AudioNode, at: number) => {
    const beat = 60 / 138 / 2; // eighths at 138 bpm
    const bar = Math.floor(step / 8) % prog.length;
    const i = step % 8;
    const root = prog[bar]!;
    const key = (f: number, g: number, d: number) => {
      blip(R, o, at, { type: "triangle", f0: f, dur: d, gain: g, cut: 3200 });
      blip(R, o, at, { type: "triangle", f0: f * 1.008, dur: d, gain: g * 0.7, cut: 3200 }); // the honk
    };
    if (i === 0 || i === 4) key(midi(root - 12 + (i === 4 ? 7 : 0)), 0.05, 0.4);
    if (i === 2 || i === 6) [0, 4, 7].forEach((iv) => key(midi(root + iv), 0.025, 0.25));
    // melody: a pentatonic random walk, mostly on the beats, swung
    if (i % 2 === 0 || Math.random() < 0.3) {
      const scale = [0, 2, 4, 7, 9];
      mel += [-2, -1, 0, 1, 2][Math.floor(Math.random() * 5)]!;
      mel = Math.max(67, Math.min(86, mel));
      const deg = scale[((mel % 12) + 12) % 5] ?? 0;
      const n = Math.floor(mel / 12) * 12 + deg;
      if (Math.random() < 0.85) key(midi(n), 0.035, 0.22);
    }
    step++;
    return i % 2 === 0 ? beat * 1.2 : beat * 0.8; // swing
  };
}

/** carnival calliope: a 3/4 oom-pah-pah with a bright wobbly organ tune */
function calliope(R: Runtime) {
  let step = 0;
  const prog = [60, 60, 67, 67, 65, 65, 67, 60];
  const tune = [76, 79, 84, 79, 77, 76, 74, 72, 74, 76, 79, 76, 74, 72, 71, 72];
  return (o: AudioNode, at: number) => {
    const beat = 60 / 150;
    const bar = Math.floor(step / 3) % prog.length;
    const i = step % 3;
    const root = prog[bar]!;
    // accompaniment: one plain reed each; only the tune gets the wobble and the octave pipe
    const reed = (f: number, g: number, d: number) => blip(R, o, at, { type: "square", f0: f, dur: d, gain: g, attack: 0.02, cut: 2600 });
    if (i === 0) reed(midi(root - 12), 0.03, 0.35);
    else [4, 7].forEach((iv) => reed(midi(root + iv), 0.014, 0.2));
    const f = midi(tune[step % tune.length]!);
    blip(R, o, at, { type: "square", f0: f, dur: beat * 0.9, gain: 0.02, attack: 0.02, vib: [6.5, 0.006], cut: 2600 });
    blip(R, o, at, { type: "triangle", f0: f * 2, dur: beat * 0.9, gain: 0.01, attack: 0.02 });
    step++;
    return beat;
  };
}

// ---------------------------------------------------------------------------------------
// the soundscapes

const PROFILES: Record<string, (R: Runtime) => void> = {
  // Vice Heights: a city that never sleeps, a beach at its feet
  vice(R) {
    // distant city hum and traffic wash: always there, stronger near the roads
    bed(R, { name: "city hum", src: "brown", filters: [{ type: "lowpass", f: 160, q: 0.7 }], gain: 0.18, level: (e) => (e.night ? 0.8 : 1) * (0.45 + 0.55 * e.power), swell: [0.7, 1, 4, 10] });
    bed(R, { name: "traffic wash", src: "pink", filters: [{ type: "bandpass", f: 650, q: 0.6 }, { type: "lowpass", f: 2200 }], gain: 0.09, spot: "road", ref: 14, range: 400, level: (e) => (e.night ? 0.7 : 1), sweep: { spread: 0.35, every: [2, 6] }, swell: [0.55, 1, 2, 6] });
    // floor so a far-off wash stays even where the road falloff runs out
    bed(R, { name: "far traffic", src: "pink", filters: [{ type: "bandpass", f: 420, q: 0.5 }], gain: 0.035, level: always, swell: [0.6, 1, 3, 8] });
    // wind between towers: more of it the higher you climb
    windBed(R, "tower wind", 0.09, 1.3, (e) => 0.3 + clamp01(e.y / 50) * 0.9);
    crowdBed(R, "street crowd", 0.1, "street", 10, 70, (e) => (e.night ? 0.6 : 1) * (1 - e.hazard * 0.5) * (1 - e.rain * 0.6));
    bed(R, { name: "neon buzz", src: { osc: "sawtooth", f: [120, 240.6] }, filters: [{ type: "bandpass", f: 1900, q: 1.8 }], gain: 0.05, spot: "sign", ref: 4, range: 20, level: (e) => (e.night ? 1 : 0.5) * e.power });
    bed(R, { name: "ocean", src: "brown", filters: [{ type: "lowpass", f: 650, q: 0.5 }], gain: 0.3, spot: "water", ref: 18, range: 260, level: always, swell: [0.35, 1, 3, 7] });
    bed(R, { name: "ocean hiss", src: "white", filters: [{ type: "bandpass", f: 2400, q: 0.5 }], gain: 0.035, spot: "water", ref: 10, range: 120, level: always, swell: [0.2, 1, 3, 7] });
    crickets(R, "park crickets", 0.016, "park", 25, 110, (e) => nightOnly(e) * (1 - e.rain));
    ev(R, "wave", [4, 9], "water", always, (o, t) => waveCrash(R, o, t, 0.28), 140);
    ev(R, "horn", [5, 16], "road", (e) => (e.night ? 0.6 : 1), (o, t) => horn(R, o, t), 160);
    ev(R, "far siren", [30, 75], "far", always, (o, t) => farSiren(R, o, t));
    ev(R, "helicopter", [70, 150], "overhead", always, (o, t) => helicopter(R, o, t));
    ev(R, "neon flicker", [3, 9], "sign", (e) => nightOnly(e) * e.power, (o, t) => {
      for (let k = 0; k < Math.floor(rnd(2, 6)); k++) burst(R, o, t + k * rnd(0.03, 0.09), { f: 3200, q: 3, dur: 0.02, gain: 0.08 });
      return 0.6;
    }, 14);
    ev(R, "gull", [18, 40], "water", dayOnly, (o, t) => gull(R, o, t), 120);
    rainLayers(R);
    blackoutLayers(R);
    // OIL SLICK boss round: the city goes on edge, more sirens
    ev(R, "hazard siren", [8, 16], "far", hz, (o, t) => farSiren(R, o, t));
  },

  // Dry Gulch: a boomtown in the desert wind
  gulch(R) {
    windBed(R, "desert wind", 0.28, 1, (e) => 1 - e.hazard * 0.4);
    bed(R, { name: "wind whistle", src: "white", filters: [{ type: "bandpass", f: 1700, q: 9 }], gain: 0.02, level: always, sweep: { spread: 0.3, every: [2, 6] }, swell: [0, 1, 2, 7] });
    crickets(R, "desert crickets", 0.008, undefined, 1, 1, nightOnly);
    tuneLayer(R, "saloon piano", "saloon", 1.6, 5, 70, (e) => 1 - e.hazard * 0.6, honkyTonk(R));
    crowdBed(R, "saloon chatter", 0.14, "saloon", 5, 45, (e) => 1 - e.hazard * 0.6);
    ev(R, "saloon laugh", [4, 11], "saloon", always, (o, t) => {
      for (let k = 0; k < Math.floor(rnd(3, 6)); k++) burst(R, o, t + k * 0.13, { buf: "pink", f: rnd(600, 900), q: 4, dur: 0.1, gain: 0.07, attack: 0.02 });
      if (Math.random() < 0.5) bell(R, o, t + rnd(0.5, 1.5), rnd(2400, 3200), 0.015, 0.5); // glasses
      return 1.5;
    }, 40);
    ev(R, "sign creak", [3, 9], "sign", (e) => 0.5 + e.hazard * 0.5, (o, t) => {
      creak(R, o, t, rnd(90, 150), rnd(0.4, 0.9), 0.04);
      if (Math.random() < 0.6) creak(R, o, t + rnd(0.9, 1.4), rnd(80, 130), rnd(0.4, 0.8), 0.03);
      return 2.3;
    }, 28);
    ev(R, "windmill", [3.5, 5.5], "windmill", always, (o, t) => {
      creak(R, o, t, rnd(60, 80), 1.1, 0.05);
      blip(R, o, t + 1, { type: "triangle", f0: 310, f1: 290, dur: 0.12, gain: 0.03, cut: 1500 }); // the pump rod knock
      return 1.4;
    }, 55);
    ev(R, "hooves", [4, 10], "horses", always, (o, t) => hooves(R, o, t), 40);
    ev(R, "whinny", [18, 40], "horses", always, (o, t) => whinny(R, o, t), 55);
    ev(R, "coyote", [35, 80], "far", nightOnly, (o, t) => coyote(R, o, t));
    ev(R, "hawk", [40, 90], "far", dayOnly, (o, t) => {
      blip(R, o, t, { type: "sawtooth", f0: 2600, f1: 1500, dur: 1.4, gain: 0.02, attack: 0.1, vib: [22, 0.04], cut: 3600, q: 2 });
      return 1.6;
    });
    ev(R, "distant train", [100, 200], "far", (e) => (R.spots["ownTrain"] ? 0 : 1 - e.hazard), (o, t) => farTrain(R, o, t));
    // DUST STORM
    stormBeds(R, "dust storm", 0.3, 260, 2600);
  },

  // Pacific Pier: surf, gulls, the boardwalk and the rides
  pier(R) {
    bed(R, { name: "surf", src: "brown", filters: [{ type: "lowpass", f: 800, q: 0.5 }], gain: 0.26, spot: "shore", ref: 25, range: 450, level: always, swell: [0.35, 1, 2.5, 6] });
    bed(R, { name: "surf hiss", src: "white", filters: [{ type: "bandpass", f: 2600, q: 0.5 }], gain: 0.05, spot: "shore", ref: 15, range: 180, level: always, swell: [0.15, 1, 2.5, 6] });
    windBed(R, "sea breeze", 0.08, 0.9, (e) => 0.6 + e.hazard * 0.4);
    crowdBed(R, "boardwalk crowd", 0.1, "crowd", 12, 110, (e) => (e.night ? 0.7 : 1) * (1 - e.hazard * 0.4));
    tuneLayer(R, "carnival organ", "carnival", 0.9, 10, 130, (e) => 1 - e.hazard * 0.5, calliope(R));
    bed(R, { name: "wheel motor", src: { osc: "sawtooth", f: [48, 96.5] }, filters: [{ type: "lowpass", f: 260, q: 1.5 }], gain: 0.06, spot: "wheel", ref: 6, range: 45, level: always });
    ev(R, "breaker", [3.5, 8], "shore", always, (o, t) => waveCrash(R, o, t, 0.3), 160);
    ev(R, "gulls", [7, 20], "far", (e) => (e.night ? 0.1 : 1), (o, t) => gull(R, o, t));
    ev(R, "gull near", [15, 35], "shore", (e) => (e.night ? 0 : 0.8), (o, t) => gull(R, o, t), 90);
    ev(R, "pier boards", [2.5, 7], "pier", always, (o, t) => {
      creak(R, o, t, rnd(110, 180), rnd(0.25, 0.6), 0.035);
      return 0.8;
    }, 35);
    ev(R, "wheel clank", [4, 9], "wheel", always, (o, t) => {
      blip(R, o, t, { type: "square", f0: rnd(180, 240), f1: 120, dur: 0.12, gain: 0.05, cut: 1800 });
      bell(R, o, t, rnd(900, 1300), 0.01, 0.4);
      return 0.6;
    }, 45);
    ev(R, "skateboard", [3, 8], "skate", (e) => (e.night ? 0.4 : 1), (o, t) => {
      const roll = rnd(1.2, 3);
      burst(R, o, t, { buf: "brown", type: "lowpass", f: 380, dur: roll, gain: 0.18, attack: 0.2 });
      burst(R, o, t + roll * 0.7, { f: 1500, q: 2, dur: 0.05, gain: 0.25 }); // pop
      burst(R, o, t + roll * 0.7 + rnd(0.35, 0.6), { f: 900, q: 1.5, dur: 0.08, gain: 0.3 }); // land clack
      return roll + 1;
    }, 55);
    ev(R, "ride screams", [12, 30], "carnival", always, (o, t) => {
      for (let k = 0; k < 3; k++) blip(R, o, t + k * 0.15, { type: "sawtooth", f0: rnd(900, 1300), f1: rnd(700, 1000), dur: 0.9, gain: 0.012, attack: 0.1, vib: [7, 0.02], cut: 2600 });
      return 1.5;
    }, 110);
    // MARINE LAYER: fog rolls in, the foghorn sounds
    ev(R, "foghorn", [16, 30], "far", hz, (o, t) => {
      blip(R, o, t, { type: "sawtooth", f0: 98, dur: 2.6, gain: 0.12, attack: 0.4, cut: 380 });
      blip(R, o, t, { type: "sawtooth", f0: 131, dur: 2.6, gain: 0.08, attack: 0.4, cut: 380 });
      return 3;
    });
  },

  // Whiteout Pass: hushed snow, the chairlift, the village
  alpine(R) {
    windBed(R, "mountain wind", 0.24, 0.8, (e) => 1 - e.hazard * 0.5);
    bed(R, { name: "cable hum", src: { osc: "sawtooth", f: [55, 110.4, 165.2] }, filters: [{ type: "lowpass", f: 320, q: 1.2 }], gain: 0.05, spot: "cable", ref: 6, range: 60, level: always, swell: [0.7, 1, 2, 5] });
    bed(R, { name: "bullwheel", src: "brown", filters: [{ type: "bandpass", f: 140, q: 2 }], gain: 0.18, spot: "station", ref: 8, range: 55, level: always });
    // fireplaces: muffled through chalet walls
    bed(R, { name: "fireplace", src: "brown", filters: [{ type: "lowpass", f: 420 }], gain: 0.08, spot: "fire", ref: 4, range: 22, level: (e) => (e.night ? 1 : 0.7) });
    ev(R, "fire crackle", [0.8, 2.5], "fire", always, (o, t) => crackle(R, o, t), 20);
    ev(R, "chair clank", [3, 7], "tower", always, (o, t) => {
      blip(R, o, t, { type: "square", f0: rnd(150, 200), f1: 90, dur: 0.1, gain: 0.07, cut: 1400 });
      blip(R, o, t + 0.16, { type: "square", f0: rnd(150, 200), f1: 90, dur: 0.1, gain: 0.05, cut: 1400 });
      bell(R, o, t, rnd(700, 950), 0.012, 0.5);
      return 0.8;
    }, 70);
    ev(R, "church bells", [60, 130], "church", always, (o, t) => {
      const n = Math.floor(rnd(3, 7));
      for (let k = 0; k < n; k++) bell(R, o, t + k * 1.6, k % 2 ? 294 : 330, 0.06, 4);
      return n * 1.6 + 4;
    }, 600);
    ev(R, "snow slide", [8, 20], "trees", (e) => 1 - e.hazard, (o, t) => {
      burst(R, o, t, { buf: "pink", type: "lowpass", f: 900, f1: 300, dur: rnd(0.4, 0.9), gain: 0.18, attack: 0.05 });
      return 1;
    }, 50);
    ev(R, "raven", [30, 70], "far", (e) => (e.night ? 0 : 1 - e.hazard), (o, t) => {
      for (let k = 0; k < Math.floor(rnd(2, 4)); k++) blip(R, o, t + k * 0.5, { type: "sawtooth", f0: rnd(420, 520), f1: 360, dur: 0.28, gain: 0.02, attack: 0.02, vib: [40, 0.05], cut: 1600, q: 3 });
      return 2;
    });
    // BLIZZARD roar (the alpine weather code adds its own howl and muffling on top)
    stormBeds(R, "blizzard", 0.26, 200, 1800);
  },

  // ---- the small arenas: one light bed each, a few details ----
  dunes(R) {
    windBed(R, "desert wind", 0.4, 1);
    ev(R, "sand hiss", [5, 12], "near", always, (o, t) => {
      burst(R, o, t, { f: 5000, q: 0.8, dur: rnd(1, 2.5), gain: 0.05, attack: 0.5 });
      return 2.5;
    });
    stormBeds(R, "sand", 0.18, 240, 3200);
  },
  canyon(R) {
    windBed(R, "canyon wind", 0.38, 0.8);
    bed(R, { name: "canyon whistle", src: "white", filters: [{ type: "bandpass", f: 1100, q: 12 }], gain: 0.02, level: always, sweep: { spread: 0.25, every: [3, 8] }, swell: [0, 1, 3, 8] });
    ev(R, "hawk", [25, 60], "far", always, (o, t) => {
      blip(R, o, t, { type: "sawtooth", f0: 2600, f1: 1500, dur: 1.4, gain: 0.02, attack: 0.1, vib: [22, 0.04], cut: 3600, q: 2 });
      return 1.6;
    });
    stormBeds(R, "gale", 0.2, 260, 2200);
  },
  ice(R) {
    windBed(R, "cold wind", 0.33, 1.8);
    ev(R, "ice creak", [5, 13], "far", always, (o, t) => iceCreak(R, o, t));
    ev(R, "tinkle", [6, 15], "near", always, (o, t) => {
      for (let k = 0; k < Math.floor(rnd(2, 5)); k++) bell(R, o, t + rnd(0, 0.6), rnd(3000, 5200), 0.006, 0.4);
      return 1;
    });
    stormBeds(R, "ice storm", 0.16, 300, 3800);
  },
  forest(R) {
    bed(R, { name: "leaves", src: "white", filters: [{ type: "highpass", f: 1800 }, { type: "lowpass", f: 7000 }], gain: 0.05, level: always, swell: [0.3, 1, 2, 6] });
    windBed(R, "forest wind", 0.15, 0.7);
    crickets(R, "crickets", 0.012, undefined, 1, 1, nightOnly);
    ev(R, "birds", [3, 9], "far", (e) => (e.night ? 0.1 : 1), (o, t) => bird(R, o, t));
    ev(R, "owl", [20, 45], "far", nightOnly, (o, t) => {
      blip(R, o, t, { f0: 420, f1: 380, dur: 0.35, gain: 0.05, attack: 0.05 });
      blip(R, o, t + 0.55, { f0: 400, f1: 360, dur: 0.6, gain: 0.05, attack: 0.08, vib: [5, 0.01] });
      return 1.3;
    });
    ev(R, "woodpecker", [30, 70], "far", dayOnly, (o, t) => {
      for (let k = 0; k < 12; k++) burst(R, o, t + k * 0.06, { f: 1400, q: 5, dur: 0.03, gain: 0.08 });
      return 1;
    });
  },
  lava(R) {
    bed(R, { name: "magma rumble", src: "brown", filters: [{ type: "lowpass", f: 95, q: 1.2 }], gain: 0.2, level: always, swell: [0.5, 1, 1.5, 5] });
    bed(R, { name: "vent hiss", src: "white", filters: [{ type: "highpass", f: 3000 }], gain: 0.012, level: always, swell: [0.2, 1, 1, 4] });
    ev(R, "lava bubble", [1.5, 5], "far", always, (o, t) => bubbles(R, o, t, true));
    ev(R, "rock crack", [8, 20], "far", always, (o, t) => {
      burst(R, o, t, { buf: "brown", type: "lowpass", f: 600, f1: 120, dur: 1.2, gain: 0.25 });
      return 1.3;
    });
    stormBeds(R, "ash", 0.16, 150, 2400);
  },
  blossom(R) {
    windBed(R, "breeze", 0.26, 1.1);
    bed(R, { name: "leaves", src: "white", filters: [{ type: "highpass", f: 2500 }, { type: "lowpass", f: 6000 }], gain: 0.03, level: always, swell: [0.2, 1, 2, 6] });
    ev(R, "wind chime", [6, 16], "far", always, (o, t) => chime(R, o, t));
    ev(R, "bird", [8, 20], "far", dayOnly, (o, t) => bird(R, o, t));
    crickets(R, "crickets", 0.008, undefined, 1, 1, nightOnly);
    stormBeds(R, "petal cyclone", 0.14, 320, 2800);
  },
  abyss(R) {
    bed(R, { name: "deep drone", src: "brown", filters: [{ type: "lowpass", f: 200, q: 0.8 }], gain: 0.17, level: always, swell: [0.6, 1, 4, 10] });
    bed(R, { name: "pressure tone", src: { osc: "sine", f: [55, 55.7] }, filters: [{ type: "lowpass", f: 200 }], gain: 0.05, level: always, swell: [0.4, 1, 5, 12] });
    ev(R, "bubbles", [3, 8], "far", always, (o, t) => bubbles(R, o, t));
    ev(R, "whale", [35, 80], "far", always, (o, t) => {
      blip(R, o, t, { type: "triangle", f0: 180, f1: 320, dur: 2.5, gain: 0.03, attack: 0.8, vib: [3, 0.03], cut: 800 });
      blip(R, o, t + 2.4, { type: "triangle", f0: 320, f1: 140, dur: 2, gain: 0.025, attack: 0.2, vib: [3, 0.03], cut: 800 });
      return 4.6;
    });
    ev(R, "sonar", [20, 45], "far", always, (o, t) => {
      bell(R, o, t, 1480, 0.012, 2.5);
      return 2.5;
    });
  },
  cyber(R) {
    bed(R, { name: "grid hum", src: { osc: "sawtooth", f: [50, 100.3] }, filters: [{ type: "lowpass", f: 280, q: 1 }], gain: 0.06, level: always, swell: [0.7, 1, 3, 8] });
    bed(R, { name: "server whine", src: { osc: "sine", f: [7900, 8030] }, filters: [{ type: "highpass", f: 4000 }], gain: 0.0035, level: always, swell: [0.3, 1, 2, 6] });
    bed(R, { name: "fans", src: "pink", filters: [{ type: "bandpass", f: 900, q: 0.6 }], gain: 0.07, level: always });
    ev(R, "data chirp", [2, 6], "far", always, (o, t) => {
      for (let k = 0; k < Math.floor(rnd(3, 8)); k++) blip(R, o, t + k * 0.06, { type: "square", f0: rnd(900, 3200), dur: 0.035, gain: 0.012, cut: 5000 });
      return 0.6;
    });
    ev(R, "arc", [10, 25], "far", always, (o, t) => {
      for (let k = 0; k < 6; k++) burst(R, o, t + rnd(0, 0.35), { f: rnd(2000, 6000), q: 3, dur: 0.02, gain: 0.08 });
      return 0.5;
    });
    stormBeds(R, "emp", 0.12, 180, 4200);
  },
  toxic(R) {
    bed(R, { name: "sludge drone", src: "brown", filters: [{ type: "lowpass", f: 140 }], gain: 0.15, level: always, swell: [0.6, 1, 2, 6] });
    bed(R, { name: "fizz", src: "white", filters: [{ type: "bandpass", f: 6000, q: 0.8 }], gain: 0.008, level: always, swell: [0.2, 1, 1, 3] });
    ev(R, "bubbling", [1.2, 4], "far", always, (o, t) => bubbles(R, o, t, true));
    ev(R, "drip", [2.5, 7], "near", always, (o, t) => {
      blip(R, o, t, { f0: rnd(900, 1400), f1: rnd(1800, 2600), dur: 0.08, gain: 0.03 });
      return 0.3;
    });
    stormBeds(R, "bog", 0.12, 160, 1600);
  },
};

/**
 * Vice Heights rain, driven by setAmbienceRain (cityWeather's rainIntensity()). Its own layers:
 * the boss-round hazard is separate.
 */
function rainLayers(R: Runtime) {
  const rain = (e: Env) => e.rain;
  const heavy = (e: Env) => clamp01((e.rain - 0.25) / 0.75);
  // broadband hiss and the body of the downpour
  bed(R, { name: "rain hiss", src: "white", filters: [{ type: "highpass", f: 1300 }, { type: "lowpass", f: 9000 }], gain: 0.11, level: (e) => Math.pow(e.rain, 0.8), swell: [0.75, 1, 1, 4] });
  bed(R, { name: "rain body", src: "pink", filters: [{ type: "bandpass", f: 750, q: 0.5 }], gain: 0.14, level: rain, swell: [0.7, 1, 2, 6] });
  // heavier individual drops on the pavement and cars
  bed(R, { name: "heavy drops", src: "drops", filters: [{ type: "bandpass", f: 2600, q: 0.7 }], gain: 0.45, level: heavy });
  // drumming on awnings and canopies, and gutters trickling, near the buildings
  bed(R, { name: "awning drum", src: "patter", filters: [{ type: "bandpass", f: 520, q: 2.2 }, { type: "lowpass", f: 1600 }], gain: 0.9, spot: "awning", ref: 4, range: 26, level: rain });
  bed(R, { name: "gutter trickle", src: "white", filters: [{ type: "bandpass", f: 1500, q: 5 }], gain: 0.045, spot: "awning", ref: 3, range: 15, level: rain, sweep: { spread: 0.35, every: [0.2, 0.7] }, swell: [0.4, 1, 0.3, 1.2] });
  // tyres hissing through the wet, following the loudest nearby car and its speed
  bed(R, { name: "tyre hiss", src: "white", filters: [{ type: "bandpass", f: 3200, q: 0.6 }, { type: "highpass", f: 1200 }], gain: 0.22, spot: "tyre", ref: 6, range: 60, level: (e) => e.rain * clamp01(scene.tyre.speed / 12) });
  ev(R, "gutter gurgle", [1.5, 4], "awning", (e) => (e.rain > 0.3 ? 1 : 0), (o, t) => bubbles(R, o, t), 14);
  // thunder in heavy rain: a crack (sometimes), then a long rolling rumble
  ev(R, "thunder", [18, 50], "far", (e) => clamp01((e.rain - 0.65) * 3), (o, t) => {
    const near = Math.random() < 0.3;
    if (near) burst(R, o, t, { buf: "white", type: "lowpass", f: 5000, f1: 700, dur: 0.5, gain: 0.35, attack: 0.005 });
    const dur = rnd(4, 8);
    burst(R, o, t + (near ? 0.15 : rnd(0.2, 1)), { buf: "brown", type: "lowpass", f: 320, f1: 90, dur, gain: 0.5, attack: rnd(0.2, 0.8) });
    for (let k = 0; k < Math.floor(rnd(2, 5)); k++) burst(R, o, t + rnd(0.5, dur * 0.7), { buf: "brown", type: "lowpass", f: 220, dur: rnd(0.8, 1.8), gain: 0.35, attack: 0.15 });
    return dur + 1.5;
  });
}

/** car alarm patterns: a whooping sweep, a two-tone beeper, or a fast warble */
function carAlarm(R: Runtime, o: AudioNode, t: number) {
  const kind = Math.floor(Math.random() * 3);
  const dur = rnd(4, 8);
  if (kind === 0) {
    for (let k = 0; k < dur; k += 0.55) blip(R, o, t + k, { type: "sawtooth", f0: 700, f1: 1500, dur: 0.5, gain: 0.03, attack: 0.02, cut: 2600 });
  } else if (kind === 1) {
    for (let k = 0; k < dur; k += 0.6) blip(R, o, t + k, { type: "square", f0: k % 1.2 < 0.6 ? 1050 : 820, dur: 0.28, gain: 0.025, attack: 0.01, cut: 2400 });
  } else {
    for (let k = 0; k < dur; k += 0.14) blip(R, o, t + k, { type: "square", f0: (k / 0.14) % 2 < 1 ? 1400 : 1100, dur: 0.12, gain: 0.02, attack: 0.005, cut: 2800 });
  }
  return dur;
}

/** Vice Heights blackout: an alarmed murmur rolling across the dark city, car alarms, dogs. */
function blackoutLayers(R: Runtime) {
  const bo = (e: Env) => e.blackout;
  bed(R, { name: "alarmed crowd", src: "pink", filters: [{ type: "bandpass", f: 900, q: 1.3 }, { type: "lowpass", f: 2200 }], gain: 0.13, level: bo, sweep: { spread: 0.45, every: [0.25, 0.9] }, swell: [0.3, 1, 0.5, 1.8] });
  ev(R, "car alarm", [3, 8], "road", bo, (o, t) => carAlarm(R, o, t), 220);
  ev(R, "far car alarm", [5, 12], "far", bo, (o, t) => carAlarm(R, o, t));
  ev(R, "shout", [4, 10], "far", bo, (o, t) => {
    for (let k = 0; k < Math.floor(rnd(1, 3)); k++) blip(R, o, t + k * rnd(0.3, 0.6), { type: "sawtooth", f0: rnd(260, 420), f1: rnd(200, 300), dur: rnd(0.3, 0.6), gain: 0.02, attack: 0.04, vib: [6, 0.03], cut: 1600, q: 2 });
    return 1.5;
  });
  ev(R, "dog", [6, 15], "far", bo, (o, t) => {
    for (let k = 0; k < Math.floor(rnd(2, 5)); k++) {
      burst(R, o, t + k * rnd(0.3, 0.5), { buf: "pink", f: 700, q: 2, dur: 0.12, gain: 0.12, attack: 0.01 });
      blip(R, o, t + k * rnd(0.3, 0.5), { type: "sawtooth", f0: 480, f1: 300, dur: 0.12, gain: 0.02, cut: 1400 });
    }
    return 2;
  });
}

/**
 * A distant freight passing somewhere off in the desert: a rumble and a steam whistle. For map
 * code that wants one on cue (Dry Gulch runs its own visible train, so the ambience skips it).
 */
export function playFarTrain(pan = rnd(-0.8, 0.8)) {
  if (!rt) return;
  const P = place(rt, 0.6, pan, 1800);
  P.done(farTrain(rt, P.out, rt.ctx.currentTime + 0.03));
}

function farTrain(run: Runtime, out: AudioNode, at: number) {
  burst(run, out, at, { buf: "brown", type: "lowpass", f: 140, dur: 18, gain: 0.35, attack: 7 });
  const wt = at + rnd(5, 9);
  for (const f of [440, 554.4, 659.3]) {
    blip(run, out, wt, { type: "sawtooth", f0: f * 0.95, f1: f, dur: 1.6, gain: 0.012, attack: 0.1, cut: 1800 });
    blip(run, out, wt + 2.1, { type: "sawtooth", f0: f * 0.95, f1: f, dur: 0.5, gain: 0.012, attack: 0.05, cut: 1800 });
  }
  return 19;
}
