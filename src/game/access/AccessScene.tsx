// Draws the access buildings: the merged exterior (entrances, penthouses, rooftop props),
// and per building the interiors (lobby, vestibule, stairwell), the elevator car and every
// sliding door, animated from the shared car state. Interiors are only drawn near the
// player. While the local player rides a closed car the city is hidden (nothing outside the
// car can be seen, and the shaft passes through roof planes of lower building parts).
import { useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { sfxBus } from "../audio";
import { glowTexture } from "../cityTextures";
import type { TimeOfDay } from "../lighting";
import { buildAccess, STREET_DOOR_H, type DisplaySpot, type Interior } from "./build";
import { CAR_H, type AccessBuilding } from "./layout";
import { Display, signTexture, steelTexture } from "./textures";
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

const GLOW_K: Record<TimeOfDay, number> = { night: 1.35, sunset: 1.1 };

type Mats = ReturnType<typeof makeMats>;
function makeMats() {
  return {
    ext: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.05 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    sign: new THREE.MeshBasicMaterial({ vertexColors: true, map: signTexture(), toneMapped: false }),
    pools: new THREE.MeshBasicMaterial({
      vertexColors: true,
      map: glowTexture(),
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
    beacon: new THREE.MeshBasicMaterial({ color: "#ff2a1a", toneMapped: false }),
    // interiors: baked light in the vertex colours
    base: new THREE.MeshBasicMaterial({ vertexColors: true }),
    steel: new THREE.MeshBasicMaterial({ vertexColors: true, map: steelTexture() }),
    iglow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    isign: new THREE.MeshBasicMaterial({ vertexColors: true, map: signTexture(), toneMapped: false }),
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
    doorSteel: new THREE.MeshStandardMaterial({ color: "#b9bdc2", roughness: 0.35, metalness: 0.75, map: steelTexture() }),
    innerSteel: new THREE.MeshBasicMaterial({ color: "#8b9096", map: steelTexture() }),
    frameDark: new THREE.MeshStandardMaterial({ color: "#2b2d31", roughness: 0.6 }),
    doorPaint: new THREE.MeshStandardMaterial({ color: "#6a737c", roughness: 0.55, metalness: 0.2, emissive: "#2a2c30", emissiveIntensity: 1 }),
    window: new THREE.MeshBasicMaterial({ color: "#2a3a48" }),
  };
}

function InteriorMeshes({ g, m }: { g: Interior; m: Mats }) {
  return (
    <>
      <mesh geometry={g.base} material={m.base} />
      <mesh geometry={g.steel} material={m.steel} />
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

type Refs = {
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
}: {
  b: AccessBuilding;
  m: Mats;
  g: ReturnType<typeof buildAccess>["per"][number];
  refs: Refs;
  display: Display | null;
}) {
  const elev = b.kind === "elevator";
  const q0 = b.portals[0];
  const q1 = b.portals[1];
  const hh = elev ? STREET_DOOR_H.elevator : STREET_DOOR_H.stairs;
  const gy = b.groundY + 0.17;
  const E = b.elev;
  const dispMat = useMemo(
    () => (display ? new THREE.MeshBasicMaterial({ map: display.tex, toneMapped: false }) : null),
    [display],
  );
  useEffect(() => () => dispMat?.dispose(), [dispMat]);
  const disp = (s: DisplaySpot, i: number) =>
    dispMat && (
      <mesh
        key={i}
        material={dispMat}
        position={[s.a, s.y, s.d]}
        rotation-y={s.face > 0 ? 0 : Math.PI}
      >
        <planeGeometry args={[s.w, s.h]} />
      </mesh>
    );
  return (
    <group position={[b.ox, 0, b.oz]} rotation-y={g.theta}>
      {/* street door leaves: glass for the elevator lobby, steel for the stairwell */}
      {elev ? (
        <>
          <Panel refFn={(o) => (refs.street[0] = o)} a0={-q0.half} a1={0} y0={gy} y1={b.groundY + hh - 0.02} d0={0.09} d1={0.13} mat={m.glass} />
          <Panel refFn={(o) => (refs.street[1] = o)} a0={0} a1={q0.half} y0={gy} y1={b.groundY + hh - 0.02} d0={0.14} d1={0.18} mat={m.glass} />
        </>
      ) : (
        <Panel refFn={(o) => (refs.street[0] = o)} a0={-q0.half} a1={q0.half} y0={gy} y1={b.groundY + hh - 0.02} d0={0.1} d1={0.15} mat={m.doorPaint} window={m.window} />
      )}
      {/* roof door leaf */}
      {q1.nd !== 0 ? (
        <Panel refFn={(o) => (refs.roof = o)} a0={q1.a - q1.half} a1={q1.a + q1.half} y0={b.top + 0.03} y1={b.top + 2.23} d0={q1.d + 0.07} d1={q1.d + 0.12} mat={m.doorPaint} window={m.window} />
      ) : (
        <group ref={(o) => (refs.roof = o)}>
          <Panel refFn={() => {}} a0={q1.a - 0.13} a1={q1.a - 0.08} y0={b.top + 0.03} y1={b.top + 2.23} d0={q1.d - q1.half} d1={q1.d + q1.half} mat={m.doorPaint} />
        </group>
      )}
      <group ref={(o) => (refs.low = o)} visible={false}>
        <InteriorMeshes g={g.low} m={m} />
        {E && (
          <>
            <Panel refFn={(o) => (refs.landing[0]![0] = o)} a0={-0.7} a1={-0.006} y0={gy} y1={gy + 2.3} d0={E.coreFront + 0.02} d1={E.coreFront + 0.06} mat={m.innerSteel} />
            <Panel refFn={(o) => (refs.landing[0]![1] = o)} a0={0.006} a1={0.7} y0={gy} y1={gy + 2.3} d0={E.coreFront + 0.02} d1={E.coreFront + 0.06} mat={m.innerSteel} />
          </>
        )}
        {g.displays.filter((s) => s.level === 0).map(disp)}
      </group>
      {g.high && E && (
        <group ref={(o) => (refs.high = o)} visible={false}>
          <InteriorMeshes g={g.high} m={m} />
          <Panel refFn={(o) => (refs.landing[1]![0] = o)} a0={-0.7} a1={-0.006} y0={b.top + 0.03} y1={b.top + 2.33} d0={E.coreFront + 0.02} d1={E.coreFront + 0.06} mat={m.innerSteel} />
          <Panel refFn={(o) => (refs.landing[1]![1] = o)} a0={0.006} a1={0.7} y0={b.top + 0.03} y1={b.top + 2.33} d0={E.coreFront + 0.02} d1={E.coreFront + 0.06} mat={m.innerSteel} />
          {g.displays.filter((s) => s.level === 1).map(disp)}
        </group>
      )}
      {g.car && E && (
        <group ref={(o) => (refs.car = o)} visible={false}>
          <InteriorMeshes g={g.car} m={m} />
          <Panel refFn={(o) => (refs.carDoor[0] = o)} a0={-0.7} a1={-0.006} y0={0.03} y1={2.25} d0={E.car.d0 - 0.045} d1={E.car.d0 - 0.012} mat={m.innerSteel} />
          <Panel refFn={(o) => (refs.carDoor[1] = o)} a0={0.006} a1={0.7} y0={0.03} y1={2.25} d0={E.car.d0 - 0.045} d1={E.car.d0 - 0.012} mat={m.innerSteel} />
          {/* the car's outside shell (seen only if something looks down the shaft) */}
          <mesh material={m.frameDark} position={[0, CAR_H + 0.08, (E.car.d0 + E.car.d1) / 2]}>
            <boxGeometry args={[E.car.a1 - E.car.a0 + 0.1, 0.12, E.car.d1 - E.car.d0 + 0.1]} />
          </mesh>
          {g.displays.filter((s) => s.level === 2).map(disp)}
        </group>
      )}
    </group>
  );
}

// ---- sound: a chime on arrival, a hum and wind while riding, a door slide ----
class ElevatorSound {
  private hum: { osc: OscillatorNode; osc2: OscillatorNode; noise: AudioBufferSourceNode; g: GainNode; ng: GainNode; f: BiquadFilterNode } | null = null;
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

export const AccessScene = memo(function AccessScene({ time, cityKey }: { time: TimeOfDay; cityKey: unknown }) {
  const list = useMemo(() => accessList(), [cityKey]); // eslint-disable-line react-hooks/exhaustive-deps -- the installed list changes with the city
  const built = useMemo(() => buildAccess(list), [list]);
  const mats = useMemo(makeMats, []);
  const displays = useMemo(() => list.map((b) => (b.elev ? new Display() : null)), [list]);
  const { scene } = useThree();
  const refs = useMemo<Refs[]>(
    () =>
      list.map(() => ({
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
    const k = GLOW_K[time];
    mats.glow.color.setScalar(k);
    mats.iglow.color.setScalar(1.15);
    mats.sign.color.setScalar(time === "night" ? 1.15 : 1.0);
    mats.pools.opacity = time === "night" ? 0.85 : 0.4;
  }, [time, mats]);

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
          if (g) [g.base, g.glow, g.sign, g.steel].forEach((x) => x.dispose());
    },
    [built],
  );
  useEffect(() => () => displays.forEach((d) => d?.dispose()), [displays]);
  useEffect(() => () => {
    Object.values(mats).forEach((m) => m.dispose());
    beaconGeo.dispose();
    sound.ride(0);
  }, [mats, beaconGeo, sound]);

  const cityRoot = useRef<THREE.Object3D | null>(null);
  // high on a roof the city is hundreds of metres below: stretch the view distance and the
  // haze with height so the skyline and the streets still read (back to normal at street level)
  const view = useRef({ far: 0, near: 0, fogFar: 0, k: 0 });
  const BEACON = useMemo(() => new THREE.Color("#ff2a1a"), []);
  useFrame((state) => {
    const cam = state.camera.position;
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
      if (r.low) r.low.visible = (mine && player.zone === 1) || (dh < 130 && cam.y < b.groundY + 70);
      if (r.high) r.high.visible = mine || (dh < 45 && Math.abs(cam.y - b.top) < 30);
      // doors
      const sd = portalDoor(k, 0);
      if (b.elev) {
        if (r.street[0]) r.street[0].position.x = -b.portals[0].half / 2 - sd * b.portals[0].half * 0.96;
        if (r.street[1]) r.street[1].position.x = b.portals[0].half / 2 + sd * b.portals[0].half * 0.96;
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
        r.car.visible = (r.low?.visible && c.level === 0 && c.phase !== MOVING) || (r.high?.visible && c.level === 1 && c.phase !== MOVING) || (mine && player.inCar) || false;
        r.carDoor[0]?.position.setX(-0.353 - open * 0.69);
        r.carDoor[1]?.position.setX(0.353 + open * 0.69);
      }
      for (const L of [0, 1] as const) {
        const o = c.level === L && c.phase !== MOVING ? open : 0;
        r.landing[L]![0]?.position.setX(-0.353 - o * 0.69);
        r.landing[L]![1]?.position.setX(0.353 + o * 0.69);
      }
      const disp = displays[k];
      if (disp) {
        const dir = c.phase === MOVING ? (c.level > c.from ? 1 : -1) : 0;
        const cap = c.phase === MOVING ? "" : c.level ? "ROOF" : "LOBBY";
        disp.show(carFloor(b, c), dir, cap);
      }
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
    if (!cityRoot.current || !cityRoot.current.parent) cityRoot.current = scene.getObjectByName("city-root") ?? null;
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
      {list.map((b, k) => (
        <Building key={k} b={b} m={mats} g={built.per[k]!} refs={refs[k]!} display={displays[k] ?? null} />
      ))}
    </group>
  );
});

export { IDLE, MOVING };
