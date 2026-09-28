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
import { liveLook } from "../timeOfDay";
import { skyFog } from "../skyFog";
import type { TrafficLink } from "../trafficCore";
import type { WesternLayout } from "./layout";
import { WESTERN_LOOK } from "./look";
import { setAmbienceWeather } from "../ambience";
import { puffTexture, softGlow } from "./textures";
import { trainClock } from "./trainSim";
import { stormAt } from "./storm";
import { tumbleweedGeometry } from "./tumbleweed";

const MOTES = 700;
const DUST = 280;
const WEEDS = 16;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _q2 = new THREE.Quaternion();
const _axis = new THREE.Vector3();
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
  // a real tumbleweed: a loose ball of curling twigs (tumbleweed.ts), rolling on the ground
  const weedGeo = useMemo(() => tumbleweedGeometry(0.5, 70, 4, 11), []);
  const weedMat = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: true }), []);
  const weeds = useRef(
    Array.from({ length: WEEDS }, (_, i) => ({
      x: 0,
      z: 0,
      ph: i * 1.7,
      alive: false,
      s: 0.7 + (i % 4) * 0.15,
      q: new THREE.Quaternion(),
      hop: 0,
      vy: 0,
    })),
  );
  const wallGeo = useMemo(() => new THREE.SphereGeometry(900, 24, 12), []);
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
      [moteMat, dustMat, weedMat, wallMat].forEach((m) => m.dispose());
    },
    [motes, dustGeo, weedGeo, wallGeo, moteMat, dustMat, weedMat, wallMat],
  );

  const moteRef = useRef<THREE.Points>(null);
  const dustRef = useRef<THREE.InstancedMesh>(null);
  const weedRef = useRef<THREE.InstancedMesh>(null);
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
  useEffect(
    () => () => {
      setAmbienceWeather(0);
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
    // the storm's howl is the shared ambience's weather layer (on top of the boss-round storm)
    setAmbienceWeather(k);

    // ---- the haze closes in ----
    const fog = scene.fog as THREE.Fog | null;
    const b = base.current;
    if (fog) {
      // the clear-weather haze comes from the blended time-of-day look (timeOfDay.ts)
      b.fog = fog;
      b.near = liveLook.fogNear;
      b.far = liveLook.fogFar;
      b.color.copy(liveLook.fogColor);
      b.sunK = liveLook.hazeK;
    }
    if (fog) {
      // a dust storm is a depth haze, not a curtain: things 20 m off keep most of their
      // colour and contrast, the far buildings go soft, the mesas become silhouettes, and
      // nothing past ~160 m shows (readable, but you can't snipe across town)
      _c.set(look.storm);
      fog.near = b.near + (4 - b.near) * k;
      fog.far = b.far + (165 - b.far) * k;
      fog.color.copy(b.color).lerp(_c, k);
      skyFog.fogSunK.value = b.sunK * (1 - k * 0.6);
    }
    const wall = wallRef.current;
    if (wall) {
      // the sky dims to a dusty glow (the sun still shows through as a brighter smudge)
      wall.position.copy(cam);
      wallMat.opacity = Math.min(0.72, k * 0.8);
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
    if (wm) {
      const want = Math.round(2 + k * (WEEDS - 2));
      let n = 0;
      weeds.current.forEach((w, i) => {
        if (i >= want) {
          w.alive = false;
          return;
        }
        const speed = 1.6 + k * 8 + (i % 3) * 0.6;
        if (!w.alive || Math.hypot(w.x - cam.x, w.z - cam.z) > 70) {
          // enter upwind of the player
          const a = Math.atan2(st.wz, st.wx) + Math.PI + (Math.random() - 0.5) * 1.6;
          w.x = cam.x + Math.cos(a) * (40 + Math.random() * 20);
          w.z = cam.z + Math.sin(a) * (40 + Math.random() * 20);
          w.alive = true;
          w.hop = 0;
          w.vy = 0;
        }
        const dx = st.wx * speed * dt;
        const dz = st.wz * speed * dt;
        const nx = w.x + dx;
        const nz = w.z + dz;
        if (!blocked(blocks, nx, nz, 0.4)) {
          w.x = nx;
          w.z = nz;
        } else {
          w.alive = false; // snagged: respawn upwind
        }
        // it rolls: turns about the axis across its travel by distance / radius
        const r = 0.5 * w.s;
        const dist = Math.hypot(dx, dz);
        if (dist > 1e-5) {
          _axis.set(dz, 0, -dx).normalize();
          _q2.setFromAxisAngle(_axis, dist / r);
          w.q.premultiply(_q2);
        }
        // and bounces now and then when a gust or a stone kicks it up
        w.vy -= 9.8 * dt;
        w.hop += w.vy * dt;
        if (w.hop <= 0) {
          w.hop = 0;
          w.vy = Math.random() < (0.02 + k * 0.08) ? 1.2 + Math.random() * (1 + k * 2.5) : 0;
        }
        const gy = groundY(w.x, w.z);
        _m.compose(_p.set(w.x, gy + r * 0.92 + w.hop, w.z), w.q, _s.set(w.s, w.s, w.s));
        wm.setMatrixAt(n, _m);
        n++;
      });
      wm.count = n;
      wm.instanceMatrix.needsUpdate = true;
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
      <mesh ref={wallRef} geometry={wallGeo} material={wallMat} renderOrder={4} visible={false} />
    </group>
  );
}
