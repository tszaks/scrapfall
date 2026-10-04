import * as THREE from "three";

let floorMap: THREE.CanvasTexture | undefined;
function floorTexture() {
  if (floorMap) return floorMap;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const g = canvas.getContext("2d")!;
  let seed = 761;
  const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  g.fillStyle = "#c9c7c2";
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 26000; i++) {
    const value = 95 + Math.floor(random() * 130);
    g.fillStyle = `rgba(${value},${value},${value},0.22)`;
    g.fillRect(random() * 512, random() * 512, 0.5 + random(), 0.5 + random());
  }
  for (let i = 0; i < 25; i++) {
    const x = random() * 512,
      y = random() * 512,
      r = 12 + random() * 55;
    const gradient = g.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, "rgba(77,72,61,0.06)");
    gradient.addColorStop(1, "rgba(77,72,61,0)");
    g.fillStyle = gradient;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  floorMap = new THREE.CanvasTexture(canvas);
  floorMap.colorSpace = THREE.SRGBColorSpace;
  floorMap.wrapS = floorMap.wrapT = THREE.RepeatWrapping;
  floorMap.anisotropy = 4;
  return floorMap;
}

/** Floors are poured concrete, not a masonry wall turned sideways. One existing
 * interior batch; one selected texture sample per fragment, with baked lighting intact. */
export function concreteFinish(material: THREE.MeshBasicMaterial) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uAccessFloor"] = { value: floorTexture() };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vAccessHorizontal;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvAccessHorizontal = abs(normal.y);",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vAccessHorizontal;\nuniform sampler2D uAccessFloor;",
      )
      .replace(
        "#include <map_fragment>",
        `
#ifdef USE_MAP
  vec4 accessTexel = vAccessHorizontal > 0.5 ? texture2D(uAccessFloor, vMapUv) : texture2D(map, vMapUv);
  diffuseColor *= accessTexel;
#endif`,
      );
  };
  material.customProgramCacheKey = () => "access-concrete-wall-floor-v1";
  return material;
}
