// The AUTO quality governor: holds a steady frame rate by trading resolution first, then the
// quality tier (quality.ts).
//
// Every second it looks at the frame times it saw. Frames that miss 60 fps (> 18.5 ms) on
// more than ~8% of frames for three seconds running step the resolution down one notch; at
// the bottom of the tier's range the tier itself steps down (shadows, mirror, rain...). Six
// clean seconds (and 15 s since the last step down) step the resolution back up: each change
// resizes the canvas, which costs a frame, so it moves rarely. A level that failed right after
// a step up is remembered for a minute so the governor doesn't flip-flop. On a 120 Hz
// display it also trims the resolution (but not below 1.3) when it can't keep up with it.
//
// The Canvas reads `liveDpr()` (quality.ts) for its `dpr` prop, so a re-render of the game
// never resets what the governor picked (react-three-fiber re-applies the prop on every render).
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";

import { setParticleScale } from "./fxCore";
import { setRoomsEnabled } from "./interiors";
import {
  holdQuality,
  liveDpr,
  quality,
  qualityHeld,
  setAutoTier,
  setLiveDpr,
  useQuality,
  type Tier,
} from "./quality";

const STEP_DOWN = 0.15;
const STEP_UP = 0.1;
const MISS_60 = 18.5; // ms: a frame that missed a 60 Hz vsync
const TIERS: Tier[] = ["low", "medium", "high"];

type Log = { t: number; what: string };
const debug = {
  dpr: liveDpr(),
  tier: quality().tier,
  vsync: 16.7,
  miss: 0,
  cpu: 0,
  log: [] as Log[],
};
if (typeof window !== "undefined")
  (window as unknown as { __rsQuality?: unknown }).__rsQuality = debug;

