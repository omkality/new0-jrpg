import type { Obstacle } from "./world-layout.ts";

type Position = { x: number; y: number; z: number };
type CameraBounds = { minX: number; maxX: number; maxY: number };
const turns = [1, -1, 2, -2, 3, -3, 4].map((n) => ({
  cos: Math.cos((n * Math.PI) / 4),
  sin: Math.sin((n * Math.PI) / 4),
  cost: Math.abs(n) * 0.25,
}));

// Segment versus the same solid wall volumes used by movement. Height matters:
// the camera may see over a sill, but cannot sit beyond the room's wall.
export function cameraClearance(
  focus: Position,
  desired: Position,
  obstacles: readonly Obstacle[],
  openDoors: ReadonlySet<string>,
) {
  let fraction = 1;
  for (const o of obstacles) {
    if (o.door && openDoors.has(o.door)) continue;
    // Height separates low furniture from columns, walls and door leaves.
    if (o.minY === undefined || o.maxY === undefined) continue;
    let near = 0,
      far = 1;
    for (let axis = 0; axis < 3; axis++) {
      const start = axis === 0 ? focus.x : axis === 1 ? focus.y : focus.z;
      const end = axis === 0 ? desired.x : axis === 1 ? desired.y : desired.z;
      const minimum =
        (axis === 0 ? o.x - o.hx : axis === 1 ? o.minY : o.z - o.hz) - 0.14;
      const maximum =
        (axis === 0 ? o.x + o.hx : axis === 1 ? o.maxY : o.z + o.hz) + 0.14;
      const delta = end - start;
      if (Math.abs(delta) < 1e-8) {
        if (start < minimum || start > maximum) {
          far = -1;
          break;
        }
      } else {
        const a = (minimum - start) / delta,
          b = (maximum - start) / delta;
        near = Math.max(near, Math.min(a, b));
        far = Math.min(far, Math.max(a, b));
      }
    }
    // A focus inside a low prop should not pin the camera to the hero's head.
    if (near > 0.015 && near <= far && near < fraction)
      fraction = Math.max(0.01, near - 0.025);
  }
  return fraction;
}

export class FollowCameraClearance {
  private candidate: Position = { x: 0, y: 0, z: 0 };
  resolve(
    focus: Position,
    desired: Position,
    output: Position,
    obstacles: readonly Obstacle[],
    openDoors: ReadonlySet<string>,
    bounds: CameraBounds,
    previous: Position,
  ) {
    const dx = desired.x - focus.x,
      dy = desired.y - focus.y,
      dz = desired.z - focus.z;
    const native = this.candidate;
    native.x = Math.max(bounds.minX, Math.min(bounds.maxX, desired.x));
    native.y = Math.min(bounds.maxY, desired.y);
    native.z = desired.z;
    const fraction = cameraClearance(focus, native, obstacles, openDoors);
    output.x = focus.x + (native.x - focus.x) * fraction;
    output.y = focus.y + (native.y - focus.y) * fraction;
    output.z = focus.z + (native.z - focus.z) * fraction;
    const distance = Math.hypot(
      output.x - focus.x,
      output.y - focus.y,
      output.z - focus.z,
    );
    if (distance >= 1.9) return;
    let best =
      Math.min(1, distance / 2.2) * 10 -
      Math.hypot(
        output.x - previous.x,
        output.y - previous.y,
        output.z - previous.z,
      ) *
        0.04;
    for (const turn of turns) {
      const p = this.candidate;
      p.x = Math.max(
        bounds.minX,
        Math.min(bounds.maxX, focus.x + dx * turn.cos - dz * turn.sin),
      );
      p.y = Math.min(bounds.maxY, focus.y + dy);
      p.z = focus.z + dx * turn.sin + dz * turn.cos;
      const f = cameraClearance(focus, p, obstacles, openDoors);
      p.x = focus.x + (p.x - focus.x) * f;
      p.y = focus.y + (p.y - focus.y) * f;
      p.z = focus.z + (p.z - focus.z) * f;
      const d = Math.hypot(p.x - focus.x, p.y - focus.y, p.z - focus.z);
      const score =
        Math.min(1, d / 2.2) * 10 -
        turn.cost -
        Math.hypot(p.x - previous.x, p.y - previous.y, p.z - previous.z) * 0.04;
      if (score > best) {
        best = score;
        output.x = p.x;
        output.y = p.y;
        output.z = p.z;
      }
    }
  }
}
