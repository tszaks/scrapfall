import * as THREE from "three";
import { facadeArrays, L, TILE_COLS, TILE_ROWS } from "../cityTextures";

// The same binary coverage test as the visible facade shader. Without this, a
// leaf spray's invisible rectangle would cast a rectangular shadow.
export function foliageDepthMaterial() {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uLeafAtlas"] = { value: facadeArrays().day };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec2 aUv2;\nattribute vec3 aFac;\nvarying vec3 vLeaf;",
      )
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLeaf = vec3(aUv2, aFac.x);");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nprecision highp sampler2DArray;\nuniform sampler2DArray uLeafAtlas;\nvarying vec3 vLeaf;",
      )
      .replace(
        "#include <alphatest_fragment>",
        `#include <alphatest_fragment>
if (abs(vLeaf.z - ${L.foliage}.0) < 0.1 && texture(uLeafAtlas, vec3(vLeaf.xy / vec2(${TILE_COLS}.0, ${TILE_ROWS}.0), vLeaf.z)).a < 0.42) discard;`,
      );
  };
  material.customProgramCacheKey = () => "foliage-depth-v1";
  return material;
}
