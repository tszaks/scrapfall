import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { artMaterial } from "../art/kit";
import { registerStaticGeometry } from "../staticCollision";
import { buildNuketown } from "./build";
import { nukeLive } from "./layout";
import { MatchRain } from "../MatchRain";

/** a small canvas-textured quad that repaints when the watched value changes */
function useDial(
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  deps: () => number,
  cw = 512,
  ch = 128,
) {
  const tex = useMemo(() => {
    const cv = document.createElement("canvas");
    cv.width = cw;
    cv.height = ch;
    const t = new THREE.CanvasTexture(cv);
    t.anisotropy = 4;
    return t;
  }, [cw, ch]);
  const last = useRef(-1);
  useFrame(() => {
    const v = deps();
    if (v === last.current) return;
    last.current = v;
    const g = (tex.image as HTMLCanvasElement).getContext("2d")!;
    draw(g, cw, ch);
    tex.needsUpdate = true;
  });
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

/** the town sign's living population: players + living enemies, repainted on change */
function PopSign() {
  const tex = useDial(
    (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.font = "bold 92px 'Courier New', monospace";
      g.textBaseline = "middle";
      g.fillStyle = "#c8b45e";
      g.fillText(`POP. ${nukeLive.pop}`, 6, h / 2 + 4);
    },
    () => nukeLive.pop,
  );
  return (
    <mesh position={[25.42, 1.55, -4.8]} rotation={[0, -Math.PI / 2, 0]}>
      <planeGeometry args={[2.9, 0.5]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} />
    </mesh>
  );
}

/** civic clock on the backdrop tower over the yellow yard — the dial is the wave number */
function ClockDial() {
  const tex = useDial(
    (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.beginPath();
      g.arc(w / 2, h / 2, 116, 0, Math.PI * 2);
      g.fillStyle = "#efe8d4";
      g.fill();
      g.lineWidth = 10;
      g.strokeStyle = "#3f3a2e";
      g.stroke();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.beginPath();
        g.moveTo(w / 2 + Math.cos(a) * 92, h / 2 + Math.sin(a) * 92);
        g.lineTo(w / 2 + Math.cos(a) * 106, h / 2 + Math.sin(a) * 106);
        g.stroke();
      }
      // the "hand" is the wave counter — one numeral at the dial's centre
      g.fillStyle = "#3f3a2e";
      g.font = "bold 88px 'Courier New', monospace";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(nukeLive.wave > 0 ? `${nukeLive.wave}` : "–", w / 2, h / 2 + 4);
    },
    () => nukeLive.wave,
    256,
    256,
  );
  return (
    <mesh position={[14, 11.6, 39.88]} rotation={[0, Math.PI, 0]}>
      <planeGeometry args={[2.4, 2.4]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} />
    </mesh>
  );
}

/**
 * The map's skin: terrain, fences, vehicles, mannequins and the desert backdrop,
 * merged into three draw calls. Walls/floors/fence panels are the structure batch
 * (layout.ts) so the picture and the collision never drift apart; the solid bag
 * here carries BVH collision for everything it draws.
 */
export function Nuketown({ seed }: { seed: number }) {
  const built = useMemo(buildNuketown, []),
    mat = useMemo(() => artMaterial({ wear: 0.13, scale: 2.3 }), []),
    glassMat = useMemo(
      () =>
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.28,
          roughness: 0.12,
          metalness: 0.2,
          depthWrite: false,
        }),
      [],
    );
  useLayoutEffect(() => registerStaticGeometry("map", [built.solid]), [built]);
  useEffect(
    () => () => {
      Object.values(built).forEach((g) => g.dispose());
      mat.dispose();
      glassMat.dispose();
    },
    [built, mat, glassMat],
  );
  return (
    <group name="nuketown">
      <mesh geometry={built.solid} material={mat} castShadow receiveShadow />
      <mesh geometry={built.detail} material={mat} />
      <mesh geometry={built.glass} material={glassMat} />
      <PopSign />
      <ClockDial />
      <MatchRain key={seed} />
    </group>
  );
}
