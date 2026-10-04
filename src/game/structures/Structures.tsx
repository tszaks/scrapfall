import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { scannedSurface } from "../environment/scannedSurface";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Model, artMaterial, SURF } from "../art/kit";
import { structureList } from "./world";
import type { Volume } from "./plan";

/** Two static batches per map: detailed opaque rooms and their real glass panes. */
export function Structures({ seed, realism = true }: { seed: number; realism?: boolean }) {
  const built = useMemo(() => {
    const m = new Model(),
      g = new Model();
    const draw = (v: Volume) => {
      if (v.hidden) return;
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
        v.glow
          ? SURF.glow
          : [0.8, 0, realism ? 0.02 : 0.15, realism && h > 1.5 && Math.max(w, d) > 2 ? 1 : 0],
        {
          bevel:
            realism && !v.glass && h > 1.5 && Math.max(w, d) > 2
              ? Math.min(0.015, w * 0.05, d * 0.05)
              : 0,
        },
      );
    };
    for (const p of structureList()) {
      for (const v of p.solids) draw(v);
      for (const v of p.decor) draw(v);
      // Exterior service grilles break up blank wall bays. They sit on solid wall pieces,
      // never across an opening, and project only 4 cm beyond the physical wall.
      if (realism)
        for (const v of p.solids) {
          if (v.hidden || v.glass || v.glow || v.y1 - v.y0 < 3) continue;
          const alongX = v.x1 - v.x0 > v.z1 - v.z0;
          if (Math.max(v.x1 - v.x0, v.z1 - v.z0) < 6) continue;
          const edge = alongX
            ? Math.abs(v.z0 - p.bounds.z0) < 0.3
              ? v.z0 - 0.025
              : Math.abs(v.z1 - p.bounds.z1) < 0.3
                ? v.z1 + 0.025
                : null
            : Math.abs(v.x0 - p.bounds.x0) < 0.3
              ? v.x0 - 0.025
              : Math.abs(v.x1 - p.bounds.x1) < 0.3
                ? v.x1 + 0.025
                : null;
          if (edge === null) continue;
          const x = alongX ? (v.x0 + v.x1) / 2 : edge;
          const z = alongX ? edge : (v.z0 + v.z1) / 2;
          const y = v.y0 + 2.5;
          m.box(
            alongX ? 0.8 : 0.055,
            0.55,
            alongX ? 0.055 : 0.8,
            [x, y, z],
            "#343a3b",
            SURF.darkSteel,
            { bevel: 0.015 },
          );
          for (let i = 0; i < 5; i++)
            m.box(
              alongX ? 0.72 : 0.065,
              0.035,
              alongX ? 0.065 : 0.72,
              [x, y - 0.2 + i * 0.1, z],
              "#7b8382",
              SURF.steel,
            );
        }
      for (const rail of p.rails ?? []) {
        const a = new THREE.Vector3(...rail.a),
          b = new THREE.Vector3(...rail.b),
          dir = b.clone().sub(a);
        const e = new THREE.Euler().setFromQuaternion(
          new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            dir.clone().normalize(),
          ),
        );
        const mid = a.add(b).multiplyScalar(0.5);
        m.box(0.09, 0.09, dir.length(), [mid.x, mid.y, mid.z], rail.color, [0.35, 0.7, 0.1], {
          rot: [e.x, e.y, e.z],
          bevel: 0.012,
        });
      }
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
    const rawSolid = m.build();
    // Reuse identical corners in these static rooms instead of submitting them once
    // per triangle. Collision uses the room plan, so indexing cannot change walkability.
    const solid = realism ? mergeVertices(rawSolid) : rawSolid;
    if (realism) rawSolid.dispose();
    return {
      solid,
      glass: g.build(),
      mat: realism
        ? scannedSurface(
            artMaterial({ wear: 0.35 }),
            "concrete_floor_02",
            "vArtPos",
            "vSurf.w",
            3.0,
            0.45,
          )
        : artMaterial({ wear: 0.08 }),
      glassMat: new THREE.MeshStandardMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.13,
        roughness: 0.15,
        metalness: 0.15,
        depthWrite: false,
      }),
    };
  }, [seed, realism]);
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
