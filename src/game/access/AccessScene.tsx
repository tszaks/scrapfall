import { registerStaticGeometry, registerStaticInstances } from "../staticCollision";
// Draws the access buildings: the merged exterior (entrances, penthouses, rooftop props),
// and per building the interiors (lobby, vestibule, stairwell), the elevator car and every
// sliding door, animated from the shared car state. Interiors are only drawn near the
// player. While the local player rides a closed car the city is hidden (nothing outside the
// car can be seen, and the shaft passes through roof planes of lower building parts).
import { useFrame, useThree } from "@react-three/fiber";
import { memo, useLayoutEffect, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { setIndoor } from "../ambience";
import { sfxBus } from "../audio";
import { glowTexture } from "../cityTextures";
import type { TimeOfDay } from "../lighting";
import { buildAccess, doorHeight, type DisplaySpot, type Interior } from "./build";
import { CAR_H, type AccessBuilding } from "./layout";
import {
  concreteTexture,
  CopPanel,
  Display,
  signTexture,
  steelTexture,
  woodTexture,
} from "./textures";
import { POWER_GLSL, powerAt, powerUniforms } from "../events/power";
import { addSkyFogUniforms } from "../skyFog";
import { tod } from "../timeOfDay";
import {
  CLOSING,
  IDLE,
  MOVING,
  OPENING,
  accessList,
  carFloor,
  carOf,
  carOpen,
  carY,
  player,
  portalDoor,
} from "./world";

/** exterior lights go dark with the city grid (the Vice Heights blackout) */
function powered<T extends THREE.Material>(m: T, off = 0.03): T {
  m.onBeforeCompile = (sh) => {
    addSkyFogUniforms(sh);
    Object.assign(sh.uniforms, powerUniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vPwXZ;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvPwXZ = (modelMatrix * vec4(transformed, 1.0)).xz;",
      );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec2 vPwXZ;\n${POWER_GLSL}`)
      .replace(
        "#include <opaque_fragment>",
        `#include <opaque_fragment>\ngl_FragColor.rgb *= mix(${off.toFixed(3)}, 1.0, gridPower(vPwXZ));`,
      );
  };
  m.customProgramCacheKey = () => "access-powered-" + off;
  return m;
}
/** interiors on emergency power: a dim red wash from the battery lamps */
const EMERGENCY = new THREE.Color(0.24, 0.055, 0.045);
const INNER_STEEL = new THREE.Color("#8b9096");
const _c = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);

type Mats = ReturnType<typeof makeMats>;
function makeMats() {
  return {
    ext: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.05 }),
    glow: powered(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })),
    sign: powered(
      new THREE.MeshBasicMaterial({ vertexColors: true, map: signTexture(), toneMapped: false }),
      0.08,
    ),
    pools: powered(
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        map: glowTexture(),
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
      0,
    ),
    beacon: new THREE.MeshBasicMaterial({ color: "#ff2a1a", toneMapped: false }),
    // interiors: baked light in the vertex colours
    base: new THREE.MeshBasicMaterial({ vertexColors: true }),
    steel: new THREE.MeshBasicMaterial({ vertexColors: true, map: steelTexture() }),
    wood: new THREE.MeshBasicMaterial({ vertexColors: true, map: woodTexture() }),
    conc: new THREE.MeshBasicMaterial({ vertexColors: true, map: concreteTexture() }),
    iglow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    isign: new THREE.MeshBasicMaterial({
      vertexColors: true,
      map: signTexture(),
      toneMapped: false,
    }),
    // doors
    glass: new THREE.MeshStandardMaterial({
      color: "#9fb7bf",
      roughness: 0.08,
      metalness: 0.6,
      transparent: true,
      opacity: 0.55,
      emissive: "#3a3226",
      emissiveIntensity: 0.6,
    }),
    doorSteel: new THREE.MeshStandardMaterial({
      color: "#b9bdc2",
      roughness: 0.35,
      metalness: 0.75,
      map: steelTexture(),
    }),
    innerSteel: new THREE.MeshBasicMaterial({ color: "#8b9096", map: steelTexture() }),
    frameDark: new THREE.MeshStandardMaterial({ color: "#2b2d31", roughness: 0.6 }),
    doorPaint: new THREE.MeshStandardMaterial({
      color: "#6a737c",
      roughness: 0.55,
      metalness: 0.2,
      emissive: "#2a2c30",
      emissiveIntensity: 1,
    }),
    window: new THREE.MeshBasicMaterial({ color: "#2a3a48" }),
    doorWood: new THREE.MeshStandardMaterial({
      color: "#6a4228",
      roughness: 0.7,
      map: woodTexture(),
    }),
    // depth-only, drawn over whatever is there: opens a doorway / roof hole in a host we can't cut
    punch: new THREE.MeshBasicMaterial({ colorWrite: false, depthFunc: THREE.AlwaysDepth }),
  };
}

