import { useEffect, useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { artMaterial } from "../art/kit";
import { registerStaticGeometry } from "../staticCollision";
import { buildNuketown } from "./build";
import { MatchRain } from "../MatchRain";

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
      <MatchRain key={seed} />
    </group>
  );
}
