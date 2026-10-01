// Generated skies: the city's night and sunset, and a sunset for each small arena map.
// Each sky is painted per pixel into an equirectangular image (three.js convention:
// u = atan2(z, x), v = elevation). The background gets a display-ready sRGB canvas, and the
// sunset's reflection env map gets an HDR float copy, so sun-facing glass and the sea
// catch a properly hot sun instead of a clipped white blob.
import * as THREE from "three";
import type { TimeOfDay } from "./lighting";
import { drain, runSliced } from "./slice";

type RGB = [number, number, number];

/** direction toward the sun (sunset) or the moon (night) over the city */
export const SUN_DIR: Record<TimeOfDay, [number, number, number]> = {
  night: [-0.5, 0.62, -0.6],
  sunset: dirFrom(3, 5.5),
};

/** unit vector from a compass angle off +z (toward +x) and an elevation, in degrees */
function dirFrom(azDeg: number, elDeg: number): [number, number, number] {
  const a = (azDeg * Math.PI) / 180;
  const e = (elDeg * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
}

export const lin = (hex: string): RGB => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

/** a colour ramp over elevation (degrees) */
type Ramp = { e: number; c: RGB }[];
export const ramp = (stops: [number, string][]): Ramp => stops.map(([e, h]) => ({ e, c: lin(h) }));
function sampleRamp(r: Ramp, e: number, out: RGB) {
  if (e <= r[0]!.e) return copy(out, r[0]!.c);
  for (let i = 1; i < r.length; i++) {
    const b = r[i]!;
    if (e <= b.e) {
      const a = r[i - 1]!;
      let t = (e - a.e) / (b.e - a.e);
      t = t * t * (3 - 2 * t);
      out[0] = a.c[0] + (b.c[0] - a.c[0]) * t;
      out[1] = a.c[1] + (b.c[1] - a.c[1]) * t;
      out[2] = a.c[2] + (b.c[2] - a.c[2]) * t;
      return out;
    }
  }
  return copy(out, r[r.length - 1]!.c);
}
function copy(o: RGB, c: RGB) {
  o[0] = c[0];
  o[1] = c[1];
  o[2] = c[2];
  return o;
}

// ---- value noise for the clouds ----
function hash2(x: number, y: number) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let fx = x - xi;
  let fy = y - yi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x: number, y: number, oct: number) {
  let s = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < oct; o++) {
    s += vnoise(x, y) * amp;
    norm += amp;
    x = x * 2.03 + 17.1;
    y = y * 2.03 - 9.7;
    amp *= 0.5;
  }
  return s / norm;
}

export type SunsetPalette = {
  sun: [number, number, number];
  /** sky over elevation, looking toward the sun */
  toward: Ramp;
  /** sky over elevation, looking away from it (earth shadow, belt of Venus) */
  away: Ramp;
  glow: RGB;
  halo: RGB;
  disc: RGB;
  /** cloud colours: undersides lit near the sun / away from it, and the shaded cores */
  cloudGold: RGB;
  cloudPink: RGB;
  cloudCore: RGB;
  cloudAmount: number;
  seed: number;
};

/** Vice City at dusk: gold and tangerine on the horizon, coral and hot pink above it,
 * lavender and purple up to a deep blue zenith; a pink belt of Venus opposite the sun */
export const CITY_SUNSET: SunsetPalette = {
  sun: SUN_DIR.sunset,
  toward: ramp([
    [-6, "#e8905e"],
    [0, "#ffc47a"],
    [2.5, "#ffa45c"],
    [6, "#ff8560"],
    [11, "#fb6f7e"],
    [19, "#e0679a"],
    [30, "#a664ac"],
    [46, "#6a58a6"],
    [66, "#3a4088"],
    [90, "#212a68"],
  ]),
  away: ramp([
    [-6, "#8a6c8c"],
    [0, "#c48aa0"],
    [3, "#a88aac"],
    [9, "#e19ab4"],
    [17, "#c192c0"],
    [30, "#8a7cb8"],
    [50, "#4e56a0"],
    [90, "#212a68"],
  ]),
  glow: lin("#ffb35c"),
  halo: lin("#ff7a52"),
  disc: lin("#ffe9b8"),
  cloudGold: lin("#f7a45e"),
  cloudPink: lin("#f0709c"),
  cloudCore: lin("#7c4f88"),
  cloudAmount: 0.5,
  seed: 3,
};

