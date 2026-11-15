import type { Obstacle } from "./world-layout.ts";

type Position = { x: number; y: number; z: number };

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
