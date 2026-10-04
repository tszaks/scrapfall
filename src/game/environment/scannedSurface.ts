// Locally bundled CC0 scans. Real metre-scale grain complements the authored facade
// modules; windows, signs, and metal keep their original surfaces. See materials/sources.json.
import * as THREE from "three";
import { surfaceDetail } from "./detailQuality";

type Scan = "concrete_floor_02" | "wood_planks" | "sand_01" | "snow_02";
const scans = new Map<Scan, { texture: THREE.Texture; ready: Promise<void> }>();
function scan(name: Scan) {
  let entry = scans.get(name);
  if (entry) return entry;
  let resolve!: () => void;
  const ready = new Promise<void>((done) => {
    resolve = done;
  });
  const texture: THREE.Texture = new THREE.TextureLoader().load(
    `${import.meta.env.BASE_URL}materials/${name}.jpg`,
    () => resolve(),
    undefined,
    () => {
      // A missing optional scan must not leave an incomplete sampler or a black world.
      const fallback = document.createElement("canvas");
      fallback.width = fallback.height = 1;
      const context = fallback.getContext("2d")!;
      context.fillStyle = "#a4a4a4";
      context.fillRect(0, 0, 1, 1);
      texture.image = fallback;
      texture.needsUpdate = true;
      resolve();
    },
  );
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  entry = { texture, ready };
  scans.set(name, entry);
  return entry;
}
export async function prepareScans(mode: string) {
  const names: Scan[] =
    mode === "city"
      ? ["concrete_floor_02"]
      : mode === "beach"
        ? ["concrete_floor_02", "sand_01", "wood_planks"]
        : mode === "western"
          ? ["wood_planks", "sand_01", "concrete_floor_02"]
          : mode === "alpine"
            ? ["wood_planks", "snow_02", "concrete_floor_02"]
            : [];
  await Promise.all(names.map((name) => scan(name).ready));
}
export function scannedSurface<M extends THREE.MeshStandardMaterial>(
  material: M,
  name: Scan,
  world: string,
  mask: string,
  metres: number,
  strength = 0.65,
): M {
  const previous = material.onBeforeCompile.bind(material);
  const key = material.customProgramCacheKey.bind(material);
  const uniform = `uScan_${name}`;
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.uniforms[uniform] = { value: scan(name).texture };
    shader.uniforms["uScanRelief"] = surfaceDetail;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>\nuniform sampler2D ${uniform};\n#ifndef SCAN_RELIEF_UNIFORM\n#define SCAN_RELIEF_UNIFORM\nuniform bool uScanRelief;\n#endif`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
{
  float scanMask = clamp(${mask}, 0.0, 1.0) * (1.0 - smoothstep(55.0, 110.0, length(vViewPosition)));
  vec3 scanWorldN = abs(inverseTransformDirection(normalize(vNormal), viewMatrix));
  vec3 scanP = ${world};
  vec2 scanUV = scanWorldN.y > 0.65 ? scanP.xz : (scanWorldN.x > scanWorldN.z ? scanP.zy : scanP.xy);
  vec2 scanCoord = scanUV / ${metres.toFixed(2)};
  vec2 scanDx = dFdx(scanCoord), scanDy = dFdy(scanCoord);
  if (scanMask > 0.001) {
  vec3 scanColor = textureGrad(${uniform}, scanCoord, scanDx, scanDy).rgb;
  float scanLuma = dot(scanColor, vec3(0.2126, 0.7152, 0.0722));
  // Retain each map's palette while adding the scan's knots, pores and wear.
  diffuseColor.rgb *= mix(vec3(1.0), clamp(scanColor * 1.7 + 0.36, 0.45, 1.3), scanMask * ${strength.toFixed(2)});
  roughnessFactor = clamp(roughnessFactor + (0.45 - scanLuma) * 0.2 * scanMask, 0.05, 1.0);
  // Albedo grain is only a weak height proxy: millimetres, not carved centimetres.
  if (uScanRelief) {
  vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
  float sf = 1.0 - smoothstep(0.025, 0.16, max(length(sx), length(sy)));
  vec3 sr1 = cross(sy, normal), sr2 = cross(normal, sx);
  float sd = dot(sx, sr1);
  vec3 sg = sign(sd) * (dFdx(scanLuma) * sr1 + dFdy(scanLuma) * sr2);
  normal = normalize(abs(sd) * normal - sg * 0.006 * sf * scanMask + normal * 1e-10);
  }
  }
}`,
    );
  };
  material.customProgramCacheKey = () => key() + `-scan-${name}-fine-relief-${mask}`;
  return material;
}