/** the arena maps' sunset: the city palette leaning toward each theme's own sky */
export function arenaPalette(themeSky: string, sun: [number, number, number]): SunsetPalette {
  const t = lin(themeSky);
  const lean = (r: Ramp, k: number): Ramp =>
    r.map(({ e, c }) => ({
      e,
      c: [c[0] + (t[0] - c[0]) * k, c[1] + (t[1] - c[1]) * k, c[2] + (t[2] - c[2]) * k] as RGB,
    }));
  const l = Math.hypot(...sun);
  return {
    ...CITY_SUNSET,
    sun: [sun[0] / l, sun[1] / l, sun[2] / l],
    toward: lean(CITY_SUNSET.toward, 0.28),
    away: lean(CITY_SUNSET.away, 0.35),
    cloudAmount: 0.42,
    seed: 11,
  };
}

const RAD = 180 / Math.PI;
/**
 * Paint a sunset sky: `hdr` returns linear radiance (sun and glow above 1), otherwise the
 * values are rolled off into a display-ready range for the background.
 */
function paintRows(
  P: SunsetPalette,
  W: number,
  H: number,
  hdr: boolean,
  out: Float32Array,
  rowA: number,
  rowB: number,
) {
  const [sx, sy, sz] = P.sun;
  const sh = Math.hypot(sx, sz) || 1;
  const shx = sx / sh;
  const shz = sz / sh;
  const cT: RGB = [0, 0, 0];
  const cA: RGB = [0, 0, 0];
  const cc: RGB = [0, 0, 0];
  const discR = 0.95 / RAD;
  const seedOff = P.seed * 37.1;
  for (let py = rowA; py < rowB; py++) {
    // row 0 = top of the image = straight up
    const el = (0.5 - (py + 0.5) / H) * Math.PI;
    const elD = el * RAD;
    const ce = Math.cos(el);
    const dy = Math.sin(el);
    sampleRamp(P.toward, elD, cT);
    sampleRamp(P.away, elD, cA);
    for (let px = 0; px < W; px++) {
      const phi = ((px + 0.5) / W - 0.5) * Math.PI * 2;
      const dx = Math.cos(phi) * ce;
      const dz = Math.sin(phi) * ce;
      // horizontal alignment with the sun: 1 toward, 0 away
      const hz = ce > 1e-4 ? (dx * shx + dz * shz) / ce : 0;
      const w = Math.pow((hz + 1) / 2, 2.4);
      let r = cA[0] + (cT[0] - cA[0]) * w;
      let g = cA[1] + (cT[1] - cA[1]) * w;
      let b = cA[2] + (cT[2] - cA[2]) * w;
      // the sun: a hot core, a gold glow and a wide coral halo (forward scattering)
      const cosG = Math.min(1, dx * sx + dy * sy + dz * sz);
      const gam = Math.acos(cosG);
      const below = elD < 0 ? Math.max(0, 1 + elD / 3) : 1;
      // wide gold glow, a tighter corona and a hot rim right round the disc
      const glow =
        1.1 * Math.exp(-gam / 0.11) + 0.45 * Math.exp(-gam / 0.03) + 0.35 * Math.exp(-gam / 0.012);
      const halo = 0.55 * Math.exp(-gam / 0.5);
      r += (P.glow[0] * glow + P.halo[0] * halo) * below;
      g += (P.glow[1] * glow + P.halo[1] * halo) * below;
      b += (P.glow[2] * glow + P.halo[2] * halo) * below;
      // clouds on a flat layer: perspective squashes them into streaks toward the horizon
      if (elD > 1.2 && elD < 80) {
        const inv = 1 / Math.max(dy, 0.05);
        const cx = dx * inv * 1.35 + seedOff;
        const cz = dz * inv * 1.35 - seedOff;
        // a large-scale coverage field decides where the cloud banks are
        const bank = fbm(cx * 0.18, cz * 0.18, 3);
        // fewer octaves low down, where the layer is foreshortened (no shimmering streaks)
        let n = fbm(cx * 1.1 + bank * 1.7, cz * 0.75, elD < 7 ? 3 : 5);
        n = n * 0.62 + bank * 0.55 - 0.08;
        const cov = 1 - P.cloudAmount;
        let a = Math.min(1, Math.max(0, (n - cov) / 0.18));
        a *= Math.min(1, (elD - 1.2) / 6) * (1 - 0.5 * Math.max(0, (elD - 45) / 35));
        if (a > 0.002) {
          const dens = Math.min(1, Math.max(0, (n - cov - 0.1) / 0.25));
          const near = Math.pow(Math.max(cosG, 0), 5);
          // gold near the sun, hot pink across the sky, mauve high up away from it
          const k = Math.min(1, near * 1.6 + w * 0.35);
          copy(cc, P.cloudPink);
          cc[0] += (P.cloudGold[0] - cc[0]) * k;
          cc[1] += (P.cloudGold[1] - cc[1]) * k;
          cc[2] += (P.cloudGold[2] - cc[2]) * k;
          const hi = Math.max(0, (elD - 12) / 50) * (1 - w);
          const core = Math.min(0.85, dens * 0.55 + hi * 0.45);
          cc[0] += (P.cloudCore[0] - cc[0]) * core;
          cc[1] += (P.cloudCore[1] - cc[1]) * core;
          cc[2] += (P.cloudCore[2] - cc[2]) * core;
          // silver-gold lining on thin edges round the sun
          const rim = (1 - dens) * near * 1.2;
          const lift = 0.9 + rim * 0.5 + near * 0.35;
          r += (cc[0] * lift + P.glow[0] * rim - r) * a;
          g += (cc[1] * lift + P.glow[1] * rim - g) * a;
          b += (cc[2] * lift + P.glow[2] * rim - b) * a;
        }
      }
      // the disc itself (a touch larger than life so it reads on screen), limb darkened
      if (gam < discR * 1.25) {
        const t = gam / discR;
        const edge = t < 1 ? 1 : Math.max(0, 1 - (t - 1) / 0.25);
        const limb = 1 - 0.35 * t * t;
        if (hdr) {
          const k = edge * 14 * Math.max(limb, 0.3);
          r += P.disc[0] * k;
          g += P.disc[1] * k * 0.96;
          b += P.disc[2] * k * 0.82;
        } else {
          // on screen: a warm white disc (the corona round it is already blown out gold)
          const k = edge * 2.2 * Math.max(limb, 0.4);
          r += k;
          g += k * 0.92;
          b += k * 0.62;
        }
      }
      if (elD < 0) {
        // under the horizon: the haze just continues and darkens slightly
        const d = Math.min(1, -elD / 12) * 0.25;
        r *= 1 - d;
        g *= 1 - d;
        b *= 1 - d;
      }
      const o = (py * W + px) * 4;
      if (hdr) {
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
      } else {
        // soft shoulder: keeps the glow saturated instead of clipping to flat white
        out[o] = r < 0.8 ? r : 0.8 + 0.2 * (1 - Math.exp(-(r - 0.8) / 0.2));
        out[o + 1] = g < 0.8 ? g : 0.8 + 0.2 * (1 - Math.exp(-(g - 0.8) / 0.2));
        out[o + 2] = b < 0.8 ? b : 0.8 + 0.2 * (1 - Math.exp(-(b - 0.8) / 0.2));
      }
      out[o + 3] = 1;
    }
  }
}

