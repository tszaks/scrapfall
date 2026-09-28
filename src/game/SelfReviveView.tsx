import { useEffect, useRef, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { inputHeld } from "./input/remap";
import { KeyHint } from "./input/Glyph";
import { moveState } from "./input/movement";
import { touchInput } from "./touch";
import { staticSegment } from "./staticCollision";
import { playSfx } from "./audio";
import {
  soloRevive,
  subscribeSoloRevive,
  soloReviveVersion,
  notifySoloRevive,
  stepSoloRevive,
  takeSoloKit,
  SELF_REVIVE_SECONDS,
} from "./soloRevive";
export function useSoloRevive() {
  useSyncExternalStore(subscribeSoloRevive, soloReviveVersion, soloReviveVersion);
  return soloRevive;
}
export function SoloReviveDriver({
  active,
  hp,
  onRevive,
}: {
  active: boolean;
  hp: number;
  onRevive: () => void;
}) {
  const group = useRef<THREE.Group>(null),
    t = useRef(0);
  useFrame(({ camera, clock }, dt) => {
    const drop = soloRevive.drop;
    if (group.current) {
      group.current.visible = !!drop;
      if (drop) {
        group.current.position.set(
          drop.x,
          drop.y + 0.35 + Math.sin(clock.elapsedTime * 2) * 0.06,
          drop.z,
        );
        group.current.rotation.y = clock.elapsedTime * 0.5;
      }
    }
    if (!active) return;
    if (
      stepSoloRevive(Math.min(dt, 0.25), hp, inputHeld("revive") || touchInput.revive) === "revived"
    ) {
      playSfx("pickup");
      onRevive();
    }
    if (
      drop &&
      hp > 0 &&
      !soloRevive.kit &&
      Math.hypot(camera.position.x - drop.x, moveState.feet - drop.y, camera.position.z - drop.z) <
        1.3 &&
      !staticSegment(
        camera.position.x,
        moveState.feet + 0.8,
        camera.position.z,
        drop.x,
        drop.y + 0.35,
        drop.z,
      )
    ) {
      if (takeSoloKit()) playSfx("pickup");
    }
    t.current += dt;
    if (soloRevive.down && t.current > 0.08) {
      t.current = 0;
      notifySoloRevive();
    }
  });
  return (
    <group ref={group} visible={false}>
      <mesh castShadow>
        <boxGeometry args={[0.55, 0.34, 0.38]} />
        <meshStandardMaterial color="#f4e4bb" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0, 0.196]}>
        <boxGeometry args={[0.08, 0.23, 0.014]} />
        <meshStandardMaterial color="#cf4435" />
      </mesh>
      <mesh position={[0, 0, 0.197]}>
        <boxGeometry args={[0.25, 0.08, 0.014]} />
        <meshStandardMaterial color="#cf4435" />
      </mesh>
      <mesh position={[0, 0.23, 0]}>
        <torusGeometry args={[0.09, 0.02, 5, 12, Math.PI]} />
        <meshStandardMaterial color="#2b2118" />
      </mesh>
    </group>
  );
}
export function SoloRevivePrompt() {
  const s = useSoloRevive();
  useEffect(
    () => () => {
      touchInput.revive = false;
    },
    [],
  );
  return (
    <div className="pointer-events-auto fixed bottom-[25%] left-1/2 z-40 w-72 -translate-x-1/2 rounded-xl border border-[#f3e6cf]/60 bg-[#2b2118]/95 p-4 text-center font-mono text-[#f3e6cf]">
      <div className="text-sm font-bold tracking-widest">DOWN · SELF REVIVE</div>
      <p className="my-2 text-xs">One kit · {Math.ceil(s.bleed)}s remaining</p>
      <button
        className="w-full touch-none rounded border border-[#f3e6cf]/60 px-3 py-3 text-sm"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          touchInput.revive = true;
        }}
        onPointerUp={() => {
          touchInput.revive = false;
        }}
        onPointerCancel={() => {
          touchInput.revive = false;
        }}
        onLostPointerCapture={() => {
          touchInput.revive = false;
        }}
      >
        HOLD <KeyHint action="revive" /> · REVIVE
      </button>
      <div
        role="progressbar"
        aria-label="Self revive"
        aria-valuenow={Math.round((s.progress / SELF_REVIVE_SECONDS) * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-3 h-1.5 overflow-hidden rounded bg-white/20"
      >
        <div
          className="h-full bg-[#f3e6cf]"
          style={{ width: `${Math.min(100, (s.progress / SELF_REVIVE_SECONDS) * 100)}%` }}
        />
      </div>
    </div>
  );
}
