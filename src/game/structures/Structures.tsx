import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Model, artMaterial, SURF } from "../art/kit";
import { structureList } from "./world";
import type { Volume } from "./plan";

/** Two static batches per map: detailed opaque rooms and their real glass panes. */
export function Structures({ seed }: { seed: number }) {
  const built = useMemo(() => {
    const m = new Model(),
      g = new Model();
    const draw = (v: Volume) => {
      const w = v.x1 - v.x0,
        h = v.y1 - v.y0,
        d = v.z1 - v.z0;
      if (w <= 0 || h <= 0 || d <= 0) return;
      (v.glass ? g : m).box(
        w,
        h,
        d,
        [(v.x0 + v.x1) / 2, (v.y0 + v.y1) / 2, (v.z0 + v.z1) / 2],
        v.color,
        v.glow ? SURF.glow : [0.8, 0, 0.15],
        { bevel: 0 },
      );
    };
    for (const p of structureList()) {
      for (const v of p.solids) draw(v);
      for (const v of p.decor) draw(v);
      for (const s of p.stairs) {
        const n = Math.ceil((s.y1 - s.y0) / 0.18);
        for (let i = 0; i < n; i++) {
          const f = s.reverse ? n - 1 - i : i;
          const r = { x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1 };
          if (s.axis === "x") {
            r.x0 = s.x0 + ((s.x1 - s.x0) * f) / n;
            r.x1 = s.x0 + ((s.x1 - s.x0) * (f + 1)) / n;
          } else {
            r.z0 = s.z0 + ((s.z1 - s.z0) * f) / n;
            r.z1 = s.z0 + ((s.z1 - s.z0) * (f + 1)) / n;
          }
          const top = s.y0 + ((s.y1 - s.y0) * (i + 1)) / n;
          draw({ ...r, y0: top - 0.25, y1: top, color: "#aa9272" });
        }
      }
    }
    return {
      solid: m.build(),
      glass: g.build(),
      mat: artMaterial({ wear: 0.08 }),
      glassMat: new THREE.MeshStandardMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.13,
        roughness: 0.15,
        metalness: 0.15,
        depthWrite: false,
      }),
    };
  }, [seed]);
  useEffect(
    () => () => {
      built.solid.dispose();
      built.glass.dispose();
      built.mat.dispose();
      built.glassMat.dispose();
    },
    [built],
  );
  return (
    <group name="usable-structures">
      <mesh geometry={built.solid} material={built.mat} castShadow receiveShadow />
      <mesh geometry={built.glass} material={built.glassMat} />
    </group>
  );
}