/** Sky paintings in progress: painted a few rows at a time in idle moments after load, so
 * the first press of N doesn't freeze the game while ~2 million pixels get painted. */
type Job = { P: SunsetPalette; W: number; H: number; hdr: boolean; out: Float32Array; row: number };
const jobs = new Map<string, Job>();
function job(key: string, P: SunsetPalette, W: number, H: number, hdr: boolean) {
  let j = jobs.get(key);
  if (!j) jobs.set(key, (j = { P, W, H, hdr, out: new Float32Array(W * H * 4), row: 0 }));
  return j;
}
/** the finished painting (paints whatever is left right now) */
function paintSunset(key: string, P: SunsetPalette, W: number, H: number, hdr: boolean) {
  const j = job(key, P, W, H, hdr);
  if (j.row < H) paintRows(P, W, H, hdr, j.out, j.row, H);
  j.row = H;
  return j.out;
}
let slicing = false;
/** run in idle time where the browser offers it (Safari doesn't: short timeouts there) */
const later = (fn: (budget: number) => void, delay = 16) => {
  const ric = (
    window as { requestIdleCallback?: (cb: (d: IdleDeadline) => void, o?: object) => number }
  ).requestIdleCallback;
  if (ric) ric((d) => fn(Math.max(1, Math.min(8, d.timeRemaining() - 1))), { timeout: 400 });
  else setTimeout(() => fn(3), delay);
};
function slice(budget: number) {
  const t0 = performance.now();
  for (const j of jobs.values()) {
    while (j.row < j.H && performance.now() - t0 < budget) {
      const n = Math.min(j.H, j.row + 4);
      paintRows(j.P, j.W, j.H, j.hdr, j.out, j.row, n);
      j.row = n;
    }
  }
  if ([...jobs.values()].some((j) => j.row < j.H)) later(slice);
  else {
    slicing = false;
    const fns = whenDone;
    whenDone = [];
    fns.forEach((f) => later(f));
  }
}
let whenDone: (() => void)[] = [];
/** start painting the city sunset in the background; `done` runs once it's all painted */
export function prewarmSunset(done?: () => void) {
  if (typeof window === "undefined") return;
  job("sunset", CITY_SUNSET, 2048, 1024, false);
  job("sunset-env", CITY_SUNSET, 1024, 512, true);
  if (done) whenDone.push(done);
  if (!slicing) {
    slicing = true;
    later(slice, 500);
  }
}

