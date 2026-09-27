// Dry Gulch's air: gold dust motes drifting in the low sun (or pale ones in the moonlight),
// the odd tumbleweed, and the map's hazard - DUST STORMS. When a storm rolls in (on a
// shared schedule, see weather.ts) the haze closes to ~25 m in a brown-orange wall, dust
// streams past, tumbleweeds bound through town and the wind shoves you east.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { blocked, type Block } from "../level";
import { groundY, wind } from "../terrain";
import type { TimeOfDay } from "../lighting";
import { skyFog } from "../skyFog";
import type { TrafficLink } from "../trafficCore";
import type { WesternLayout } from "./layout";
import { WESTERN_LOOK } from "./look";
import { stormVoice } from "./sound";
import { puffTexture, softGlow } from "./textures";
import { trainClock } from "./trainSim";
import { stormAt } from "./storm";

const MOTES = 700;
const DUST = 280;
const WEEDS = 16;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

function dustMaterial() {
  const mat = new THREE.MeshBasicMaterial({
    map: puffTexture(),
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float aAlpha;\nvarying float vAlpha;",
      )
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvAlpha = aAlpha;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vAlpha;")
      .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.a *= vAlpha;");
  };
  mat.customProgramCacheKey = () => "western-dust-v1";
  return mat;
}

