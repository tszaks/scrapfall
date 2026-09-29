// Runs the map events inside the scene: the host's scheduling, every client's timeline,
// and the pieces they need on screen (the flashlight and glowing robot eyes for the
// blackout, the snow front for the avalanche).
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { AlpineLayout } from "../alpine/layout";
import { setAmbienceBlackout, setAmbiencePower } from "../ambience";
import type { CityLayout } from "../cityLayout";
import { glowTexture } from "../cityTextures";
import { hitBand } from "../enemyKinds";
import type { NetHandle } from "../net";
import { groundY } from "../terrain";
import type { Theme } from "../themes";
import { AVALANCHE_EVENT, AV_WARN, avState, avalanchePlan, runAt } from "./avalanche";
import { BLACKOUT_EVENT } from "./blackout";
import { TRAIN_ROBBERY_EVENT, WAVE_SURGE_EVENT } from "./mapHooks";
import {
  forceMapEvent,
  forceRequests,
  hostSchedule,
  mapEvent,
  registerMapEvent,
  resetMapEvents,
  startMapEvent,
  type EventCtx,
  type EventEnemy,
} from "./mapEvents";
import { power, powerAt, restorePower } from "./power";
import { playAvalanche, playTrainRobbery } from "./eventAudio";
import { playAirRaid, playHorn } from "./sfx";

// every map's events (explicit: the bundle drops side-effect-only imports)
for (const def of [BLACKOUT_EVENT, AVALANCHE_EVENT, TRAIN_ROBBERY_EVENT, WAVE_SURGE_EVENT]) registerMapEvent(def);

function alarm(kind: string | undefined) {
  if (kind === "siren") playAirRaid(10);
  else if (kind === "rumble") playAvalanche();
  else if (kind === "horn") playHorn(0.22, true);
  else if (kind === "whistle") playTrainRobbery();
}

