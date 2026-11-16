import type { CombatGame } from "./game.ts";
import type { Point } from "./world-layout.ts";

// Small cached A* for the review driver. It produces walking input, never edits
// actor position, doors, damage or outcomes. The game remains the collision owner.
export class RouteNavigation {
  private path: Point[] = [];
  private target = "";
  private age = 0;
  private last: Point = { x: NaN, z: NaN };
  private stalled = 0;
  private avoidLiving = false;
  private direct = false;
  private search?: Generator<void, Point[]>;
  private game: CombatGame;
  constructor(game: CombatGame) {
    this.game = game;
  }
  private clear(a: Point, b: Point) {
    const n = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / 0.17));
    let x = a.x,
      z = a.z;
    for (let i = 1; i <= n; i++) {
      const xx = a.x + ((b.x - a.x) * i) / n,
        zz = a.z + ((b.z - a.z) * i) / n;
      if (!this.game.walkable(xx, zz, x, z, this.avoidLiving)) return false;
      x = xx;
      z = zz;
    }
    return true;
  }
  next(goal: Point, dt: number, avoidLiving = false): Point {
    this.avoidLiving = avoidLiving;
    const p = this.game.player,
      key = `${goal.x.toFixed(2)}:${goal.z.toFixed(2)}`;
    this.age += dt;
    if (Math.hypot(p.x - this.last.x, p.z - this.last.z) < 0.002)
      this.stalled += dt;
    else this.stalled = 0;
    this.last = { x: p.x, z: p.z };
    const changed = key !== this.target;
    if (changed || (!this.search && (this.age > 0.8 || this.stalled > 0.4))) {
      this.direct = this.clear(p, goal);
      this.search = this.direct ? undefined : this.plan(p, goal);
      if (changed) this.path = [];
      this.target = key;
      this.age = 0;
      this.stalled = 0;
    }
    if (this.direct) return goal;
    if (this.search) {
      const deadline = performance.now() + 1;
      do {
        const result = this.search.next();
        if (result.done) {
          this.path = result.value;
          this.search = undefined;
          this.age = 0;
          for (let i = Math.min(this.path.length - 1, 5); i > 0; i--)
            if (this.clear(p, this.path[i])) {
              this.path.splice(0, i);
              break;
            }
          break;
        }
      } while (performance.now() < deadline);
    }
    while (
      this.path.length > 1 &&
      Math.hypot(p.x - this.path[0].x, p.z - this.path[0].z) < 0.23
    )
      this.path.shift();
    return this.path[0] ?? p;
  }
  private *plan(start: Point, goal: Point): Generator<void, Point[]> {
    const size = 0.32,
      minX = this.game.bounds.minX,
      maxX = this.game.bounds.maxX;
    const minZ = Math.max(this.game.bounds.minZ, Math.min(start.z, goal.z) - 4),
      maxZ = Math.min(this.game.bounds.maxZ, Math.max(start.z, goal.z) + 4);
    const width = Math.ceil((maxX - minX) / size) + 1,
      height = Math.ceil((maxZ - minZ) / size) + 1;
    const point = (id: number) => ({
      x: minX + (id % width) * size,
      z: minZ + Math.floor(id / width) * size,
    });
    const id = (p: Point) =>
      Math.round((p.z - minZ) / size) * width + Math.round((p.x - minX) / size);
    const first = id(start),
      cost = new Float64Array(width * height).fill(Infinity),
      parent = new Int32Array(width * height).fill(-1),
      closed = new Uint8Array(width * height);
    const open: number[] = [];
    cost[first] = 0;
    const heuristic = (i: number) => {
      const p = point(i);
      return Math.hypot(p.x - goal.x, p.z - goal.z);
    };
    const score = (i: number) => cost[i] + heuristic(i);
    const push = (id: number) => {
      open.push(id);
      let i = open.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (score(open[p]) <= score(id)) break;
        open[i] = open[p];
        i = p;
      }
      open[i] = id;
    };
    const pop = () => {
      const out = open[0],
        last = open.pop()!;
      if (open.length) {
        let i = 0;
        while (i * 2 + 1 < open.length) {
          let c = i * 2 + 1;
          if (c + 1 < open.length && score(open[c + 1]) < score(open[c])) c++;
          if (score(last) <= score(open[c])) break;
          open[i] = open[c];
          i = c;
        }
        open[i] = last;
      }
      return out;
    };
    push(first);
    const allowed = new Int8Array(width * height);
    const valid = (id: number) => {
      if (!allowed[id]) {
        const q = point(id);
        allowed[id] =
          this.game.walkable(q.x, q.z, q.x, q.z, this.avoidLiving) ||
          (Math.hypot(q.x - start.x, q.z - start.z) < 1.8 &&
            this.game.walkable(q.x, q.z, start.x, start.z, this.avoidLiving))
            ? 1
            : -1;
      }
      return allowed[id] === 1;
    };
    let best = first,
      bestH = heuristic(first),
      end = -1;
    while (open.length) {
      const current = pop();
      if (closed[current]) continue;
      closed[current] = 1;
      const p = point(current),
        h = heuristic(current);
      if (h < bestH) {
        best = current;
        bestH = h;
      }
      if (h < 0.35 && this.clear(p, goal)) {
        end = current;
        break;
      }
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        const nx = (current % width) + dx,
          nz = Math.floor(current / width) + dz;
        if (nx < 0 || nx >= width || nz < 0 || nz >= height) continue;
        const n = nz * width + nx;
        if (closed[n]) continue;
        const q = point(n);
        if (
          !valid(n) ||
          this.game.heightAt(q.x, q.z) > this.game.heightAt(p.x, p.z) + 0.3
        )
          continue;
        if (
          dx &&
          dz &&
          (!valid(Math.floor(current / width) * width + nx) ||
            !valid(nz * width + (current % width)))
        )
          continue;
        const value = cost[current] + Math.hypot(dx, dz) * size;
        if (value < cost[n]) {
          cost[n] = value;
          parent[n] = current;
          push(n);
        }
      }
      yield;
    }
    if (end < 0) end = best;
    const path: Point[] = [];
    for (let i = end; i !== first && i >= 0; i = parent[i]) path.push(point(i));
    path.reverse();
    if (bestH < 0.4 || end !== best) path.push(goal);
    return path;
  }
}