function InteriorMeshes({ g, m }: { g: Interior; m: Mats }) {
  return (
    <>
      <mesh geometry={g.base} material={m.base} />
      <mesh geometry={g.steel} material={m.steel} />
      <mesh geometry={g.wood} material={m.wood} />
      <mesh geometry={g.conc} material={m.conc} />
      <mesh geometry={g.glow} material={m.iglow} />
      <mesh geometry={g.sign} material={m.isign} />
    </>
  );
}

/** a sliding panel: box geometry positioned in the building's local frame */
function Panel({
  refFn,
  a0,
  a1,
  y0,
  y1,
  d0,
  d1,
  mat,
  window: win,
}: {
  refFn: (o: THREE.Object3D | null) => void;
  a0: number;
  a1: number;
  y0: number;
  y1: number;
  d0: number;
  d1: number;
  mat: THREE.Material;
  window?: THREE.Material;
}) {
  const w = a1 - a0;
  const h = y1 - y0;
  const d = d1 - d0;
  return (
    <group ref={refFn} position={[(a0 + a1) / 2, (y0 + y1) / 2, (d0 + d1) / 2]}>
      <mesh material={mat}>
        <boxGeometry args={[w, h, d]} />
      </mesh>
      {win && (
        <>
          <mesh material={win} position={[0, h * 0.18, d / 2 + 0.004]}>
            <planeGeometry args={[Math.min(0.3, w * 0.4), 0.42]} />
          </mesh>
          <mesh material={win} position={[0, h * 0.18, -d / 2 - 0.004]} rotation-y={Math.PI}>
            <planeGeometry args={[Math.min(0.3, w * 0.4), 0.42]} />
          </mesh>
        </>
      )}
    </group>
  );
}

/** the core's roof opening as a local-frame quad facing up (the hole punch) */
function holeGeo(b: AccessBuilding) {
  const E = b.elev;
  const S = b.stair;
  const r = E
    ? { a0: E.shaft.a0, a1: E.shaft.a1, d0: E.direct ? E.shaft.d0 : E.vest.d0, d1: E.shaft.d1 }
    : S
      ? { a0: -S.W / 2, a1: S.W / 2, d0: S.v0, d1: S.v0 + S.Ls + S.Lr + S.Ln }
      : { a0: 0, a1: 0, d0: 0, d1: 0 };
  const g = new THREE.PlaneGeometry(r.a1 - r.a0, r.d1 - r.d0);
  g.rotateX(-Math.PI / 2);
  g.translate((r.a0 + r.a1) / 2, 0, (r.d0 + r.d1) / 2);
  return g;
}

type Refs = {
  hole?: THREE.Object3D | null;
  /** door leaves at the street and on the roof (hidden far away: small, and one draw each) */
  doors: THREE.Group | null;
  low: THREE.Group | null;
  high: THREE.Group | null;
  car: THREE.Group | null;
  street: (THREE.Object3D | null)[];
  roof: THREE.Object3D | null;
  landing: (THREE.Object3D | null)[][]; // [level][left, right]
  carDoor: (THREE.Object3D | null)[];
};

