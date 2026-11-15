import { test } from "node:test";
import assert from "node:assert/strict";
import { cameraClearance } from "../src/camera-clearance.ts";
import { OBSTACLES } from "../src/world-layout.ts";
const wall = { x: 2, z: 0, hx: 0.2, hz: 4, minY: 0, maxY: 4 };
test("the follow camera stays on the player side of a wide room wall", () => {
  const f = cameraClearance(
    { x: 0, y: 1.5, z: 0 },
    { x: 4, y: 2, z: 0 },
    [wall],
    new Set(),
  );
  assert.ok(f > 0.3 && f < 0.45);
  assert.ok(4 * f < wall.x - wall.hx);
  assert.equal(
    cameraClearance(
      { x: 0, y: 5, z: 0 },
      { x: 4, y: 5, z: 0 },
      [wall],
      new Set(),
    ),
    1,
  );
});

test("the camera can see over the courtyard's low crate instead of treating it as a column", () => {
  const crate = OBSTACLES.find((o) => o.x === 4.7 && o.z === -28.2);
  assert.ok(crate);
  assert.equal(
    cameraClearance(
      { x: 4.7, y: 3.7, z: -30.2 },
      { x: 4.7, y: 4.2, z: -26.2 },
      [crate],
      new Set(),
    ),
    1,
  );
});
test("closed doors obstruct the camera, open doors and parallel clear paths do not", () => {
  const door = { ...wall, door: "gallery" };
  assert.ok(
    cameraClearance(
      { x: 0, y: 1.5, z: 0 },
      { x: 4, y: 2, z: 0 },
      [door],
      new Set(),
    ) < 1,
  );
  assert.equal(
    cameraClearance(
      { x: 0, y: 1.5, z: 0 },
      { x: 4, y: 2, z: 0 },
      [door],
      new Set(["gallery"]),
    ),
    1,
  );
  assert.equal(
    cameraClearance(
      { x: 0, y: 1.5, z: 0 },
      { x: 0, y: 2, z: 5 },
      [wall],
      new Set(),
    ),
    1,
  );
});