export function QualityGovernor() {
  const setDpr = useThree((s) => s.setDpr);
  const gl = useThree((s) => s.gl);
  const q = useQuality();
  const st = useRef({
    win: [] as number[],
    winT: 0,
    bad: 0,
    good: 0,
    cool: 2,
    lastUp: -1e9,
    ceiling: 99,
    ceilingUntil: 0,
    tierAt: 0,
    lastDown: -1e9,
    tierUpAt: -1e9,
    tierWait: 20,
    clock: 0,
    vsync: 16.7,
    cpu: [] as number[],
    t0: 0,
    tEnd: 0,
  });
  useEffect(() => holdQuality(8000), []);
  // CPU per frame: from the first frame callback to the end of the frame's last
  // to-screen render — post passes run after the scene render, so sampling the first
  // one would hide their cost. When frames are slow but the CPU is the long pole,
  // fewer pixels won't help: step the tier instead.
  useFrame(() => {
    const S = st.current;
    if (S.t0 > 0 && S.tEnd > 0) S.cpu.push(S.tEnd - S.t0);
    S.t0 = performance.now();
    S.tEnd = 0;
  }, -1000);
  useEffect(() => {
    const orig = gl.render;
    const S = st.current;
    gl.render = function (scene, camera) {
      orig.call(this, scene, camera);
      if (S.t0 > 0 && this.getRenderTarget() === null)
        S.tEnd = performance.now();
    };
    return () => {
      gl.render = orig;
    };
  }, [gl]);

  const tierDown = (tier: Tier, why: string) => {
    const S = st.current;
    const next = TIERS[TIERS.indexOf(tier) - 1]!;
    // a tier that fails soon after stepping up waits twice as long before the next try
    if (S.clock - S.tierUpAt < 30) S.tierWait = Math.min(240, S.tierWait * 2);
    S.tierAt = S.clock;
    debug.log.push({ t: +S.clock.toFixed(1), what: `${why}: tier down ${next}` });
    setAutoTier(next);
  };

  const apply = (d: number, why: string) => {
    const v = Math.round(d * 100) / 100;
    if (v === liveDpr()) return;
    if (v < liveDpr()) st.current.lastDown = st.current.clock;
    setLiveDpr(v);
    debug.dpr = v;
    debug.log.push({ t: +st.current.clock.toFixed(1), what: `${why} dpr ${v}` });
    if (debug.log.length > 60) debug.log.shift();
    setDpr(v);
    st.current.cool = 2; // the resize itself costs a frame: skip judging the next windows
  };

  // a new pref / tier: pull the resolution into its range (manual tiers sit at the top)
  useEffect(() => {
    const { spec, pref } = q;
    debug.tier = q.tier;
    setRoomsEnabled(spec.rooms);
    setParticleScale(spec.particles);
    const want =
      pref === "auto" ? Math.min(spec.dprMax, Math.max(spec.dprMin, liveDpr())) : spec.dprMax;
    apply(want, `tier ${q.tier}`);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps -- apply only reads refs

  useFrame((_, raw) => {
    const S = st.current;
    const ms = raw * 1000;
    S.clock += raw;
    // tab switches, pauses, pointer-lock prompts: not a performance signal
    if (ms > 1000 || document.hidden) return;
    // a map is loading / warming up: not a performance signal either
    if (qualityHeld()) {
      S.win = [];
      S.winT = 0;
      S.bad = 0;
      S.good = 0;
      return;
    }
    S.win.push(ms);
    S.winT += ms;
    if (S.winT < 1000) return;
    const w = S.win;
    S.win = [];
    S.winT = 0;
    const sorted = [...w].sort((a, b) => a - b);
    // the display's refresh interval: the fast end of what we see, eased
    const fast = sorted[Math.floor(sorted.length * 0.2)] ?? 16.7;
    S.vsync += (Math.min(17.5, Math.max(6.9, fast)) - S.vsync) * 0.3;
    debug.vsync = +S.vsync.toFixed(2);
    const cpuS = S.cpu.sort((a, b) => a - b);
    const cpuMed = cpuS[Math.floor(cpuS.length / 2)] ?? 0;
    S.cpu = [];
    debug.cpu = +cpuMed.toFixed(1);
    const miss60 = w.filter((f) => f > MISS_60).length / w.length;
    const hiHz = S.vsync < 12;
    const missHi = hiHz ? w.filter((f) => f > S.vsync * 1.45).length / w.length : 0;
    debug.miss = +miss60.toFixed(3);
    const { pref, spec, tier } = quality();
    if (pref !== "auto") return;
    if (S.cool > 0) {
      S.cool--;
      return;
    }
    const bad = miss60 > 0.08 || (hiHz && missHi > 0.3 && liveDpr() > Math.max(spec.dprMin, 1.3));
    const good = miss60 < 0.015 && (!hiHz || missHi < 0.08);
    S.bad = bad ? S.bad + 1 : 0;
    S.good = good ? S.good + 1 : 0;
    if (S.bad >= 3) {
      S.bad = 0;
      // failing right after a step up: that level is too much for now
      if (S.clock - S.lastUp < 10) {
        S.ceiling = liveDpr();
        S.ceilingUntil = S.clock + 60;
      }
      const hard = miss60 > 0.08;
      const cpuBound = cpuMed > 13;
      if (cpuBound && hard && tier !== "low") tierDown(tier, `cpu ${cpuMed.toFixed(1)}ms`);
      else if (cpuBound) {
        // nothing left to trade that would help
      } else if (liveDpr() - STEP_DOWN >= spec.dprMin - 1e-3) apply(liveDpr() - STEP_DOWN, "slow");
      else if (liveDpr() > spec.dprMin + 1e-3) apply(spec.dprMin, "slow");
      else if (hard && tier !== "low") tierDown(tier, "slow at the lowest resolution");
    } else if (S.good >= 6 && S.clock - S.lastDown > 15) {
      const ceil = S.clock < S.ceilingUntil ? S.ceiling - 0.01 : 99;
      if (liveDpr() + 0.01 < spec.dprMax && liveDpr() + STEP_UP < ceil) {
        S.good = 0;
        S.lastUp = S.clock;
        apply(Math.min(spec.dprMax, liveDpr() + STEP_UP), "headroom");
      } else if (
        liveDpr() + 0.01 >= spec.dprMax &&
        tier !== "high" &&
        S.good >= 10 &&
        S.clock - S.tierAt > S.tierWait
      ) {
        S.good = 0;
        S.lastUp = S.clock;
        S.tierAt = S.clock;
        S.tierUpAt = S.clock;
        const next = TIERS[TIERS.indexOf(tier) + 1]!;
        debug.log.push({ t: +S.clock.toFixed(1), what: `tier up ${next}` });
        setAutoTier(next);
      }
    }
  });
  return null;
}
