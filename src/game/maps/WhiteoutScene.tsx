// Whiteout Pass visuals: snow ground, frozen lake, chalets, chapel, lift stations, a moving
// chairlift, instanced snowy spruce and boulders, mountains beyond the walls and falling snow.
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { Ground } from "../art/MapDressing";
import { farSpruceGeo, spruceGeo } from "./spruce";
import { WHITEOUT_SIZE, type Chalet, type WhiteoutLayout } from "./whiteout";
import type { Theme } from "../themes";
import { radarFeed } from "../Minimap";

const HALF = WHITEOUT_SIZE / 2;

function useInstances(ref: React.RefObject<THREE.InstancedMesh | null>, items: { x: number; y?: number; z: number; s: number; sy?: number; ry: number }[]) {
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    items.forEach((it, i) => {
      o.position.set(it.x, it.y ?? 0, it.z);
      o.rotation.set(0, it.ry, 0);
      o.scale.set(it.s, it.s * (it.sy ?? 1), it.s);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [ref, items]);
}

const SPRUCE = spruceGeo();
const FAR_SPRUCE = farSpruceGeo();
const ROCK = new THREE.DodecahedronGeometry(1, 0).scale(1, 0.75, 1);
const MOUNTAIN = new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0);
const CAP = new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0);

function Building({ c }: { c: Chalet }) {
  // long side along x when rot 0
  const w = c.rot ? c.d : c.w;
  const d = c.rot ? c.w : c.d;
  const roofH = c.kind === "chapel" ? 2.4 : 1.6;
  const win = "#ffd58a";
  return (
    <group position={[c.x, 0, c.z]} rotation-y={c.rot ? Math.PI / 2 : 0}>
      {/* stone plinth */}
      <mesh position-y={0.35} castShadow receiveShadow>
        <boxGeometry args={[w + 0.1, 0.7, d + 0.1]} />
        <meshLambertMaterial color="#8a8e94" flatShading />
      </mesh>
      <mesh position-y={0.7 + (c.h - 0.7) / 2} castShadow receiveShadow>
        <boxGeometry args={[w - 0.1, c.h - 0.7, d - 0.1]} />
        <meshLambertMaterial color={c.wood} flatShading />
      </mesh>
      {/* pitched roof: a triangular prism with overhang + snow on top */}
      <mesh position-y={c.h + roofH / 2 - 0.05} rotation-z={Math.PI / 2} rotation-y={Math.PI / 2} scale={[roofH, w + 0.8, (d + 1) / 1.5]} castShadow>
        <cylinderGeometry args={[0.577, 0.577, 1, 3]} />
        <meshLambertMaterial color={c.roof} flatShading />
      </mesh>
      <mesh position-y={c.h + roofH / 2 + 0.12} rotation-z={Math.PI / 2} rotation-y={Math.PI / 2} scale={[roofH * 0.92, w + 0.9, (d + 0.9) / 1.5]}>
        <cylinderGeometry args={[0.577, 0.577, 1, 3]} />
        <meshLambertMaterial color="#f6f9fc" flatShading />
      </mesh>
      {/* glowing windows on both long sides */}
      {Array.from({ length: Math.max(1, Math.floor(w / 2)) }, (_, i) => {
        const x = -w / 2 + 1 + i * 2;
        return [1, -1].map((s) => (
          <mesh key={`${i}${s}`} position={[x, c.h * 0.55 + 0.3, (s * d) / 2]}>
            <boxGeometry args={[0.7, 0.8, 0.08]} />
            <meshBasicMaterial color={win} />
          </mesh>
        ));
      })}
      {/* door + balcony rail on the front */}
      <mesh position={[w / 2, 1.3, 0]}>
        <boxGeometry args={[0.08, 1.6, 0.9]} />
        <meshLambertMaterial color="#3a2618" />
      </mesh>
      {c.kind === "chapel" ? (
        <group position={[-w / 2 + 1, 0, 0]}>
          <mesh position-y={c.h + 2.2} castShadow>
            <boxGeometry args={[1.4, 4, 1.4]} />
            <meshLambertMaterial color={c.wood} flatShading />
          </mesh>
          <mesh position-y={c.h + 5.4} castShadow>
            <coneGeometry args={[1.05, 2.6, 4]} />
            <meshLambertMaterial color={c.roof} flatShading />
          </mesh>
          <mesh position={[0.72, c.h + 3.2, 0]}>
            <circleGeometry args={[0.35, 12]} />
            <meshBasicMaterial color="#ffd58a" side={THREE.DoubleSide} />
          </mesh>
        </group>
      ) : (
        <mesh position={[-w / 4, c.h + roofH * 0.7, d / 5]} castShadow>
          <boxGeometry args={[0.45, 1.3, 0.45]} />
          <meshLambertMaterial color="#6a5a50" flatShading />
        </mesh>
      )}
      {c.kind === "station" && (
        <mesh position={[0, c.h + roofH + 0.4, 0]}>
          <boxGeometry args={[w * 0.7, 0.5, 0.1]} />
          <meshBasicMaterial color="#c8302a" />
        </mesh>
      )}
    </group>
  );
}

