// What the WAVE SURGE looks like (the timeline is in waveSurge.ts): a long swell standing up
// on the horizon and rolling in with a foaming crest, then a sheet of surf running up the
// sand with a white leading edge and small, soft spray, and finally a glossy wet-sand film
// with foam streaks that fades as the beach dries. Three draw calls, only while it runs.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { glowTexture } from "../cityTextures";
import { addSkyFogUniforms } from "../skyFog";
import { SEA, X, baseProfile, type BeachLayout } from "./beachLayout";
import { SURGE, surge } from "./waveSurge";

const SPRAY = 220;
const _v = new THREE.Vector3();

export function SurgeFx({ city }: { city: BeachLayout }) {
  const half = city.half;
  // ---- the swell: a ribbon along the coast, unit height (scaled by the swell's height) ----
  const swellGeo = useMemo(() => {
    const prof: [number, number][] = [];
    // back slope (seaward, -x) rising gently, a steep face toward the beach (+x)
    for (let k = 0; k <= 12; k++) {
      const u = -34 + (k / 12) * 34;
      const t = (u + 34) / 34;
      prof.push([u, Math.pow(Math.sin((t * Math.PI) / 2), 2)]);
    }
    for (let k = 1; k <= 5; k++) {
      const u = (k / 5) * 7;
      prof.push([u, Math.cos((k / 5) * (Math.PI / 2)) * (1 - 0.15 * (k / 5))]);
    }
    const Z = 2 * half + 2400;
    const nz = 60;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const deep = new THREE.Color("#1d4a66");
    const lit = new THREE.Color("#3f8ea0");
    const foam = new THREE.Color("#f2f6f4");
    const c = new THREE.Color();
    for (let j = 0; j <= nz; j++) {
      const z = -Z / 2 + (j / nz) * Z;
      for (const [u, h] of prof) {
        pos.push(u, h, z);
        c.copy(deep).lerp(lit, h);
        if (h > 0.7) c.lerp(foam, Math.min(1, (h - 0.7) / 0.2));
        col.push(c.r, c.g, c.b);
      }
    }
    const w = prof.length;
    for (let j = 0; j < nz; j++)
      for (let k = 0; k + 1 < w; k++) {
        const a = j * w + k;
        idx.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, [half]);

  // ---- the run-up sheet: a grid draped on the beach profile ----
  const sheetGeo = useMemo(() => {
    const x0 = X.surf - 4;
    const x1 = SURGE.topX + 2;
    const nx = Math.round((x1 - x0) / 2);
    const nz = Math.round((2 * half) / 4);
    const pos: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= nz; j++) {
      const z = -half + (j / nz) * 2 * half;
      for (let i = 0; i <= nx; i++) {
        const x = x0 + (i / nx) * (x1 - x0);
        pos.push(x, Math.max(SEA, baseProfile(x, z)), z);
      }
    }
    const w = nx + 1;
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const a = j * w + i;
        idx.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, [half]);

  const u = useMemo(
    () => ({ uFront: { value: 0 }, uWet: { value: 0 }, uRun: { value: 0 }, uTime: { value: 0 } }),
    [],
  );
  const mats = useMemo(() => {
    // lit a little from within so the backlit swell still reads against the sunset glare
    const swell = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.3,
      metalness: 0.1,
      emissive: "#1e4e5e",
      emissiveIntensity: 0.6,
    });
    const sheet = new THREE.MeshStandardMaterial({
      color: "#2c6a80",
      roughness: 0.3,
      metalness: 0.1,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    sheet.onBeforeCompile = (sh) => {
      addSkyFogUniforms(sh);
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform float uFront;\nuniform float uRun;\nvarying vec3 vW;",
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
// running water stands deeper behind its leading edge
transformed.y += 0.06 + min(0.55, max(0.0, uFront - position.x) * 0.03) * uRun;
vW = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
uniform float uFront;
uniform float uWet;
uniform float uRun;
uniform float uTime;
varying vec3 vW;
float sHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float sNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), f.x), mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
float edge = uFront - vW.x + sin(vW.z * 0.07 + uTime * 0.8) * 1.6 + (sNoise(vW.xz * 0.25) - 0.5) * 3.0;
if (edge < 0.0) discard;
float n = sNoise(vW.xz * vec2(0.18, 0.5) + vec2(uTime * 0.6, 0.0));
// the white leading edge, lace behind it, and foam streaks left on the wet sand
float lead = smoothstep(7.0, 0.0, edge) * uRun;
float lace = smoothstep(0.56, 0.74, n) * (0.4 + 0.6 * uRun);
float foamK = clamp(max(lead, lace), 0.0, 1.0);
vec3 water = mix(vec3(0.22, 0.52, 0.58), vec3(0.26, 0.21, 0.16), 1.0 - uRun);
diffuseColor.rgb = mix(water, vec3(0.95, 0.96, 0.95), foamK);
diffuseColor.a = mix(0.5, 0.72, uRun) * uWet * mix(0.8, 1.0, foamK);`,
        )
        .replace(
          "#include <roughnessmap_fragment>",
          "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.9, foamK);",
        );
    };
    sheet.customProgramCacheKey = () => "beach-surge-sheet-v1";
    const spray = new THREE.PointsMaterial({
      map: glowTexture(),
      color: "#ffffff",
      size: 0.9,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { swell, sheet, spray };
  }, [u]);
  useEffect(
    () => () => {
      swellGeo.dispose();
      sheetGeo.dispose();
      Object.values(mats).forEach((m) => m.dispose());
    },
    [swellGeo, sheetGeo, mats],
  );

  const sprayGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(SPRAY * 3), 3));
    return g;
  }, []);
  useEffect(() => () => sprayGeo.dispose(), [sprayGeo]);

  const swellRef = useRef<THREE.Mesh>(null);
  const sheetRef = useRef<THREE.Mesh>(null);
  const sprayRef = useRef<THREE.Points>(null);
  useFrame((state) => {
    const on = surge.on;
    const sw = swellRef.current;
    const sh = sheetRef.current;
    const sp = sprayRef.current;
    if (!sw || !sh || !sp) return;
    const t = surge.t;
    const time = state.clock.elapsedTime;
    sw.visible = on && surge.swellH > 0.05;
    if (sw.visible) {
      sw.position.set(surge.swellX, SEA - 0.35, 0);
      sw.scale.set(1, surge.swellH, 1);
    }
    const running = t >= SURGE.breaks && t < SURGE.peak;
    u.uFront.value = surge.front;
    u.uWet.value = surge.wet;
    u.uRun.value = t < SURGE.hold ? 1 : Math.max(0, 1 - (t - SURGE.hold) / 3);
    u.uTime.value = time;
    sh.visible = on && surge.wet > 0.01;
    // small soft spray thrown up where the wave breaks and along the running front
    sp.visible = on && (running || (t > SURGE.breaks - 1.2 && t < SURGE.breaks + 0.5));
    if (sp.visible) {
      const a = sprayGeo.getAttribute("position") as THREE.BufferAttribute;
      const cam = state.camera.position;
      for (let i = 0; i < SPRAY; i++) {
        const z = cam.z + (((i * 37.1) % SPRAY) / SPRAY - 0.5) * 220;
        const ph = (time * 1.7 + i * 0.37) % 1;
        const x = surge.front - 1 + Math.sin(i * 7.7 + time) * 1.5 - ph * 2;
        const y =
          Math.max(SEA, baseProfile(x, z)) + 0.2 + ph * (1.2 + (i % 5) * 0.35) - ph * ph * 1.4;
        _v.set(x, y, z);
        a.setXYZ(i, _v.x, _v.y, _v.z);
      }
      a.needsUpdate = true;
      mats.spray.opacity = 0.55 * (running ? 1 : 0.6);
    }
  });

  return (
    <>
      <mesh
        ref={swellRef}
        geometry={swellGeo}
        material={mats.swell}
        visible={false}
        frustumCulled={false}
      />
      <mesh
        ref={sheetRef}
        geometry={sheetGeo}
        material={mats.sheet}
        visible={false}
        frustumCulled={false}
        renderOrder={2}
      />
      <points
        ref={sprayRef}
        geometry={sprayGeo}
        material={mats.spray}
        visible={false}
        frustumCulled={false}
        renderOrder={3}
      />
    </>
  );
}