export function MapEvents({
  theme,
  city,
  enemies,
  net,
  isHost,
  wave,
  playing,
  matchSeed,
  hurtPlayer,
  movePlayer,
  hurtEnemy,
  spawnEnemies,
  alive,
}: {
  theme: Theme;
  city: CityLayout | null;
  enemies: EventEnemy[];
  net: NetHandle | null;
  isHost: boolean;
  wave: React.MutableRefObject<number>;
  playing: boolean;
  matchSeed: number;
  hurtPlayer: EventCtx["hurtPlayer"];
  movePlayer: EventCtx["movePlayer"];
  hurtEnemy: EventCtx["hurtEnemy"];
  spawnEnemies: EventCtx["spawnEnemies"];
  alive: React.MutableRefObject<boolean>;
}) {
  const camera = useThree((s) => s.camera);
  const cb = useRef({ hurtPlayer, movePlayer, hurtEnemy, spawnEnemies, net, isHost, playing });
  cb.current = { hurtPlayer, movePlayer, hurtEnemy, spawnEnemies, net, isHost, playing };
  const ctx = useMemo<EventCtx>(
    () => ({
      t: 0,
      dt: 0,
      seed: 0,
      host: true,
      theme,
      city,
      player: { x: 0, y: 0, z: 0, alive: true },
      hurtPlayer: (...a) => cb.current.hurtPlayer(...a),
      movePlayer: (...a) => cb.current.movePlayer(...a),
      hurtEnemy: (...a) => cb.current.hurtEnemy(...a),
      spawnEnemies: (...a) => (cb.current.isHost ? cb.current.spawnEnemies(...a) : 0),
      enemies,
      banner: (title, sub = "", color = "#b3261e") => {
        mapEvent.banner = { title, sub, color, at: performance.now() };
      },
    }),
    [theme, city, enemies],
  );

  // a new arena: nothing carries over
  useEffect(() => {
    const a = resetMapEvents();
    if (a) a.def.end?.(ctx);
    restorePower();
    return () => {
      const b = resetMapEvents();
      if (b) b.def.end?.(ctx);
      restorePower();
    };
  }, [ctx, matchSeed]);

  useEffect(() => {
    // test handle (?debug=1); `&event=blackout` fires an event as the match starts
    const q = new URLSearchParams(window.location.search);
    if (q.get("debug") === "1") {
      (window as unknown as { __events?: unknown }).__events = { avState, power, mapEvent, avalanchePlan, runAt };
      const ev = q.get("event");
      if (ev) forceMapEvent(ev);
    }
  }, []);
  const announce = useRef(0);
  const ambPower = useRef(1);
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    const c = cb.current;
    // the blackout silences the neon buzz and dims the city hum around you
    const pw = power.out ? powerAt(camera.position.x, camera.position.z) : 1;
    if (Math.abs(pw - ambPower.current) > 0.02 || (pw === 1 && ambPower.current !== 1)) {
      ambPower.current = pw;
      setAmbiencePower(pw);
    }
    // car alarms and an alarmed crowd while any district is dark
    setAmbienceBlackout(power.out);
    if (!c.playing) return;
    const n = c.net;
    // host / solo: roll for events as waves start, and honour test requests
    if (c.isHost) {
      let go = hostSchedule(wave.current, dt, theme, city, matchSeed);
      const forced = forceRequests.shift();
      if (forced && !mapEvent.active) go = { id: forced, seed: (Math.random() * 1e9) | 0 };
      if (go && startMapEvent(go.id, go.seed, 0)) {
        n?.broadcast({ type: "mev", id: go.id, s: go.seed, t: 0 });
        announce.current = 2;
      }
    }
    const a = mapEvent.active;
    if (!a) return;
    ctx.dt = dt;
    ctx.seed = a.seed;
    ctx.host = c.isHost;
    ctx.player.x = camera.position.x;
    ctx.player.y = camera.position.y;
    ctx.player.z = camera.position.z;
    ctx.player.alive = alive.current;
    if (!a.started) {
      a.started = true;
      ctx.t = a.t;
      ctx.banner(a.def.title, a.def.sub, a.def.color);
      alarm(a.def.sound);
      a.def.start?.(ctx);
    }
    a.t += dt;
    ctx.t = a.t;
    if (a.t >= a.def.duration) {
      a.def.end?.(ctx);
      mapEvent.active = null;
      if (c.isHost) n?.broadcast({ type: "mev", id: "" });
      return;
    }
    a.def.step?.(ctx);
    // the host repeats the start so late joiners and drifting clocks line up
    if (c.isHost && n) {
      announce.current -= dt;
      if (announce.current <= 0) {
        announce.current = 2;
        n.broadcast({ type: "mev", id: a.def.id, s: a.seed, t: Math.round(a.t * 10) / 10 });
      }
    }
  });

  const cityMap = theme.blockShape === "city";
  const alpineMap = !!city && "alpine" in city;
  return (
    <>
      {cityMap && !noFlashlight && <Flashlight />}
      {cityMap && <EyeGlow enemies={enemies} theme={theme} />}
      {alpineMap && <AvalancheFx layout={city as AlpineLayout} />}
    </>
  );
}

/** `?flashlight=0` leaves the flashlight out (perf comparisons) */
const noFlashlight = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("flashlight") === "0";
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();

/**
 * The player's flashlight: switches itself on when the power dies around you. A spot light
 * changes every lit material's shader, so it is only in the scene around a blackout: when
 * the grid starts failing its shader variants are compiled in the background (parallel
 * compile, no hitch) during the warning flicker, then it joins the scene; a few seconds
 * after the power is back it leaves again. The variants stay cached for the next one.
 */