const toSrgb8Exact = (v: number) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
};
/** linear 0..1 -> sRGB byte through a lookup table (millions of pixels per sky) */
const SRGB_LUT = new Uint8Array(4097);
for (let i = 0; i <= 4096; i++) SRGB_LUT[i] = toSrgb8Exact(i / 4096);
const toSrgb8 = (v: number) => SRGB_LUT[Math.max(0, Math.min(4096, Math.round(v * 4096)))]!;

/** display copy of a sunset: sRGB canvas texture (background) */
function* bakeSunsetBackground(
  key: string,
  P: SunsetPalette,
  W: number,
  H: number,
): Generator<void, THREE.CanvasTexture, void> {
  // paint incrementally instead of force-draining paintSunset's remaining rows
  const j = job(key, P, W, H, false);
  while (j.row < j.H) {
    yield;
    const n = Math.min(j.H, j.row + 48);
    paintRows(j.P, j.W, j.H, j.hdr, j.out, j.row, n);
    j.row = n;
  }
  const f = j.out;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const img = g.createImageData(W, H);
  const ROWS = 64;
  for (let y0 = 0; y0 < H; y0 += ROWS) {
    yield;
    for (let i = y0 * W; i < Math.min(H, y0 + ROWS) * W; i++) {
      // a hair of dither so the long gradients don't band
      const d = (hash2(i, 7) - 0.5) * 0.9;
      img.data[i * 4] = toSrgb8(f[i * 4]!) + d;
      img.data[i * 4 + 1] = toSrgb8(f[i * 4 + 1]!) + d;
      img.data[i * 4 + 2] = toSrgb8(f[i * 4 + 2]!) + d;
      img.data[i * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.needsUpdate = true;
  return t;
}
const sunsetBgCache = new Map<string, THREE.CanvasTexture>();
export function sunsetBackground(key: string, P: SunsetPalette, W: number, H: number) {
  let t = sunsetBgCache.get(key);
  if (!t) sunsetBgCache.set(key, (t = drain(bakeSunsetBackground(key, P, W, H))));
  return t;
}
/** the world build bakes the sky across tasks; the scene's call is then a cache hit */
export async function prepareSunsetBackground(
  key: string,
  P: SunsetPalette,
  W: number,
  H: number,
): Promise<void> {
  if (!sunsetBgCache.has(key))
    sunsetBgCache.set(key, await runSliced(bakeSunsetBackground(key, P, W, H)));
}

const sunsetEnvCache = new Map<string, THREE.DataTexture>();
/** HDR copy of a sunset for PMREM (reflections); the world build bakes it across tasks */
function* bakeSunsetEnv(
  key: string,
  P: SunsetPalette,
  W: number,
  H: number,
): Generator<void, THREE.DataTexture, void> {
  const j = job(key, P, W, H, true);
  while (j.row < j.H) {
    yield;
    const n = Math.min(j.H, j.row + 48);
    paintRows(j.P, j.W, j.H, j.hdr, j.out, j.row, n);
    j.row = n;
  }
  const f = j.out;
  // DataTexture rows run bottom-up
  const flipped = new Float32Array(f.length);
  for (let y0 = 0; y0 < H; y0 += 64) {
    yield;
    for (let y = y0; y < Math.min(H, y0 + 64); y++)
      flipped.set(f.subarray(y * W * 4, (y + 1) * W * 4), (H - 1 - y) * W * 4);
  }
  // half floats: linear filtering of full floats is not universal (older iOS)
  const half = new Uint16Array(flipped.length);
  const CHUNK = 1 << 17;
  for (let i0 = 0; i0 < flipped.length; i0 += CHUNK) {
    yield;
    for (let i = i0; i < Math.min(flipped.length, i0 + CHUNK); i++)
      half[i] = THREE.DataUtils.toHalfFloat(Math.min(flipped[i]!, 60000));
  }
  const t = new THREE.DataTexture(half, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  t.colorSpace = THREE.LinearSRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
function sunsetEnv(key: string, P: SunsetPalette, W: number, H: number) {
  let t = sunsetEnvCache.get(key);
  if (!t) sunsetEnvCache.set(key, (t = drain(bakeSunsetEnv(key, P, W, H))));
  return t;
}
/** the world build bakes the env source across tasks; scene calls then hit the cache */
export async function prepareSunsetEnv(
  key: string,
  P: SunsetPalette,
  W: number,
  H: number,
): Promise<void> {
  if (!sunsetEnvCache.has(key))
    sunsetEnvCache.set(key, await runSliced(bakeSunsetEnv(key, P, W, H)));
}

// ---- the city's night sky (gradient, sodium glow on the horizon, a faint moon) ----
function nightSky() {
  const W = 1024;
  const H = 512;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, "#03060f");
  gr.addColorStop(0.3, "#0c1426");
  gr.addColorStop(0.495, "#2a2638");
  gr.addColorStop(0.505, "#2a2638");
  gr.addColorStop(0.56, "#161a2a");
  gr.addColorStop(1, "#161a2a");
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  const hz = g.createLinearGradient(0, H * 0.4, 0, H * 0.5);
  hz.addColorStop(0, "rgba(90,60,50,0)");
  hz.addColorStop(1, "rgba(120,80,60,0.55)");
  g.fillStyle = hz;
  g.fillRect(0, H * 0.4, W, H * 0.1);
  const [sx, sy, sz] = SUN_DIR.night;
  const l = Math.hypot(sx, sy, sz);
  const u = (Math.atan2(sz, sx) / (Math.PI * 2) + 0.5) * W;
  const v = (0.5 - Math.asin(sy / l) / Math.PI) * H;
  const mg = g.createRadialGradient(u, v, 0, u, v, 40);
  mg.addColorStop(0, "rgba(230,236,255,0.9)");
  mg.addColorStop(0.2, "rgba(200,210,240,0.5)");
  mg.addColorStop(1, "rgba(160,170,220,0)");
  g.fillStyle = mg;
  g.fillRect(u - 40, v - 40, 80, 80);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.needsUpdate = true;
  return t;
}

const cache = new Map<string, THREE.Texture>();
const cached = <T extends THREE.Texture>(key: string, make: () => T) => {
  let t = cache.get(key) as T | undefined;
  if (!t) cache.set(key, (t = make()));
  return t;
};

/** the city background sky */
export function skyTexture(time: TimeOfDay) {
  return time === "night"
    ? cached("night", nightSky)
    : cached("sunset", () => sunsetBackground("sunset", CITY_SUNSET, 2048, 1024));
}
/** the equirect source of the city's reflection env map */
export function skyEnvSource(time: TimeOfDay) {
  return time === "night"
    ? skyTexture("night")
    : cached("sunset-env", () => sunsetEnv("sunset-env", CITY_SUNSET, 1024, 512));
}
/** an arena map's sunset sky: background, and the env source for its (few) shiny bits */
export function arenaSunsetSky(themeName: string, themeSky: string, sun: [number, number, number]) {
  const key = `arena-${themeName}`;
  return cached(key, () => sunsetBackground(key, arenaPalette(themeSky, sun), 1024, 512));
}

/** Any big map's own sunset, painted from its palette: display background + HDR env source. */
export function paletteSkyTextures(key: string, P: SunsetPalette) {
  return {
    background: cached(key, () => sunsetBackground(key, P, 2048, 1024)),
    env: cached(`${key}-env`, () => sunsetEnv(`${key}-env`, P, 1024, 512)),
  };
}
/** paint a palette's sunset in idle moments (like `prewarmSunset`); `done` runs once it's ready */
export function prewarmPalette(key: string, P: SunsetPalette, done?: () => void) {
  if (typeof window === "undefined") return;
  job(key, P, 2048, 1024, false);
  job(`${key}-env`, P, 1024, 512, true);
  if (done) whenDone.push(done);
  if (!slicing) {
    slicing = true;
    later(slice, 500);
  }
}

/**
 * The sky's colour on the horizon (sRGB hex, as displayed): straight away from the sun, or
 * under the sun including its glow. The haze uses these so far towers melt into the sky.
 */
export function horizonHex(P: SunsetPalette, towardSun: boolean, elDeg = 1.5) {
  const c: RGB = [0, 0, 0];
  sampleRamp(towardSun ? P.toward : P.away, elDeg, c);
  if (towardSun) {
    const gam = Math.max(0.02, Math.asin(P.sun[1]) - (elDeg * Math.PI) / 180);
    const glow = 1.1 * Math.exp(-gam / 0.11) + 0.35 * Math.exp(-gam / 0.03);
    const halo = 0.55 * Math.exp(-gam / 0.5);
    for (let i = 0; i < 3; i++) c[i]! += (P.glow[i]! * glow + P.halo[i]! * halo) * 0.8;
  }
  const hex = (v: number) => toSrgb8(Math.min(v, 1)).toString(16).padStart(2, "0");
  return "#" + hex(c[0]) + hex(c[1]) + hex(c[2]);
}
