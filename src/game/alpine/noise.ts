// Deterministic value noise for the alpine terrain (pure maths, shared by the layout, the
// terrain mesh and the backdrop so every co-op client builds identical mountains).

export function hash2(ix: number, iz: number, s: number) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function vnoise(x: number, z: number, s: number) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, s);
  const b = hash2(ix + 1, iz, s);
  const c = hash2(ix, iz + 1, s);
  const d = hash2(ix + 1, iz + 1, s);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** fractal value noise in 0..1 */
export function fbm(x: number, z: number, oct: number, s: number) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x * f, z * f, s + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** ridged multifractal in 0..1: sharp crests, the look of jagged alpine ridgelines */
export function ridged(x: number, z: number, oct: number, s: number) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  let w = 1;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(vnoise(x * f, z * f, s + i * 31) * 2 - 1);
    n *= n;
    n *= w;
    w = Math.min(1, Math.max(0, n * 1.7));
    sum += n * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return sum / norm;
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------
// The natural landform, defined everywhere (the play area, the near ring and the far
// mountains all sample this). The valley runs east-west with its floor near z = 40; the
// ski slope climbs to the north, a forested hill to the south, and the jagged range and
// the hero peak rise far beyond.

const VALLEY_Z = 40;
/** the hero peak (a Matterhorn-like pyramid) far to the north-north-west */
export const PEAK = { x: -1000, z: -5600, h: 2700, r: 2300 };
const VIEW = { x: 0, z: 30 };

export function valleyCentre(x: number) {
  return VALLEY_Z + 160 * smooth(600, 3800, Math.abs(x)) * Math.sin(x / 1500);
}

/** 0..1 inside the side valley that frames the hero peak from the village */
function sideValley(x: number, z: number) {
  const dx = PEAK.x - VIEW.x;
  const dz = PEAK.z - VIEW.z;
  const l2 = dx * dx + dz * dz;
  const t = ((x - VIEW.x) * dx + (z - VIEW.z) * dz) / l2;
  if (t < 0 || t > 1) return 0;
  const px = VIEW.x + dx * t - x;
  const pz = VIEW.z + dz * t - z;
  const w = 260 + 900 * t;
  return (
    Math.exp(-(px * px + pz * pz) / (w * w)) * smooth(0.02, 0.12, t) * (1 - smooth(0.82, 0.97, t))
  );
}

function heroPeak(x: number, z: number) {
  const dx = x - PEAK.x;
  const dz = z - PEAK.z;
  const c = Math.cos(0.55);
  const s = Math.sin(0.55);
  const rx = dx * c - dz * s;
  const rz = dx * s + dz * c;
  const sq = Math.max(Math.abs(rx), Math.abs(rz));
  // a four-faced pyramid with sharp arêtes, its summit hooked slightly towards the valley
  const d = sq * 0.72 + Math.hypot(rx, rz) * 0.28;
  if (d > PEAK.r) return 0;
  const t = 1 - d / PEAK.r;
  const face = Math.pow(t, 1.35);
  const needle = Math.pow(Math.max(0, t - 0.72) / 0.28, 2) * 0.12;
  return PEAK.h * (face + needle) * (0.94 + 0.12 * ridged(x / 300, z / 300, 3, 91));
}

export function naturalHeight(x: number, z: number) {
  const zc = valleyCentre(x);
  const north = Math.max(0, zc - 90 - z);
  const south = Math.max(0, z - zc - 80);
  const side = north > 300 ? sideValley(x, z) : 0;
  let h =
    north < 350
      ? 0.36 * north + 0.0006 * north * north
      : 199 + 820 * (1 - Math.exp(-(north - 350) / 1400)) * (1 - 0.8 * side);
  h +=
    south < 280
      ? 0.12 * south + 0.0004 * south * south
      : 65 + 700 * (1 - Math.exp(-(south - 280) / 2000));
  // the valley floor climbs gently up-valley (west) and falls away down-valley (east)
  h += 0.035 * Math.max(0, -x - 420) - 0.012 * Math.max(0, x - 420);
  // ridges and gullies on the slopes
  const slopeK = smooth(0, 70, north) + 0.8 * smooth(0, 60, south);
  h += (fbm(x / 150, z / 150, 4, 11) - 0.5) * 26 * slopeK;
  // soft undulation (snowdrifts, meadows) everywhere
  h += (fbm(x / 60, z / 60, 3, 7) - 0.5) * 2.2;
  // the range beyond
  const far = smooth(420, 2600, north) + 0.75 * smooth(380, 2600, south);
  if (far > 0) {
    // big ridgelines, then sharper secondary aretes and couloirs riding on their flanks
    const r1 = ridged(x / 1100, z / 1100, 5, 3);
    const r2 = ridged(x / 360, z / 360, 4, 21);
    h += (r1 * 1150 + r2 * 360 * smooth(0.25, 0.65, r1)) * far * (1 - 0.85 * side);
  }
  if (Math.abs(x - PEAK.x) < PEAK.r * 1.5 && Math.abs(z - PEAK.z) < PEAK.r * 1.5)
    h += heroPeak(x, z);
  return h;
}
