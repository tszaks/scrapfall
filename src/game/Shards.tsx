import { useSimulationFrame as useFrame } from "./useSimulationFrame";
import { shardLedger } from "./shardLedger";

import { groundY } from "./terrain";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import { NEW_VALUE } from "./enemyKinds";

type E = { kind: string; generation?: number; x: number; z: number; alive: boolean };
const VALUE: Record<string, number> = { drifter: 1, runner: 1, shooter: 2, specter: 2, bomber: 3, brute: 3, vanguard: 4, special: 4, boss: 25, ...NEW_VALUE };
const N = 90;

/** Every client drops its own shards when an enemy dies, so each player earns currency. */
export function Shards({
  enemies,
  active,
  magnet,
  onCollect,
  taken,
  onTake,
}: {
  enemies: E[];
  active: React.MutableRefObject<boolean>;
  magnet: React.MutableRefObject<number>;
  onCollect: (v: number) => void;
  /** shard ids picked up by teammates (co-op): vanish here too */
  taken?: React.MutableRefObject<Set<string>>;
  onTake?: (id: string) => boolean;
}) {
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const pool = useRef(Array.from({ length: N }, () => ({ x: 0, z: 0, v: 0, on: false, vx: 0, vz: 0, id: "", claimAt: -Infinity })));
  const deaths = useRef<number[]>([]);
  const was = useRef(new WeakMap<E, boolean>());

  useEffect(() => {
    pool.current.forEach((p) => (p.on = false));
    was.current = new WeakMap();
    deaths.current = [];
    taken?.current.clear();
    shardLedger.clear();
  }, [enemies]); // eslint-disable-line react-hooks/exhaustive-deps

  const tick = useRef(0);
  useEffect(() => {
    if (new URLSearchParams(location.search).has("debug")) {
      const w = window as unknown as Record<string, unknown>;
      w["__shardPool"] = pool.current;
      w["__shardDeaths"] = deaths;
      w["__shardTick"] = tick;
      w["__shardEnemies"] = enemies;
    }
  }, []);

  useFrame((state, raw) => {
    tick.current++;
    const d = Math.min(raw, 0.05);
    const cam = state.camera;
    for (let ei = 0; ei < enemies.length; ei++) {
      const e = enemies[ei]!;
      if (was.current.get(e) && !e.alive) {
        const dn = e.generation ?? (deaths.current[ei] ?? 0) + 1;
        deaths.current[ei] = dn;
        const total = VALUE[e.kind] ?? 1;
        const count = Math.min(5, Math.max(1, Math.ceil(total / 5)), total);
        for (let c = 0; c < count; c++) {
          const slot = pool.current.find((p) => !p.on);
          if (!slot) break;
          // deterministic id + scatter so every co-op client agrees on each shard
          const id = `${ei}-${dn}-${c}`;
          if (taken?.current.has(id)) continue;
          const h = Math.sin((ei + 1) * 12.9898 + dn * 78.233 + c * 37.719) * 43758.5453;
          const r = h - Math.floor(h);
          const a = r * Math.PI * 2;
          const s = count > 1 ? 2 + r * 2 : 0.5;
          const value=Math.floor(total/count)+(c<total%count?1:0);
          shardLedger.set(id,{value,x:e.x,z:e.z});
          Object.assign(slot, { claimAt: -Infinity, id, x: e.x, z: e.z, v: Math.floor(total / count) + (c < total % count ? 1 : 0), on: true, vx: Math.cos(a) * s, vz: Math.sin(a) * s });
        }
      }
      was.current.set(e, e.alive);
    }
    const t = state.clock.elapsedTime;
    pool.current.forEach((p, i) => {
      const m = meshes.current[i];
      if (p.on && taken?.current.has(p.id)) p.on = false;
      if (m) m.visible = p.on;
      if (!p.on) return;
      p.x += p.vx * d;
      p.z += p.vz * d;
      p.vx *= 1 - Math.min(1, d * 4);
      p.vz *= 1 - Math.min(1, d * 4);
      const dx = cam.position.x - p.x;
      const dz = cam.position.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (active.current && Math.abs(cam.position.y - 1.6 - groundY(p.x,p.z)) < 1.5) {
        if (dist < 0.9) {
          if(performance.now()-p.claimAt<1000)return;
          p.claimAt=performance.now();
          if(onTake?.(p.id)!==false){p.on=false;onCollect(p.v);}
          return;
        }
        if (dist < magnet.current) {
          const pull = (12 * d) / dist;
          p.x += dx * pull;
          p.z += dz * pull;
        }
      }
      if (m) {
        m.position.set(p.x, groundY(p.x, p.z) + 0.45 + Math.sin(t * 4 + i) * 0.1, p.z);
        m.rotation.y = t * 3 + i;
        m.scale.setScalar(0.8 + Math.sqrt(p.v) * 0.25);
      }
    });
  });

  return (
    <>
      {Array.from({ length: N }, (_, i) => (
        <mesh key={i} ref={(m) => { meshes.current[i] = m; }} visible={false}>
          <octahedronGeometry args={[0.16]} />
          <meshBasicMaterial color="#5ff6ff" fog={false} />
        </mesh>
      ))}
    </>
  );
}