function Flashlight() {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const light = useMemo(() => {
    const l = new THREE.SpotLight("#fff2dc", 0, 70, 0.4, 0.55, 1.4);
    l.castShadow = false;
    return l;
  }, []);
  const st = useRef({ inScene: false, compiling: false, idle: 0, frame: 0 });
  useEffect(
    () => () => {
      scene.remove(light);
      light.dispose();
      st.current.inScene = false;
    },
    [scene, light],
  );
  const on = useRef(0);
  useFrame((state, raw) => {
    const dt = Math.min(raw, 0.05);
    const S = st.current;
    // shortly after the map is built (behind the start menu, usually), compile the lit
    // variants in the background once, so the blackout's own compile finds them all cached
    // (again a little later: materials whose textures arrive late get new variants)
    S.frame++;
    const warmNow = (S.frame === 30 || S.frame === 240 || S.frame === 900) && !S.inScene && !power.out;
    if ((warmNow || (power.out && !S.inScene)) && !S.compiling) {
      S.compiling = true;
      const probe = new THREE.Scene();
      probe.add(new THREE.SpotLight("#ffffff", 0));
      // compile() builds each program for the TARGET scene's fog and environment: without
      // these the variants made here missed every real one (no fog), and the first dark frame
      // compiled all ~70 lit programs again, synchronously (a 1.5 s freeze measured in WebKit)
      probe.fog = scene.fog;
      probe.environment = scene.environment;
      const join = () => {
        S.compiling = false;
        if (!power.out) return; // (the warm-up pass)
        if (!S.inScene) {
          scene.add(light);
          S.inScene = true;
          S.idle = 0;
        }
      };
      gl.compileAsync(scene, camera, probe).then(join, join);
    }
    if (!S.inScene) return;
    const dark = power.out && powerAt(camera.position.x, camera.position.z) < 0.5;
    on.current += ((dark ? 1 : 0) - on.current) * Math.min(1, dt * (dark ? 6 : 3));
    // a couple of stutters as it clicks on
    const stutter = dark && on.current < 0.9 && Math.sin(state.clock.elapsedTime * 60) > 0.3 ? 0.3 : 1;
    light.intensity = on.current > 0.01 ? 80 * on.current * stutter : 0;
    camera.getWorldDirection(_f);
    _r.crossVectors(_f, camera.up).normalize();
    // held just ahead of the gun (so the gun itself isn't blown out), aimed down the sights
    light.position.copy(camera.position).addScaledVector(_f, 1.0).addScaledVector(_r, 0.18).addScaledVector(camera.up, -0.2);
    light.target.position.copy(camera.position).addScaledVector(_f, 14);
    light.target.updateMatrixWorld();
    // the power is back: put it away
    S.idle = power.out ? 0 : S.idle + dt;
    if (S.idle > 4) {
      scene.remove(light);
      S.inScene = false;
      on.current = 0;
    }
  });
  return null;
}