function Building({
  b,
  m,
  g,
  refs,
  display,
  cop,
}: {
  b: AccessBuilding;
  m: Mats;
  g: ReturnType<typeof buildAccess>["per"][number];
  refs: Refs;
  display: Display | null;
  cop: CopPanel | null;
}) {
  const elev = b.kind === "elevator";
  const q0 = b.portals[0];
  const q1 = b.portals[1];
  const hh = doorHeight(b);
  const gy = b.groundY + 0.17;
  const E = b.elev;
  const dispMat = useMemo(
    () => (display ? new THREE.MeshBasicMaterial({ map: display.tex, toneMapped: false }) : null),
    [display],
  );
  const copMat = useMemo(() => (cop ? new THREE.MeshBasicMaterial({ map: cop.tex }) : null), [cop]);
  useEffect(() => () => dispMat?.dispose(), [dispMat]);
  useEffect(() => () => copMat?.dispose(), [copMat]);
  const disp = (s: DisplaySpot, i: number) =>
    dispMat && (
      <mesh
        key={i}
        material={s.level === 3 && copMat ? copMat : dispMat}
        position={[s.a, s.y, s.d]}
        rotation-y={s.face > 0 ? 0 : Math.PI}
      >
        <planeGeometry args={[s.w, s.h]} />
      </mesh>
    );
  const punch = !!b.spec.punch;
  const wood = b.spec.doorStyle === "wood";
  // punch hosts: everything behind the doorway draws first (renderOrder -2), then the punch
  // (-1) opens the doorway in the depth buffer, then the host's wall (0) fails behind it
  const root = useRef<THREE.Group>(null);
  useEffect(() => {
    if (!punch) return;
    root.current?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.renderOrder === 0) o.renderOrder = -2;
    });
  });
  const hw = q0.half + 0.15;
  const holeL = b.hole;
  const holeG = useMemo(() => holeGeo(b), [b]);
  useEffect(() => () => holeG.dispose(), [holeG]);
  const capY = (b.spec.capY ?? b.spec.roofY) + 0.012;
  return (
    <group position={[b.ox, 0, b.oz]} rotation-y={g.theta} ref={root}>
      <group ref={(o) => (refs.doors = o)}>
        {/* street door leaves: glass for the city lobby, wood / steel where the host can't be cut */}
        {b.ladder ? null : elev && !punch ? (
          <>
            <Panel
              refFn={(o) => (refs.street[0] = o)}
              a0={-q0.half}
              a1={0}
              y0={gy}
              y1={b.groundY + hh - 0.02}
              d0={0.09}
              d1={0.13}
              mat={m.glass}
            />
            <Panel
              refFn={(o) => (refs.street[1] = o)}
              a0={0}
              a1={q0.half}
              y0={gy}
              y1={b.groundY + hh - 0.02}
              d0={0.14}
              d1={0.18}
              mat={m.glass}
            />
          </>
        ) : elev ? (
          <>
            <Panel
              refFn={(o) => (refs.street[0] = o)}
              a0={-q0.half}
              a1={0}
              y0={gy}
              y1={b.groundY + hh - 0.02}
              d0={0.09}
              d1={0.13}
              mat={wood ? m.doorWood : m.doorPaint}
              window={m.window}
            />
            <Panel
              refFn={(o) => (refs.street[1] = o)}
              a0={0}
              a1={q0.half}
              y0={gy}
              y1={b.groundY + hh - 0.02}
              d0={0.14}
              d1={0.18}
              mat={wood ? m.doorWood : m.doorPaint}
              window={m.window}
            />
          </>
        ) : (
          <Panel
            refFn={(o) => (refs.street[0] = o)}
            a0={-q0.half}
            a1={q0.half}
            y0={gy}
            y1={b.groundY + hh - 0.02}
            d0={0.1}
            d1={0.15}
            mat={wood ? m.doorWood : m.doorPaint}
            window={m.window}
          />
        )}
        {/* roof door leaf (an open doorway in lookout rooms and on ladders has none) */}
        {q1.open ? null : q1.nd !== 0 ? (
          <Panel
            refFn={(o) => (refs.roof = o)}
            a0={q1.a - q1.half}
            a1={q1.a + q1.half}
            y0={b.top + 0.03}
            y1={b.top + 2.23}
            d0={q1.d + 0.07}
            d1={q1.d + 0.12}
            mat={m.doorPaint}
            window={m.window}
          />
        ) : (
          <group ref={(o) => (refs.roof = o)}>
            <Panel
              refFn={() => {}}
              a0={q1.a - 0.13}
              a1={q1.a - 0.08}
              y0={b.top + 0.03}
              y1={b.top + 2.23}
              d0={q1.d - q1.half}
              d1={q1.d + q1.half}
              mat={m.doorPaint}
            />
          </group>
        )}
      </group>
      <group ref={(o) => (refs.low = o)} visible={false}>
        <InteriorMeshes g={g.low} m={m} />
        {E && (
          <>
            <Panel
              refFn={(o) => (refs.landing[0]![0] = o)}
              a0={-0.7}
              a1={0}
              y0={gy}
              y1={gy + 2.3}
              d0={E.coreFront + 0.012}
              d1={E.coreFront + 0.04}
              mat={m.innerSteel}
            />
            <Panel
              refFn={(o) => (refs.landing[0]![1] = o)}
              a0={-0.008}
              a1={0.7}
              y0={gy}
              y1={gy + 2.3}
              d0={E.coreFront + 0.018}
              d1={E.coreFront + 0.046}
              mat={m.innerSteel}
            />
          </>
        )}
        {g.displays.filter((s) => s.level === 0).map(disp)}
        {punch && !b.ladder && (
          <mesh
            material={m.punch}
            renderOrder={-1}
            position={[0, b.groundY + hh / 2, -0.012 - (b.spec.plinth ?? 0)]}
            rotation-y={Math.PI}
          >
            <planeGeometry args={[hw * 2, hh]} />
          </mesh>
        )}
      </group>
      {g.high && (
        <group ref={(o) => (refs.high = o)} visible={false}>
          <InteriorMeshes g={g.high} m={m} />
          {E && (
            <>
              <Panel
                refFn={(o) => (refs.landing[1]![0] = o)}
                a0={-0.7}
                a1={0}
                y0={b.top + 0.03}
                y1={b.top + 2.33}
                d0={E.coreFront + 0.012}
                d1={E.coreFront + 0.04}
                mat={m.innerSteel}
              />
              <Panel
                refFn={(o) => (refs.landing[1]![1] = o)}
                a0={-0.008}
                a1={0.7}
                y0={b.top + 0.03}
                y1={b.top + 2.33}
                d0={E.coreFront + 0.018}
                d1={E.coreFront + 0.046}
                mat={m.innerSteel}
              />
            </>
          )}
          {g.displays.filter((s) => s.level === 1).map(disp)}
        </group>
      )}
      {/* punch hosts: the roof cap over the shaft / stairwell, opened while you're inside */}
      {punch && !b.room && holeL.x1 > holeL.x0 && (
        <mesh
          ref={(o) => (refs.hole = o)}
          material={m.punch}
          renderOrder={-1}
          visible={false}
          position={[0, capY, 0]}
          geometry={holeG}
        />
      )}
      {g.car && E && (
        <group ref={(o) => (refs.car = o)} visible={false}>
          <InteriorMeshes g={g.car} m={m} />
          <Panel
            refFn={(o) => (refs.carDoor[0] = o)}
            a0={-0.7}
            a1={0}
            y0={0.03}
            y1={2.25}
            d0={E.car.d0 - 0.045}
            d1={E.car.d0 - 0.012}
            mat={m.innerSteel}
          />
          <Panel
            refFn={(o) => (refs.carDoor[1] = o)}
            a0={-0.008}
            a1={0.7}
            y0={0.03}
            y1={2.25}
            d0={E.car.d0 - 0.051}
            d1={E.car.d0 - 0.018}
            mat={m.innerSteel}
          />
          {/* the car's outside shell (seen only if something looks down the shaft) */}
          <mesh material={m.frameDark} position={[0, CAR_H + 0.08, (E.car.d0 + E.car.d1) / 2]}>
            <boxGeometry args={[E.car.a1 - E.car.a0 + 0.1, 0.12, E.car.d1 - E.car.d0 + 0.1]} />
          </mesh>
          {g.displays.filter((s) => s.level >= 2).map(disp)}
        </group>
      )}
    </group>
  );
}

