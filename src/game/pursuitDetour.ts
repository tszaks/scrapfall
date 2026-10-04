/** Local ground routes for obstacles the coarse flow field cannot represent. */
export type PursuitPoint = { x: number; z: number };
export type PursuitProbe = {
  /** Sweep the actor's full body, including both endpoints, without changing it. */
  segmentClear(ax: number, az: number, bx: number, bz: number, radius: number): boolean;
};

const STEP = 2;
const RANGE = 24;
const HALF = RANGE / STEP;
const WIDTH = HALF * 2 + 1;
const COUNT = WIDTH * WIDTH;
const START = HALF * WIDTH + HALF;
const BUDGET = 512;
const LOOK = 6;
const ARRIVED = 0.35;

type Route = {
  x: Float64Array;
  z: Float64Array;
  length: number;
  next: number;
  targetX: number;
  targetZ: number;
  retryAt: number;
};

/** One service per simulation; all enemies share its bounded search budget. */
export class PursuitDetour {
  private routes = new WeakMap<object, Route>();
  private clock = NaN;
  private remaining = BUDGET;
  private out: PursuitPoint = { x: 0, z: 0 };
  private cost = new Float64Array(COUNT);
  private score = new Float64Array(COUNT);
  private parent = new Int16Array(COUNT);
  private closed = new Uint8Array(COUNT);
  private heap = new Int16Array(COUNT);
  private position = new Int16Array(COUNT);
  private heapSize = 0;

  /** Shared result: consume immediately. `time` must be the same for every actor in a frame. */
  resolve(
    actor: PursuitPoint,
    target: PursuitPoint,
    desired: PursuitPoint,
    time: number,
    radius: number,
    probe: PursuitProbe,
  ): PursuitPoint {
    if (time !== this.clock) {
      this.clock = time;
      this.remaining = BUDGET;
    }
    let route = this.routes.get(actor);
    if (!route) {
      route = {
        x: new Float64Array(COUNT + 1),
        z: new Float64Array(COUNT + 1),
        length: 0,
        next: 0,
        targetX: target.x,
        targetZ: target.z,
        retryAt: -Infinity,
      };
      this.routes.set(actor, route);
    }
    const dx = desired.x - actor.x;
    const dz = desired.z - actor.z;
    const distance = Math.hypot(dx, dz);
    // A player fits closer to a wall than a larger enemy. Only the actual player
    // goal permits a melee approach; a coarse waypoint must still be reached exactly.
    const goalTolerance =
      distance <= RANGE && desired.x === target.x && desired.z === target.z ? 1 : 0;
    if (
      goalTolerance &&
      distance <= goalTolerance &&
      !probe.segmentClear(actor.x, actor.z, desired.x, desired.z, radius)
    ) {
      route.length = 0;
      return this.point(actor.x, actor.z);
    }
    if (Math.hypot(target.x - route.targetX, target.z - route.targetZ) > 4) {
      route.length = 0;
      route.retryAt = -Infinity;
      route.targetX = target.x;
      route.targetZ = target.z;
    }
    if (route.length) {
      while (
        route.next < route.length &&
        Math.hypot(actor.x - route.x[route.next]!, actor.z - route.z[route.next]!) <= ARRIVED
      )
        route.next++;
      if (route.next < route.length) {
        const next = route.next;
        if (probe.segmentClear(actor.x, actor.z, route.x[next]!, route.z[next]!, radius)) {
          // Retain the chosen side of the obstacle, but skip corners already in clear view.
          for (let i = next + 1; i < route.length; i++) {
            if (Math.hypot(route.x[i]! - actor.x, route.z[i]! - actor.z) > LOOK) break;
            if (!probe.segmentClear(actor.x, actor.z, route.x[i]!, route.z[i]!, radius)) break;
            route.next = i;
          }
          return this.point(route.x[route.next]!, route.z[route.next]!);
        }
        route.retryAt = -Infinity;
      }
      route.length = 0;
    }

    const fraction = distance > LOOK ? LOOK / distance : 1;
    if (
      probe.segmentClear(actor.x, actor.z, actor.x + dx * fraction, actor.z + dz * fraction, radius)
    )
      return this.point(desired.x, desired.z);
    if (time < route.retryAt || this.remaining === 0) return this.point(actor.x, actor.z);

    // The flow-field waypoint remains the objective. Chasing a nearer player across the
    // same fence here would undo the long-range planner's deliberate route around it.
    const clipped = distance > RANGE ? RANGE / distance : 1;
    const goalX = actor.x + dx * clipped;
    const goalZ = actor.z + dz * clipped;
    route.targetX = target.x;
    route.targetZ = target.z;
    if (!this.search(actor, goalX, goalZ, radius, probe, route, goalTolerance)) {
      route.retryAt = time + 0.5;
      return this.point(actor.x, actor.z);
    }
    route.retryAt = -Infinity;
    return this.point(route.x[0]!, route.z[0]!);
  }

