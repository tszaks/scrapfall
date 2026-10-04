import { glyph, padLabel } from "./input/bindings";
import { vehicleEntry } from "./vehicleControls";
import { inputDevice } from "./input/gamepad";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { AlpineData } from "./alpine/layout";
import type { RemoteState } from "./net";
import { ski } from "./alpine/ski";
import { driving } from "./driving";
import { terrainY } from "./terrain";
import { actionLabel } from "./input/labels";
// Screen HUD: its visibility and position must not depend on the world origin.
const keepHudVisible = () => {};
const screenCenter = (
  _object: THREE.Object3D,
  _camera: THREE.Camera,
  size: { width: number; height: number },
) => [size.width / 2, size.height / 2];
export function TravelView({
  alpine,
  remotes,
}: {
  alpine: AlpineData | null;
  remotes: React.MutableRefObject<Map<string, RemoteState>>;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null),
    hint = useRef<HTMLDivElement>(null);
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
      : ski.hint || driving.hint;
    if (hint.current) {
      hint.current.style.display = text ? "block" : "none";
      const carHint =
        inputDevice.kind === "pad" && text === "INTERACT TO DRIVE"
          ? `HOLD ${actionLabel("use")} TO ENTER${vehicleEntry.progress > 0 ? ` · ${Math.round(vehicleEntry.progress * 100)}%` : ""}`
          : inputDevice.kind === "pad" && text.startsWith("DRIVING")
            ? `${glyph("RT", inputDevice.padType)} ACCELERATE · ${glyph("LT", inputDevice.padType)} BRAKE · ${padLabel("move", inputDevice.padType)} STEER · ${actionLabel("use")} EXIT`
            : text.replace("INTERACT", actionLabel("use"));
      hint.current.style.backgroundImage =
        vehicleEntry.progress > 0
          ? `linear-gradient(to right, #637449 0%, #637449 ${vehicleEntry.progress * 100}%, transparent ${vehicleEntry.progress * 100}%)`
          : "none";
      const label = carHint;
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
      <Html
        fullscreen
        calculatePosition={screenCenter}
        onOcclude={keepHudVisible}
        zIndexRange={[40, 40]}
        style={{ pointerEvents: "none" }}
      >
        <div
          ref={hint}
          data-testid="travel-hint"
          style={{
            position: "absolute",
            bottom: 125,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#171717dd",
            color: "white",
            padding: "8px 12px",
            borderRadius: 6,
            fontFamily: "monospace",
            maxWidth: "calc(100vw - 32px)",
            textAlign: "center",
          }}
        />
      </Html>
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
                    maxWidth: "calc(100vw - 32px)",
                    textAlign: "center",
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
