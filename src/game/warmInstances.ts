/** Empty effect pools must submit one instance during the existing hidden warm pass.
 * Restore before normal rendering, including when compilation fails. */
export function withWarmInstances(
  objects: readonly {
    isInstancedMesh?: boolean;
    count?: number;
    instanceMatrix?: { count: number };
    geometry?: {
      isBufferGeometry?: boolean;
      isInstancedBufferGeometry?: boolean;
      instanceCount?: number;
    };
  }[],
  draw: () => void,
) {
  const geometries: { instanceCount?: number }[] = [];
  const changed: { object: { count?: number }; count: number }[] = [];
  try {
    for (const object of objects)
      if (object.isInstancedMesh && object.count === 0 && (object.instanceMatrix?.count ?? 0) > 0) {
        changed.push({ object, count: 0 });
        object.count = 1;
      }
    for (const object of objects) {
      const g = object.geometry;
      if (g?.isInstancedBufferGeometry && g.instanceCount === 0) {
        geometries.push(g);
        g.instanceCount = 1;
      }
    }
    draw();
  } finally {
    for (const { object, count } of changed) object.count = count;
    for (const g of geometries) g.instanceCount = 0;
  }
}