  private point(x: number, z: number): PursuitPoint {
    this.out.x = x;
    this.out.z = z;
    return this.out;
  }

  private rise(index: number) {
    const node = this.heap[index]!;
    while (index > 0) {
      const above = (index - 1) >> 1;
      const other = this.heap[above]!;
      if (this.score[other]! <= this.score[node]!) break;
      this.heap[index] = other;
      this.position[other] = index;
      index = above;
    }
    this.heap[index] = node;
    this.position[node] = index;
  }

  private pop(): number {
    const node = this.heap[0]!;
    const tail = this.heap[--this.heapSize]!;
    this.position[node] = -1;
    if (this.heapSize === 0) return node;
    let index = 0;
    while (index * 2 + 1 < this.heapSize) {
      let child = index * 2 + 1;
      if (
        child + 1 < this.heapSize &&
        this.score[this.heap[child + 1]!]! < this.score[this.heap[child]!]!
      )
        child++;
      const other = this.heap[child]!;
      if (this.score[tail]! <= this.score[other]!) break;
      this.heap[index] = other;
      this.position[other] = index;
      index = child;
    }
    this.heap[index] = tail;
    this.position[tail] = index;
    return node;
  }

  private search(
    actor: PursuitPoint,
    goalX: number,
    goalZ: number,
    radius: number,
    probe: PursuitProbe,
    route: Route,
    goalTolerance = 0,
  ): boolean {
    this.cost.fill(Infinity);
    this.parent.fill(-1);
    this.closed.fill(0);
    this.position.fill(-1);
    this.cost[START] = 0;
    this.score[START] = Math.max(0, Math.hypot(goalX - actor.x, goalZ - actor.z) - goalTolerance);
    this.heap[0] = START;
    this.position[START] = 0;
    this.heapSize = 1;
    let expanded = 0;
    while (this.heapSize && expanded < BUDGET && this.remaining > 0) {
      const node = this.pop();
      this.closed[node] = 1;
      expanded++;
      this.remaining--;
      const i = Math.floor(node / WIDTH);
      const j = node % WIDTH;
      const x = actor.x + (i - HALF) * STEP;
      const z = actor.z + (j - HALF) * STEP;
      const goalDistance = Math.hypot(goalX - x, goalZ - z);
      const approach = goalDistance > goalTolerance ? 1 - goalTolerance / goalDistance : 0;
      const endX = x + (goalX - x) * approach;
      const endZ = z + (goalZ - z) * approach;
      if (
        goalDistance <= STEP * Math.SQRT2 + goalTolerance &&
        probe.segmentClear(x, z, endX, endZ, radius)
      ) {
        // Build backwards in the actor's reusable buffer, then reverse in place.
        let length = 1;
        route.x[0] = endX;
        route.z[0] = endZ;
        for (let k = node; k !== START; k = this.parent[k]!) {
          route.x[length] = actor.x + (Math.floor(k / WIDTH) - HALF) * STEP;
          route.z[length++] = actor.z + ((k % WIDTH) - HALF) * STEP;
        }
        for (let a = 0, b = length - 1; a < b; a++, b--) {
          const rx = route.x[a]!;
          const rz = route.z[a]!;
          route.x[a] = route.x[b]!;
          route.z[a] = route.z[b]!;
          route.x[b] = rx;
          route.z[b] = rz;
        }
        route.length = length;
        route.next = 0;
        return true;
      }
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          if (!di && !dj) continue;
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= WIDTH || nj >= WIDTH) continue;
          if ((ni - HALF) ** 2 + (nj - HALF) ** 2 > HALF ** 2) continue;
          const next = ni * WIDTH + nj;
          if (this.closed[next]) continue;
          const cost = this.cost[node]! + STEP * (di && dj ? Math.SQRT2 : 1);
          if (cost >= this.cost[next]!) continue;
          const nx = actor.x + (ni - HALF) * STEP;
          const nz = actor.z + (nj - HALF) * STEP;
          if (!probe.segmentClear(x, z, nx, nz, radius)) continue;
          this.parent[next] = node;
          this.cost[next] = cost;
          this.score[next] = cost + Math.max(0, Math.hypot(goalX - nx, goalZ - nz) - goalTolerance);
          let position = this.position[next]!;
          if (position < 0) {
            position = this.heapSize++;
            this.heap[position] = next;
          }
          this.rise(position);
        }
      }
    }
    return false;
  }
}