const EYE_MAX = 110;
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** blackout: every robot's eyes burn through the dark (additive glows at head height) */
function EyeGlow({ enemies, theme }: { enemies: EventEnemy[]; theme: Theme }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: glowTexture(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  const eyeOf = (kind: string) => {
    const e = theme.enemy;
    if (kind === "drifter" || kind === "runner" || kind === "specter" || kind === "hornet") return e.drifter.eye;
    if (kind === "brute" || kind === "vanguard" || kind === "boss" || kind === "bulwark" || kind === "charger")
      return e.brute.eye;
    if (kind === "special") return theme.special.glow;
    return e.shooter.eye;
  };
  useFrame((state) => {
    const m = ref.current;
    if (!m) return;
    if (!power.out) {
      m.visible = false;
      return;
    }
    m.visible = true;
    const q = state.camera.quaternion;
    const pulse = 0.9 + 0.1 * Math.sin(state.clock.elapsedTime * 5);
    let n = 0;
    for (let i = 0; i < enemies.length && n < EYE_MAX; i++) {
      const e = enemies[i]!;
      if (!e.alive) continue;
      const dark = 1 - powerAt(e.x, e.z);
      if (dark < 0.05) continue;
      const hi = hitBand(e.kind)[1];
      const sz = (e.kind === "boss" ? 3 : 1.25) * dark * pulse;
      _m.compose(_p.set(e.x, groundY(e.x, e.z) + hi * 0.82, e.z), q, _s.set(sz, sz, sz));
      m.setMatrixAt(n, _m);
      m.setColorAt(n, _c.set(eyeOf(e.kind)).multiplyScalar(1.6));
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, mat, EYE_MAX]} frustumCulled={false} visible={false} renderOrder={5} />;
}

const PUFFS = 70;
const MOUNDS = 9;

/** the avalanche: a red warning strip down the threatened run, the rolling snow front, and
 * the mounds it leaves across the bottom */
function AvalancheFx({ layout }: { layout: AlpineLayout }) {
  const strip = useRef<THREE.Mesh>(null);
  const puffs = useRef<THREE.InstancedMesh>(null);
  const mounds = useRef<THREE.InstancedMesh>(null);
  const puffGeo = useMemo(() => new THREE.IcosahedronGeometry(1, 1), []);
  const moundGeo = useMemo(() => new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), []);
  const snow = useMemo(
    () => new THREE.MeshLambertMaterial({ color: "#f4f8ff", emissive: "#c8d4ec", emissiveIntensity: 0.55, flatShading: true }),
    [],
  );
  const stripMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#ff3a2a",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
        toneMapped: false,
      }),
    [],
  );
  const stripKey = useRef("");
  useEffect(
    () => () => {
      puffGeo.dispose();
      moundGeo.dispose();
      snow.dispose();
      stripMat.dispose();
      strip.current?.geometry.dispose();
    },
    [puffGeo, moundGeo, snow, stripMat],
  );
  useFrame((state) => {
    const p = avState.plan;
    const on = !!p && mapEvent.active?.def.id === "avalanche";
    const st = strip.current;
    const pf = puffs.current;
    const md = mounds.current;
    if (!st || !pf || !md) return;
    st.visible = on && avState.front < p!.total;
    pf.visible = on && avState.front >= 0 && avState.front < p!.total + 12;
    md.visible = on && avState.mounds > 0.02;
    if (!on || !p) return;
    // the warning strip: a ribbon draped on the run, rebuilt once per avalanche
    const key = `${p.run.name}|${p.total}`;
    if (stripKey.current !== key) {
      stripKey.current = key;
      const segs = Math.max(8, Math.round(p.total / 4));
      const pos: number[] = [];
      const idx: number[] = [];
      for (let s = 0; s <= segs; s++) {
        const q = runAt(p, (s / segs) * p.total);
        for (const side of [-1, 1]) {
          const x = q.x - q.dz * side * p.half;
          const z = q.z + q.dx * side * p.half;
          pos.push(x, groundY(x, z) + 0.35, z);
        }
        if (s < segs) {
          const b = s * 2;
          idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      st.geometry.dispose();
      st.geometry = g;
    }
    const t = avState.t;
    stripMat.opacity =
      t < AV_WARN ? 0.18 + 0.2 * (Math.sin(t * 9) * 0.5 + 0.5) : Math.max(0, 0.25 - (t - AV_WARN) * 0.05);
    // the front: a rolling wall of snow across the run, a powder cloud trailing behind
    const time = state.clock.elapsedTime;
    if (pf.visible) {
      for (let i = 0; i < PUFFS; i++) {
        const lane = (i % 14) / 13 - 0.5; // across the run
        const row = Math.floor(i / 14); // 0 = the front, higher rows trail behind and rise
        const s = Math.min(p.total, avState.front - row * 5 - ((i * 7) % 3));
        const q = runAt(p, Math.max(0, s));
        const lat = lane * p.half * 2 + Math.sin(i * 12.9 + time * 2) * 1.5;
        const x = q.x - q.dz * lat;
        const z = q.z + q.dx * lat;
        const r = (2.8 + ((i * 37) % 10) * 0.3) * (1 + row * 0.35);
        const y = groundY(x, z) + r * 0.55 + row * 1.2 + Math.abs(Math.sin(time * 3 + i)) * 0.8;
        _m.compose(_p.set(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(time * 2 + i, i, 0)), _s.set(r, r * 0.85, r));
        pf.setMatrixAt(i, _m);
      }
      pf.instanceMatrix.needsUpdate = true;
    }
    if (md.visible) {
      const k = avState.mounds;
      p.mounds.forEach((m, i) => {
        const r = m.r * (0.4 + 0.6 * k);
        _m.compose(_p.set(m.x, groundY(m.x, m.z) - 0.2, m.z), new THREE.Quaternion(), _s.set(r, r * 0.62 * (0.3 + 0.7 * k), r));
        md.setMatrixAt(i, _m);
      });
      md.count = p.mounds.length;
      md.instanceMatrix.needsUpdate = true;
    }
  });
  // warm the plan so the first frame of the event doesn't stall
  useEffect(() => {
    avalanchePlan(layout, 1);
  }, [layout]);
  return (
    <>
      <mesh ref={strip} material={stripMat} visible={false} renderOrder={3} frustumCulled={false}>
        <bufferGeometry />
      </mesh>
      <instancedMesh ref={puffs} args={[puffGeo, snow, PUFFS]} visible={false} frustumCulled={false} castShadow />
      <instancedMesh ref={mounds} args={[moundGeo, snow, MOUNDS]} visible={false} frustumCulled={false} castShadow receiveShadow />
    </>
  );
}
