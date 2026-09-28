import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { tumbleweedGeometry } from "./tumbleweed";
import {
  weedWorld,
  weedPose,
  weedPiecePose,
  WEED_COUNT,
  PIECES_PER_WEED,
  setWeedFragmentVertices,
} from "./tumbleweedSim";

/** Actual twig clusters from the intact mesh, retained in world space after breakup. */
export function Tumbleweeds() {
  const whole = useRef<THREE.InstancedMesh>(null),
    pieces = useRef<(THREE.InstancedMesh | null)[]>([]);
  const res = useMemo(() => {
    const geometry = tumbleweedGeometry(0.5, 70, 4, 11),
      p = geometry.getAttribute("position"),
      n = geometry.getAttribute("normal"),
      c = geometry.getAttribute("color");
    const bins = Array.from({ length: PIECES_PER_WEED }, () => ({
      p: [] as number[],
      n: [] as number[],
      c: [] as number[],
    }));
    for (let i = 0; i < p.count; i += 3) {
      const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3,
        y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3,
        z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
      const k = (x > 0 ? 1 : 0) | (y > 0 ? 2 : 0) | (z > 0 ? 4 : 0),
        b = bins[k]!;
      for (let j = i; j < i + 3; j++) {
        b.p.push(
          p.getX(j) - (k & 1 ? 0.18 : -0.18),
          p.getY(j) - (k & 2 ? 0.18 : -0.18),
          p.getZ(j) - (k & 4 ? 0.18 : -0.18),
        );
        b.n.push(n.getX(j), n.getY(j), n.getZ(j));
        b.c.push(c.getX(j), c.getY(j), c.getZ(j));
      }
    }
    setWeedFragmentVertices(bins.map((b) => b.p));
    const fragments = bins.map((b) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(b.n, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(b.c, 3));
      return g;
    });
    return {
      geometry,
      fragments,
      material: new THREE.MeshLambertMaterial({ vertexColors: true }),
      matrix: new THREE.Matrix4(),
      q: new THREE.Quaternion(),
      v: new THREE.Vector3(),
      s: new THREE.Vector3(),
      e: new THREE.Euler(),
    };
  }, []);
  useEffect(
    () => () => {
      res.geometry.dispose();
      res.fragments.forEach((g) => g.dispose());
      res.material.dispose();
    },
    [res],
  );
  useFrame(() => {
    const mesh = whole.current;
    if (!mesh) return;
    let count = 0;
    const counts = new Uint8Array(PIECES_PER_WEED);
    for (const w of weedWorld.weeds) {
      if (!w.broken) {
        const p = weedPose(w);
        res.q.setFromEuler(res.e.set(p.roll * 0.3, 0, -p.roll));
        res.matrix.compose(res.v.set(p.x, p.y + 0.5 * w.s, p.z), res.q, res.s.setScalar(w.s));
        mesh.setMatrixAt(count++, res.matrix);
      } else
        w.pieces.forEach((_, k) => {
          const p = weedPiecePose(w, k);
          res.q.setFromEuler(res.e.set(p.rx, w.id * 0.7, p.rz));
          res.matrix.compose(res.v.set(p.x, p.y, p.z), res.q, res.s.setScalar(w.s));
          pieces.current[k]?.setMatrixAt(counts[k]!, res.matrix);
          counts[k] = (counts[k] ?? 0) + 1;
        });
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    for (let k = 0; k < PIECES_PER_WEED; k++) {
      const m = pieces.current[k];
      if (m) {
        m.count = counts[k]!;
        m.instanceMatrix.needsUpdate = true;
      }
    }
  });
  return (
    <group name="interactive-tumbleweeds">
      <instancedMesh
        ref={whole}
        args={[res.geometry, res.material, WEED_COUNT]}
        frustumCulled={false}
        castShadow
      />
      {res.fragments.map((g, k) => (
        <instancedMesh
          key={k}
          ref={(m) => {
            pieces.current[k] = m;
          }}
          args={[g, res.material, WEED_COUNT]}
          frustumCulled={false}
          castShadow
        />
      ))}
    </group>
  );
}
