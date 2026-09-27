import { useEffect, useMemo } from "react";

import { fxCreate, fxMount, fxUnmount } from "./projectiles";

/** mounts every pooled combat-effect mesh (one draw call each, hidden when empty); render once inside the World */
export function CombatFx() {
  const objs = useMemo(() => fxCreate(), []);
  useEffect(() => {
    fxMount(objs);
    return () => fxUnmount();
  }, [objs]);
  return (
    <>
      <primitive object={objs.decals.mesh} />
      <primitive object={objs.alpha.mesh} />
      <primitive object={objs.add.mesh} />
      <primitive object={objs.rings.mesh} />
      <primitive object={objs.stuckPool.mesh} />
      <primitive object={objs.casing.mesh} />
      {Object.values(objs.ghosts).map((p, i) => p && <primitive key={i} object={p.mesh} />)}
    </>
  );
}