export function WesternWeather({
  layout,
  time,
  blocks,
  link,
}: {
  layout: WesternLayout;
  time: TimeOfDay;
  blocks: Block[];
  link: React.MutableRefObject<TrafficLink>;
}) {
  const { scene, camera } = useThree();
  const look = WESTERN_LOOK[time];

  // ---- motes: a box of tiny glowing specks that travels with the camera ----
  const motes = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(MOTES * 3);
    for (let i = 0; i < MOTES; i++) {
      p[i * 3] = (Math.random() - 0.5) * 60;
      p[i * 3 + 1] = Math.random() * 9;
      p[i * 3 + 2] = (Math.random() - 0.5) * 60;
    }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    return g;
  }, []);
  const moteMat = useMemo(
    () =>
      new THREE.PointsMaterial({
        size: 0.09,
        map: softGlow(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
        opacity: 0.7,
      }),
    [],
  );
  useEffect(() => {
    moteMat.color.set(look.motes);
    moteMat.opacity = time === "sunset" ? 0.85 : 0.14;
  }, [moteMat, look, time]);

  // ---- storm dust sprites, tumbleweeds, the wall of dust ----
  const dustGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.setAttribute("aAlpha", new THREE.InstancedBufferAttribute(new Float32Array(DUST), 1));
    return g;
  }, []);
  const dustMat = useMemo(dustMaterial, []);
  const dust = useRef(
    Array.from({ length: DUST }, () => ({
      x: (Math.random() - 0.5) * 70,
      y: Math.random() * 7,
      z: (Math.random() - 0.5) * 70,
      s: 1.1 + Math.random() * 2.2,
      a: Math.random(),
    })),
  );
  const weedGeo = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(0.5, 1);
    return g;
  }, []);
  const weedMat = useMemo(
    () => new THREE.MeshLambertMaterial({ color: "#a08452", wireframe: true }),
    [],
  );
  const weedCore = useMemo(
    () => new THREE.MeshLambertMaterial({ color: "#8a7046", transparent: true, opacity: 0.55 }),
    [],
  );
  const weeds = useRef(
    Array.from({ length: WEEDS }, (_, i) => ({
      x: 0,
      z: 0,
      ph: i * 1.7,
      alive: false,
      s: 0.7 + (i % 4) * 0.15,
    })),
  );
  const wallGeo = useMemo(() => new THREE.SphereGeometry(44, 24, 12), []);
  const wallMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#b8763e",
        side: THREE.BackSide,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      [motes, dustGeo, weedGeo, wallGeo].forEach((g) => g.dispose());
      [moteMat, dustMat, weedMat, weedCore, wallMat].forEach((m) => m.dispose());
    },
    [motes, dustGeo, weedGeo, wallGeo, moteMat, dustMat, weedMat, weedCore, wallMat],
  );

  const moteRef = useRef<THREE.Points>(null);
  const dustRef = useRef<THREE.InstancedMesh>(null);
  const weedRef = useRef<THREE.InstancedMesh>(null);
  const coreRef = useRef<THREE.InstancedMesh>(null);
  const wallRef = useRef<THREE.Mesh>(null);
  // the fog we tint during a storm (captured afresh whenever the game swaps its fog)
  const base = useRef<{
    fog: THREE.Fog | null;
    near: number;
    far: number;
    color: THREE.Color;
    sunK: number;
  }>({
    fog: null,
    near: 0,
    far: 0,
    color: new THREE.Color(),
    sunK: 0,
  });
  const voice = useRef<ReturnType<typeof stormVoice>>(null);
  useEffect(
    () => () => {
      voice.current?.stop();
      voice.current = null;
      const b = base.current;
      if (b.fog) {
        b.fog.near = b.near;
        b.fog.far = b.far;
        b.fog.color.copy(b.color);
        skyFog.fogSunK.value = b.sunK;
      }
    },
    [],
  );
  useEffect(() => {
    wallMat.color.set(look.storm);
  }, [wallMat, look]);

  useFrame((state, raw) => {
    const dt = Math.min(raw, 0.05);
    const t = trainClock.t;
    const cam = camera.position;
    const st = stormAt(t);
    const k = st.k;
    const et = state.clock.elapsedTime;
    if (!voice.current) voice.current = stormVoice();
    voice.current?.update(k, et);

    // ---- the haze closes in ----
    const fog = scene.fog as THREE.Fog | null;
    const b = base.current;
    if (fog && fog !== b.fog) {
      b.fog = fog;
      b.near = fog.near;
      b.far = fog.far;
      b.color.copy(fog.color);
      b.sunK = skyFog.fogSunK.value;
    }
    if (fog) {
      _c.set(look.storm);
      fog.near = b.near + (2 - b.near) * k;
      fog.far = b.far + (42 - b.far) * k;
      fog.color.copy(b.color).lerp(_c, k);
      skyFog.fogSunK.value = b.sunK * (1 - k * 0.85);
    }
    const wall = wallRef.current;
    if (wall) {
      wall.position.copy(cam);
      wallMat.opacity = Math.min(0.97, k * 1.1);
      wall.visible = k > 0.01;
    }

    // ---- motes drift on the evening air; they thin out in the storm (the dust takes over) ----
    const mp = moteRef.current;
    if (mp) {
      mp.position.set(Math.round(cam.x / 60) * 60, 0, Math.round(cam.z / 60) * 60);
      const pos = motes.getAttribute("position") as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < MOTES; i++) {
        const o = i * 3;
        arr[o] = arr[o]! + (Math.sin(et * 0.3 + i) * 0.15 + 0.12 + st.wx * k * 9) * dt;
        arr[o + 1] = arr[o + 1]! + Math.sin(et * 0.5 + i * 1.3) * 0.05 * dt;
        arr[o + 2] = arr[o + 2]! + (Math.cos(et * 0.27 + i) * 0.15 + st.wz * k * 9) * dt;
        // wrap round the camera
        const wx = arr[o]! + mp.position.x - cam.x;
        const wz = arr[o + 2]! + mp.position.z - cam.z;
        if (wx > 30) arr[o] = arr[o]! - 60;
        if (wx < -30) arr[o] = arr[o]! + 60;
        if (wz > 30) arr[o + 2] = arr[o + 2]! - 60;
        if (wz < -30) arr[o + 2] = arr[o + 2]! + 60;
      }
      pos.needsUpdate = true;
      moteMat.size = 0.09 + k * 0.05;
    }

    // ---- storm dust streaming past ----
    const dm = dustRef.current;
    if (dm) {
      dm.visible = k > 0.01;
      if (dm.visible) {
        const alpha = dustGeo.getAttribute("aAlpha") as THREE.InstancedBufferAttribute;
        dustMat.color.set(look.storm).multiplyScalar(time === "night" ? 1.2 : 1.1);
        for (let i = 0; i < DUST; i++) {
          const d = dust.current[i]!;
          d.x += st.wx * 16 * dt;
          d.z += st.wz * 16 * dt;
          d.y += Math.sin(et + i) * 0.4 * dt;
          const rx = d.x - cam.x;
          const rz = d.z - cam.z;
          if (rx > 35) d.x -= 70;
          if (rx < -35) d.x += 70;
          if (rz > 35) d.z -= 70;
          if (rz < -35) d.z += 70;
          // soft, fist-to-person sized wisps, never right in the player's face (or over the gun)
          const near = Math.hypot(d.x - cam.x, d.z - cam.z);
          const fade = Math.min(1, Math.max(0, (near - 2.5) / 3));
          _m.compose(_p.set(d.x, groundY(d.x, d.z) + d.y * 0.5 + 0.4, d.z), camera.quaternion, _s.set(d.s, d.s, d.s));
          dm.setMatrixAt(i, _m);
          alpha.setX(i, (0.28 + 0.2 * d.a) * k * fade);
        }
        dm.instanceMatrix.needsUpdate = true;
        alpha.needsUpdate = true;
      }
    }

    // ---- tumbleweeds: a lazy one now and then, a stampede in the storm ----
    const wm = weedRef.current;
    const cm = coreRef.current;
    if (wm && cm) {
      const want = Math.round(2 + k * (WEEDS - 2));
      let n = 0;
      weeds.current.forEach((w, i) => {
        if (i >= want) {
          w.alive = false;
          return;
        }
        const speed = 2.2 + k * 9 + (i % 3);
        if (!w.alive || Math.hypot(w.x - cam.x, w.z - cam.z) > 70) {
          // enter upwind of the player
          const a = Math.atan2(st.wz, st.wx) + Math.PI + (Math.random() - 0.5) * 1.6;
          w.x = cam.x + Math.cos(a) * (40 + Math.random() * 20);
          w.z = cam.z + Math.sin(a) * (40 + Math.random() * 20);
          w.alive = true;
        }
        const nx = w.x + st.wx * speed * dt;
        const nz = w.z + st.wz * speed * dt;
        if (!blocked(blocks, nx, nz, 0.4)) {
          w.x = nx;
          w.z = nz;
        } else {
          w.alive = false; // snagged: respawn upwind
        }
        w.ph += dt * speed * 1.4;
        const hop = Math.abs(Math.sin(w.ph * 0.5)) * (0.4 + k * 1.1);
        _q.setFromEuler(_e.set(w.ph, 0, w.ph * 0.4));
        const gy = groundY(w.x, w.z);
        _m.compose(_p.set(w.x, gy + 0.45 * w.s + hop, w.z), _q, _s.set(w.s, w.s, w.s));
        wm.setMatrixAt(n, _m);
        _m.compose(_p.set(w.x, gy + 0.45 * w.s + hop, w.z), _q, _s.set(w.s * 0.8, w.s * 0.8, w.s * 0.8));
        cm.setMatrixAt(n, _m);
        n++;
      });
      wm.count = n;
      cm.count = n;
      wm.instanceMatrix.needsUpdate = true;
      cm.instanceMatrix.needsUpdate = true;
    }

    // ---- the wind shoves you downwind (the game applies it, with collision) ----
    const L = link.current;
    const push = L.active && k > 0.2 ? 1.5 * k : 0;
    wind.x = st.wx * push;
    wind.z = st.wz * push;
    void layout;
  });

  return (
    <group>
      <points ref={moteRef} geometry={motes} material={moteMat} frustumCulled={false} />
      <instancedMesh
        ref={dustRef}
        args={[dustGeo, dustMat, DUST]}
        frustumCulled={false}
        renderOrder={5}
        visible={false}
      />
      <instancedMesh
        ref={weedRef}
        args={[weedGeo, weedMat, WEEDS]}
        frustumCulled={false}
        castShadow
      />
      <instancedMesh ref={coreRef} args={[weedGeo, weedCore, WEEDS]} frustumCulled={false} />
      <mesh ref={wallRef} geometry={wallGeo} material={wallMat} renderOrder={4} visible={false} />
    </group>
  );
}
