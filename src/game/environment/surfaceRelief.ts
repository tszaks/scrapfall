// Reuse each map's sampled albedo as a shallow height field. Surface-gradient bump
// mapping gives mortar, timber grain and aggregate a light response without a second
// texture fetch or a new draw call. Filter out subpixel relief to prevent shimmer.
import type * as THREE from "three";
import { surfaceDetail } from "./detailQuality";

export function surfaceRelief<M extends THREE.MeshStandardMaterial>(
  material: M,
  sample: string,
  mask: string,
  depth: number,
): M {
  const compile = material.onBeforeCompile.bind(material);
  const cache = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    compile(shader, renderer);
    shader.uniforms["uSurfaceRelief"] = surfaceDetail;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      "#include <common>\nuniform bool uSurfaceRelief;",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
if (uSurfaceRelief) {
  vec3 reliefDx = dFdx(-vViewPosition), reliefDy = dFdy(-vViewPosition);
  float reliefPixel = max(length(reliefDx), length(reliefDy));
  float reliefFade = 1.0 - smoothstep(0.04, 0.22, reliefPixel);
  float reliefHeight = dot(${sample}, vec3(0.2126, 0.7152, 0.0722)) * ${depth.toFixed(4)};
  vec3 reliefR1 = cross(reliefDy, normal), reliefR2 = cross(normal, reliefDx);
  float reliefDet = dot(reliefDx, reliefR1);
  vec3 reliefGrad = sign(reliefDet) * (dFdx(reliefHeight) * reliefR1 + dFdy(reliefHeight) * reliefR2);
  normal = normalize(abs(reliefDet) * normal - reliefGrad * reliefFade * (${mask}) + normal * 1e-10);
}`,
    );
  };
  material.customProgramCacheKey = () => cache() + `-relief-live-${depth}-${mask}`;
  return material;
}
