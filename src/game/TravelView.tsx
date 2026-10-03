import { supply } from "./weaponSupply";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { AlpineData } from "./alpine/layout";
import type { RemoteState } from "./net";
import { ski } from "./alpine/ski";
import { driving } from "./driving";
import { terrainY } from "./terrain";
import { actionLabel } from "./input/labels";
export function TravelView({
  alpine,
  remotes,
}: {
  alpine: AlpineData | null;
  remotes: React.MutableRefObject<Map<string, RemoteState>>;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null),
    hint = useRef<HTMLDivElement>(null);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    // This label is updated by the frame loop, so it needs no nested React root.
    // Drei Html synchronously unmounts that root during scene changes.
    const label = document.createElement("div");
    Object.assign(label.style, {
      position: "absolute",
      bottom: "125px",
      left: "50%",
      transform: "translateX(-50%)",
      background: "#171717dd",
      color: "white",
      padding: "8px 12px",
      borderRadius: "6px",
      fontFamily: "monospace",
      whiteSpace: "nowrap",
      pointerEvents: "none",
      display: "none",
    });
    gl.domElement.parentElement?.appendChild(label);
    hint.current = label;
    return () => {
      hint.current = null;
      label.remove();
    };
  }, [gl]);
  const scratch = useMemo(
    () => ({
      m: new THREE.Matrix4(),
      p: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      e: new THREE.Euler(),
      s: new THREE.Vector3(0.13, 0.06, 1.9),
    }),
    [],
  );
  useFrame(() => {
    const text = ski.active
      ? "SKIING · BACK TO BRAKE"
      : ski.hint || driving.hint || supply.text.replace("RELOAD", actionLabel("reload"));
    if (hint.current) {
      hint.current.style.display = text ? "block" : "none";
      const label = text.replace("INTERACT", actionLabel("use"));
      if (hint.current.textContent !== label) hint.current.textContent = label;
    }
    const m = mesh.current;
    if (!m) return;
    let i = 0;
    const place = (x: number, y: number, z: number, yaw: number) => {
      for (const side of [-0.23, 0.23]) {
        scratch.p.set(x + Math.cos(yaw) * side, y + 0.1, z - Math.sin(yaw) * side);
        scratch.e.set(0, yaw, 0);
        scratch.q.setFromEuler(scratch.e);
        scratch.m.compose(scratch.p, scratch.q, scratch.s);
        m.setMatrixAt(i++, scratch.m);
      }
    };
    if (ski.active) place(ski.x, ski.y, ski.z, ski.yaw);
    remotes.current.forEach((r) => {
      if (r.ski && i < 8) place(r.x, r.sy ?? terrainY(r.x, r.z), r.z, Math.PI + r.yaw);
    });
    m.count = i;
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh ref={mesh} args={[undefined, undefined, 8]} frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial color="#de633d" roughness={0.35} />
      </instancedMesh>
      {alpine?.paths
        .filter((p) => p.kind === "piste" && (p.name === "blue" || p.name === "red"))
        .map((p) => {
          const [x, z] = p.pts[0]!;
          return (
            <group key={p.name ?? "run"} position={[x, terrainY(x, z), z]}>
              <mesh position={[-2, 1.3, 0]}>
                <cylinderGeometry args={[0.07, 0.07, 2.6, 6]} />
                <meshStandardMaterial color="#333" />
              </mesh>
              <Html position={[-2, 2.8, 0]} center distanceFactor={18}>
                <div
                  style={{
                    background: "#fff",
                    color: "#171717",
                    border: "2px solid #333",
                    padding: 8,
                    whiteSpace: "nowrap",
                    fontFamily: "monospace",
                  }}
                >
                  SKI {p.name?.toUpperCase()} · {actionLabel("use")}
                </div>
              </Html>
            </group>
          );
        })}
    </>
  );
}