// ---- sound: a chime on arrival, a hum and wind while riding, a door slide ----
class ElevatorSound {
  private hum: {
    osc: OscillatorNode;
    osc2: OscillatorNode;
    noise: AudioBufferSourceNode;
    g: GainNode;
    ng: GainNode;
    f: BiquadFilterNode;
  } | null = null;
  chime() {
    const bus = sfxBus();
    if (!bus) return;
    const { ctx, out } = bus;
    const t0 = ctx.currentTime + 0.01;
    for (const [f, dt] of [
      [1318.5, 0],
      [1046.5, 0.32],
    ] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.32, t0 + dt + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 1.3);
      o.connect(g).connect(out);
      o.start(t0 + dt);
      o.stop(t0 + dt + 1.4);
    }
  }
  slide() {
    const bus = sfxBus();
    if (!bus) return;
    const { ctx, out } = bus;
    const t0 = ctx.currentTime + 0.01;
    const n = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    n.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 420;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.0);
    n.connect(f).connect(g).connect(out);
    n.start(t0);
    n.stop(t0 + 1.05);
  }
  /** k: 0 silent .. 1 full express */
  ride(k: number) {
    const bus = sfxBus();
    if (!bus) return;
    const { ctx, out } = bus;
    if (!this.hum && k > 0.001) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = 52;
      const osc2 = ctx.createOscillator();
      osc2.type = "sine";
      osc2.frequency.value = 104;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 220;
      const g = ctx.createGain();
      g.gain.value = 0;
      const noise = ctx.createBufferSource();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noise.buffer = buf;
      noise.loop = true;
      const nf = ctx.createBiquadFilter();
      nf.type = "bandpass";
      nf.frequency.value = 700;
      nf.Q.value = 0.6;
      const ng = ctx.createGain();
      ng.gain.value = 0;
      osc.connect(f);
      osc2.connect(f);
      f.connect(g).connect(out);
      noise.connect(nf).connect(ng).connect(out);
      osc.start();
      osc2.start();
      noise.start();
      this.hum = { osc, osc2, noise, g, ng, f };
    }
    const h = this.hum;
    if (!h) return;
    const now = ctx.currentTime;
    h.g.gain.setTargetAtTime(k > 0.001 ? 0.08 + 0.05 * k : 0, now, 0.25);
    h.ng.gain.setTargetAtTime(0.1 * k * k, now, 0.3);
    h.osc.frequency.setTargetAtTime(48 + 18 * k, now, 0.4);
    h.f.frequency.setTargetAtTime(180 + 260 * k, now, 0.4);
    if (k <= 0.001 && h.g.gain.value < 0.002) {
      h.osc.stop();
      h.osc2.stop();
      h.noise.stop();
      this.hum = null;
    }
  }
}

