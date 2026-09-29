// The preview's dev tooling tags every JSX element with `data-tsd-source`. React Three Fiber
// reads that dash as a nested path (obj.data["tsd-source"]) and throws on re-render when
// `data` is missing — which crashed the preview whenever the map changed in a co-op room.
// Give three's base classes an inert `data` bag so the tag has somewhere harmless to land.
import * as THREE from "three";

const bag = {};
for (const C of [THREE.Object3D, THREE.Material, THREE.BufferGeometry, THREE.Fog, THREE.Color, THREE.Texture] as unknown as { prototype: Record<string, unknown> }[]) {
  if (!("data" in C.prototype)) C.prototype["data"] = bag;
}