function Chairlift({ lift }: { lift: WhiteoutLayout["lift"] }) {
  const chairs = useRef<THREE.Group>(null);
  const len = lift.z0 - lift.z1;
  const N = 10;
  const CABLE_Y = 6.4;
  useFrame((st) => {
    const g = chairs.current;
    if (!g) return;
    const t = st.clock.elapsedTime * 1.6;
    g.children.forEach((ch, i) => {
      const k = ((t + (i / N) * len * 2) % (len * 2));
      const up = k < len;
      const z = up ? lift.z0 - k : lift.z1 + (k - len);
      ch.position.set(lift.x + (up ? -0.7 : 0.7), CABLE_Y, z);
    });
  });
  return (
    <group>
      {lift.towers.map((z) => (
        <group key={z} position={[lift.x, 0, z]}>
          <mesh position-y={3.3} castShadow>
            <cylinderGeometry args={[0.22, 0.32, 6.6, 8]} />
            <meshLambertMaterial color="#9aa4ae" flatShading />
          </mesh>
          <mesh position-y={6.6}>
            <boxGeometry args={[2.2, 0.2, 0.3]} />
            <meshLambertMaterial color="#c8302a" />
          </mesh>
        </group>
      ))}
      {[-0.7, 0.7].map((x) => (
        <mesh key={x} position={[lift.x + x, 6.6, (lift.z0 + lift.z1) / 2]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.03, 0.03, len, 4]} />
          <meshBasicMaterial color="#2a2a2e" />
        </mesh>
      ))}
      <group ref={chairs}>
        {Array.from({ length: N * 2 }, (_, i) => (
          <group key={i}>
            <mesh position-y={-0.6}>
              <boxGeometry args={[0.04, 1.2, 0.04]} />
              <meshBasicMaterial color="#2a2a2e" />
            </mesh>
            <mesh position-y={-1.25}>
              <boxGeometry args={[1.1, 0.12, 0.5]} />
              <meshLambertMaterial color="#c8302a" />
            </mesh>
            <mesh position={[0, -0.95, -0.22]}>
              <boxGeometry args={[1.1, 0.5, 0.08]} />
              <meshLambertMaterial color="#c8302a" />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

function Snowfall() {
  const ref = useRef<THREE.Points>(null);
  const COUNT = 1400;
  const R = 26;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      p[i * 3] = (Math.random() - 0.5) * R * 2;
      p[i * 3 + 1] = Math.random() * 14;
      p[i * 3 + 2] = (Math.random() - 0.5) * R * 2;
    }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    return g;
  }, []);
  useFrame((st, raw) => {
    const dt = Math.min(raw, 0.05);
    const pts = ref.current;
    if (!pts) return;
    const cam = st.camera.position;
    pts.position.set(cam.x, 0, cam.z);
    const a = geo.getAttribute("position") as THREE.BufferAttribute;
    const arr = a.array as Float32Array;
    const t = st.clock.elapsedTime;
    for (let i = 0; i < COUNT; i++) {
      arr[i * 3 + 1]! -= dt * (1.4 + (i % 5) * 0.25);
      arr[i * 3]! += dt * (1.2 + Math.sin(t + i) * 0.6); // wind from the west
      if (arr[i * 3 + 1]! < 0) arr[i * 3 + 1] = 14;
      if (arr[i * 3]! > R) arr[i * 3] = -R;
    }
    a.needsUpdate = true;
    // radar feed: where the local player stands and looks
    const e = new THREE.Euler().setFromQuaternion(st.camera.quaternion, "YXZ");
    radarFeed.x = cam.x;
    radarFeed.z = cam.z;
    radarFeed.yaw = e.y;
  });
  return (
    <points ref={ref} geometry={geo} frustumCulled={false}>
      <pointsMaterial color="#ffffff" size={0.09} transparent opacity={0.85} depthWrite={false} />
    </points>
  );
}

export const WhiteoutScene = memo(function WhiteoutScene({ layout, theme }: { layout: WhiteoutLayout; theme: Theme }) {
  const near = useRef<THREE.InstancedMesh>(null);
  const rocks = useRef<THREE.InstancedMesh>(null);
  const far = useRef<THREE.InstancedMesh>(null);
  const mts = useRef<THREE.InstancedMesh>(null);
  const caps = useRef<THREE.InstancedMesh>(null);

  const ring = useMemo(() => {
    const trees: { x: number; z: number; s: number; ry: number }[] = [];
    const m: { x: number; z: number; s: number; sy: number; ry: number }[] = [];
    const c: { x: number; y: number; z: number; s: number; sy: number; ry: number }[] = [];
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 140; i++) {
      const a = rnd() * Math.PI * 2;
      const d = HALF + 3 + rnd() * 12;
      const k = 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
      trees.push({ x: Math.cos(a) * Math.min(d * k, d * 1.4), z: Math.sin(a) * Math.min(d * k, d * 1.4), s: 6 + rnd() * 5, ry: rnd() * 6 });
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rnd() * 0.2;
      const d = HALF + 28 + rnd() * 20;
      const w = 16 + rnd() * 14;
      const h = 22 + rnd() * 26;
      const x = Math.cos(a) * d, z = Math.sin(a) * d, ry = rnd() * 6;
      m.push({ x, z, s: w, sy: h / w, ry });
      // snow cap: the top 40% of the same cone
      c.push({ x, y: h * 0.6 - 0.05, z, s: w * 0.41, sy: (h * 0.41) / (w * 0.41), ry });
    }
    return { trees, m, c };
  }, []);

  useInstances(near, layout.spruce);
  useInstances(rocks, layout.rocks);
  useInstances(far, ring.trees);
  useInstances(mts, ring.m);
  useInstances(caps, ring.c);

  const walls = [
    [0, -HALF, WHITEOUT_SIZE, 1.4],
    [0, HALF, WHITEOUT_SIZE, 1.4],
    [-HALF, 0, 1.4, WHITEOUT_SIZE],
    [HALF, 0, 1.4, WHITEOUT_SIZE],
  ] as const;

  return (
    <group>
      <Ground theme={theme} size={WHITEOUT_SIZE} />
      <mesh rotation-x={-Math.PI / 2} position-y={-0.03}>
        <planeGeometry args={[400, 400]} />
        <meshLambertMaterial color="#e6edf3" />
      </mesh>
      {/* frozen lake with a pale rim of packed snow */}
      <mesh rotation-x={-Math.PI / 2} position={[layout.lake.x, 0.015, layout.lake.z]}>
        <circleGeometry args={[layout.lake.r + 1, 40]} />
        <meshLambertMaterial color="#f8fbfd" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[layout.lake.x, 0.03, layout.lake.z]}>
        <circleGeometry args={[layout.lake.r, 40]} />
        <meshStandardMaterial color="#9ec6dc" roughness={0.12} metalness={0.2} />
      </mesh>
      {/* the main street and south lane: trodden snow */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 6]}>
        <planeGeometry args={[WHITEOUT_SIZE - 4, 4.5]} />
        <meshLambertMaterial color="#cfd7de" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.021, 0]}>
        <circleGeometry args={[8.5, 32]} />
        <meshLambertMaterial color="#c9d0d6" />
      </mesh>
      {[[-6, -6], [6, -6], [-6, 6], [6, 6]].map(([x, z]) => (
        <group key={`${x}${z}`} position={[x!, 0, z!]}>
          <mesh position-y={1.5}>
            <cylinderGeometry args={[0.06, 0.09, 3, 6]} />
            <meshLambertMaterial color="#2a2a2e" />
          </mesh>
          <mesh position-y={3.05}>
            <sphereGeometry args={[0.2, 8, 6]} />
            <meshBasicMaterial color="#ffd58a" />
          </mesh>
        </group>
      ))}
      {layout.chalets.map((c, i) => (
        <Building key={i} c={c} />
      ))}
      <Chairlift lift={layout.lift} />
      <instancedMesh ref={near} args={[SPRUCE, undefined, layout.spruce.length]} castShadow>
        <meshLambertMaterial vertexColors flatShading />
      </instancedMesh>
      <instancedMesh ref={rocks} args={[ROCK, undefined, layout.rocks.length]} castShadow receiveShadow>
        <meshLambertMaterial color="#7d8792" flatShading />
      </instancedMesh>
      <instancedMesh ref={far} args={[FAR_SPRUCE, undefined, ring.trees.length]}>
        <meshLambertMaterial vertexColors flatShading />
      </instancedMesh>
      <instancedMesh ref={mts} args={[MOUNTAIN, undefined, ring.m.length]}>
        <meshLambertMaterial color="#7d8a99" flatShading fog={false} />
      </instancedMesh>
      <instancedMesh ref={caps} args={[CAP, undefined, ring.c.length]}>
        <meshLambertMaterial color="#f4f8fb" flatShading fog={false} />
      </instancedMesh>
      {/* snowbank walls with a timber fence on top */}
      {walls.map(([x, z, w, d], i) => (
        <group key={i}>
          <mesh position={[x, 1.1, z]}>
            <boxGeometry args={[w, 2.2, d]} />
            <meshLambertMaterial color="#f2f6f9" flatShading />
          </mesh>
          <mesh position={[x, 2.6, z]}>
            <boxGeometry args={[w === 1.4 ? 0.2 : w, 0.18, d === 1.4 ? 0.2 : d]} />
            <meshLambertMaterial color="#5e3a22" />
          </mesh>
        </group>
      ))}
      <Snowfall />
    </group>
  );
});