export const AccessScene = memo(function AccessScene({
  time,
  cityKey,
}: {
  time: TimeOfDay;
  cityKey: unknown;
}) {
  const list = useMemo(() => accessList(), [cityKey]); // eslint-disable-line react-hooks/exhaustive-deps -- the installed list changes with the city
  const built = useMemo(() => buildAccess(list), [list]);
  useLayoutEffect(() => registerStaticGeometry("access-exterior", [built.ext]), [built]);
  useLayoutEffect(() => {
    const instances: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[] = [];
    built.per.forEach((g, i) => {
      const b = list[i]!;
      // Enclosed upper rooms have real floors, walls and window headers, not an outdoor roof.
      if (!b.room || !g.high) return;
      const matrix = new THREE.Matrix4().makeRotationY(g.theta).setPosition(b.ox, 0, b.oz);
      for (const key of ["base", "steel", "wood", "conc"] as const)
        instances.push({ geometry: g.high[key], matrix });
    });
    return registerStaticInstances("access-rooms", instances);
  }, [built, list]);
  const mats = useMemo(makeMats, []);
  const displays = useMemo(() => list.map((b) => (b.elev ? new Display() : null)), [list]);
  const cops = useMemo(() => list.map((b) => (b.elev ? new CopPanel() : null)), [list]);
  const scene = useThree((s) => s.scene);
  const refs = useMemo<Refs[]>(
    () =>
      list.map(() => ({
        doors: null,
        low: null,
        high: null,
        car: null,
        street: [null, null],
        roof: null,
        landing: [
          [null, null],
          [null, null],
        ],
        carDoor: [null, null],
      })),
    [list],
  );
  const beaconGeo = useMemo(() => new THREE.SphereGeometry(0.4, 6, 4), []);
  const beaconRef = useRef<THREE.InstancedMesh>(null);
  const sound = useMemo(() => new ElevatorSound(), []);
  const seen = useRef<{ dep: number; arr: number; phase: number }[]>([]);
  useEffect(() => {
    seen.current = list.map(() => ({ dep: 0, arr: 0, phase: IDLE }));
  }, [list]);

  useEffect(() => {
    const m = beaconRef.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    built.beacons.forEach((p, i) => m.setMatrixAt(i, mat.makeTranslation(p[0], p[1], p[2])));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [built]);

  useEffect(
    () => () => {
      built.ext.dispose();
      built.glow.dispose();
      built.sign.dispose();
      built.pools.dispose();
      for (const p of built.per)
        for (const g of [p.low, p.high, p.car])
          if (g) [g.base, g.glow, g.sign, g.steel, g.wood, g.conc].forEach((x) => x.dispose());
      for (const p of built.per) p.pre?.dispose();
    },
    [built],
  );
  useEffect(() => () => displays.forEach((d) => d?.dispose()), [displays]);
  useEffect(() => () => cops.forEach((d) => d?.dispose()), [cops]);
  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose());
      beaconGeo.dispose();
      sound.ride(0);
      setIndoor(0);
    },
    [mats, beaconGeo, sound],
  );

  const cityRoot = useRef<THREE.Object3D | null>(null);
  const preRefs = useRef<(THREE.Mesh | null)[]>([]);
  const terraceRefs = useRef<(THREE.Mesh | null)[]>([]);
  // high on a roof the city is hundreds of metres below: stretch the view distance and the
  // haze with height so the skyline and the streets still read (back to normal at street level)
  const view = useRef({ far: 0, near: 0, fogFar: 0, k: 0 });
  const BEACON = useMemo(() => new THREE.Color("#ff2a1a"), []);
  useFrame((state) => {
    const cam = state.camera.position;
    // inside, the city is heard through the walls: the ambience goes muffled (ambience.ts).
    // A sealed car is the most enclosed; open doors (car or street door) let the city in.
    if (player.zone === 1) {
      const c = player.inCar ? carOf(player.b) : undefined;
      setIndoor(c ? 1 - 0.35 * carOpen(c) : 0.75 - 0.3 * portalDoor(player.b, player.level));
    } else setIndoor(0);
    {
      const v = view.current;
      const pc = state.camera as THREE.PerspectiveCamera;
      const fog = scene.fog as THREE.Fog | null;
      const k = Math.max(0, Math.min(1, (cam.y - 30) / 350));
      if (k === 0 || v.far === 0) {
        v.far = pc.far;
        v.near = fog?.near ?? 0;
        v.fogFar = fog?.far ?? 0;
      }
      if (Math.abs(k - v.k) > 0.002 || (k === 0 && v.k !== 0)) {
        v.k = k;
        pc.far = v.far * (1 + 1.6 * k);
        pc.updateProjectionMatrix();
        if (fog) {
          fog.near = v.near + 250 * k;
          fog.far = v.fogFar * (1 + 1.5 * k);
        }
      }
    }
    // exterior lights follow the continuous time of day (tod.v: 0 golden hour .. 1 night);
    // the interiors are baked and don't depend on it at all
    const tv = tod.v;
    mats.glow.color.setScalar(1.1 + 0.25 * tv);
    mats.sign.color.setScalar(1.0 + 0.15 * tv);
    mats.pools.opacity = 0.4 + 0.45 * tv;
    // blackout: the interior nearest the player (the one you're in, else the closest) runs on
    // emergency power; the car keeps running on its battery with a dim red light
    let near = player.zone !== 0 ? player.b : -1;
    if (near < 0) {
      let bd = 60;
      list.forEach((b, k) => {
        const d = Math.hypot(b.ox - cam.x, b.oz - cam.z);
        if (d < bd) {
          bd = d;
          near = k;
        }
      });
    }
    const pw = near >= 0 ? powerAt(list[near]!.ox, list[near]!.oz) : 1;
    const flick = pw < 0.5 && Math.sin(state.clock.elapsedTime * 23) > 0.93 ? 0.8 : 1;
    _c.copy(EMERGENCY).lerp(WHITE, pw).multiplyScalar(flick);
    for (const m of [mats.base, mats.steel, mats.wood, mats.conc]) m.color.copy(_c);
    mats.innerSteel.color.copy(INNER_STEEL).multiply(_c);
    mats.iglow.color.setRGB(0.06 + 1.09 * pw, 0.02 + 1.13 * pw, 0.02 + 1.13 * pw);
    const emergency = pw < 0.5;
    const t = state.clock.elapsedTime;
    mats.beacon.color.setScalar(Math.sin(t * 3.2) > 0.2 ? 1 : 0.12).multiply(BEACON);
    let hideCity = false;
    let riding = 0;
    list.forEach((b, k) => {
      const r = refs[k]!;
      const mine = player.b === k && player.zone !== 0;
      const dx = Math.max(b.interior.x0 - cam.x, 0, cam.x - b.interior.x1);
      const dz = Math.max(b.interior.z0 - cam.z, 0, cam.z - b.interior.z1);
      const dh = Math.hypot(dx, dz);
      // the ground floor reads through the glass doors from across the street
      if (r.doors) r.doors.visible = mine || dh < 150;
      if (r.low)
        r.low.visible = (mine && player.zone === 1) || (dh < 130 && cam.y < b.groundY + 70);
      if (r.high) r.high.visible = mine || (dh < 45 && Math.abs(cam.y - b.top) < 30);
      if (r.hole) r.hole.visible = mine && player.zone === 1;
      const pre = preRefs.current[k];
      if (pre) pre.visible = !!r.low?.visible;
      const tp = terraceRefs.current[k];
      if (tp) tp.visible = !!r.high?.visible;
      // doors
      const sd = portalDoor(k, 0);
      if (b.elev) {
        if (r.street[0])
          r.street[0].position.x = -b.portals[0].half / 2 - sd * b.portals[0].half * 0.96;
        if (r.street[1])
          r.street[1].position.x = b.portals[0].half / 2 + sd * b.portals[0].half * 0.96;
      } else if (r.street[0]) r.street[0].position.x = sd * b.portals[0].half * 2;
      const rd = portalDoor(k, 1);
      const q1 = b.portals[1];
      if (r.roof) {
        if (q1.nd !== 0) r.roof.position.x = q1.a + rd * q1.half * 2;
        else r.roof.position.z = rd * q1.half * 2;
      }
      const c = carOf(k);
      if (!b.elev || !c) return;
      const y = carY(b, c);
      const open = carOpen(c);
      if (r.car) {
        // the lobby floor is drawn 0.17 m up (over the lot paving), the vestibule 0.03 m
        r.car.position.y = y + 0.14 * (1 - (y - b.groundY) / Math.max(1, b.top - b.groundY));
        r.car.visible =
          (r.low?.visible && c.level === 0 && c.phase !== MOVING) ||
          (r.high?.visible && c.level === 1 && c.phase !== MOVING) ||
          (mine && player.inCar) ||
          false;
        r.carDoor[0]?.position.setX(-0.35 - open * 0.69);
        r.carDoor[1]?.position.setX(0.346 + open * 0.69);
      }
      for (const L of [0, 1] as const) {
        const o = c.level === L && c.phase !== MOVING ? open : 0;
        r.landing[L]![0]?.position.setX(-0.35 - o * 0.69);
        r.landing[L]![1]?.position.setX(0.346 + o * 0.69);
      }
      const disp = displays[k];
      if (disp) {
        const dir = c.phase === MOVING ? (c.level > c.from ? 1 : -1) : 0;
        const cap = c.phase === MOVING ? "" : c.level ? (b.room ? "TOP" : "ROOF") : "LOBBY";
        disp.show(
          carFloor(b, c),
          dir,
          emergency && k === near ? (c.phase === MOVING ? "" : "BATTERY") : cap,
          emergency && k === near,
        );
      }
      cops[k]?.show(
        carFloor(b, c),
        b.elev.floors,
        c.phase === MOVING ? c.level : c.level ? 0 : 1,
        emergency && k === near,
      );
      // sounds for this client's own ride / landing
      const s = seen.current[k];
      if (s) {
        const near = mine || Math.hypot(cam.x - b.ox, cam.z - b.oz) < 14;
        if (c.arrivals !== s.arr) {
          s.arr = c.arrivals;
          if (near) sound.chime();
        }
        if (c.phase !== s.phase) {
          if ((c.phase === CLOSING || c.phase === OPENING) && near) sound.slide();
          s.phase = c.phase;
        }
      }
      if (mine && player.inCar) {
        if (c.phase === MOVING) {
          const v = Math.abs(carY(b, { ...c, t: c.t + 0.05 }) - y) / 0.05;
          riding = Math.min(1, v / 50);
          if (riding < 0.05) riding = 0.05;
        }
        if (c.phase === MOVING || (c.phase === CLOSING && open < 0.03)) hideCity = true;
      }
    });
    sound.ride(riding);
    if (!cityRoot.current || !cityRoot.current.parent)
      cityRoot.current = scene.getObjectByName("city-root") ?? null;
    if (cityRoot.current) cityRoot.current.visible = !hideCity;
  });

  if (list.length === 0) return null;
  return (
    <group>
      <mesh geometry={built.ext} material={mats.ext} castShadow receiveShadow />
      <mesh geometry={built.glow} material={mats.glow} />
      <mesh geometry={built.sign} material={mats.sign} />
      <mesh geometry={built.pools} material={mats.pools} renderOrder={2} />
      {built.beacons.length > 0 && (
        <instancedMesh ref={beaconRef} args={[beaconGeo, mats.beacon, built.beacons.length]} />
      )}
      {built.per.map((p, k) =>
        p.pre ? (
          <mesh
            key={`pre${k}`}
            ref={(o) => {
              preRefs.current[k] = o;
            }}
            geometry={p.pre}
            material={mats.ext}
            renderOrder={-2}
            visible={false}
          />
        ) : null,
      )}
      {list.map((b, k) => {
        // a room's terrace door: opened in the host's facade with a depth punch
        const tr = b.spec.terrace;
        if (!tr) return null;
        const alongX = tr.wall.x1 - tr.wall.x0 > tr.wall.z1 - tr.wall.z0;
        const tc = { x: (tr.rect.x0 + tr.rect.x1) / 2, z: (tr.rect.z0 + tr.rect.z1) / 2 };
        const wc = { x: (tr.wall.x0 + tr.wall.x1) / 2, z: (tr.wall.z0 + tr.wall.z1) / 2 };
        const sgn = alongX ? Math.sign(tc.z - wc.z) : Math.sign(tc.x - wc.x);
        const mid = (tr.door[0] + tr.door[1]) / 2;
        const w = tr.door[1] - tr.door[0];
        const x = alongX ? mid : wc.x + sgn * 0.02;
        const z = alongX ? wc.z + sgn * 0.02 : mid;
        const rot = alongX ? (sgn > 0 ? 0 : Math.PI) : sgn > 0 ? Math.PI / 2 : -Math.PI / 2;
        return (
          <mesh
            key={`tp${k}`}
            ref={(o) => {
              terraceRefs.current[k] = o;
            }}
            material={mats.punch}
            renderOrder={-1}
            position={[x, b.top + 0.03 + 1.075, z]}
            rotation-y={rot}
            visible={false}
          >
            <planeGeometry args={[w, 2.15]} />
          </mesh>
        );
      })}
      {list.map((b, k) => (
        <Building
          key={k}
          b={b}
          m={mats}
          g={built.per[k]!}
          refs={refs[k]!}
          display={displays[k] ?? null}
          cop={cops[k] ?? null}
        />
      ))}
    </group>
  );
});

export { IDLE, MOVING };
