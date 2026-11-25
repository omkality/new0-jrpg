import assert from "node:assert/strict";
import test from "node:test";
import * as T from "three";
import { blackGate, gateWall } from "../src/gatehouse.ts";
import { FOREST_GATE as gate, WALLS, OBSTACLES } from "../src/world-layout.ts";

function gateScene() {
  const root = new T.Group();
  const stone = new T.MeshBasicMaterial();
  const materials = {
    ashlar: stone,
    dressed: stone,
    recess: stone,
    iron: stone,
    standard: stone,
  };
  const masonry = WALLS.filter((w) => w.id.startsWith("gate-"));
  for (const wall of masonry)
    gateWall(wall, materials, (mesh) => root.add(mesh));
  const doors = blackGate(new T.Texture());
  doors.position.set(gate.x, 0, gate.z);
  root.add(doors);
  root.updateMatrixWorld(true);
  const ray = new T.Raycaster();
  const hit = (x, y, side = 1) => {
    ray.set(new T.Vector3(x, y, gate.z + side * 5), new T.Vector3(0, 0, -side));
    ray.far = 10;
    return ray.intersectObject(root, true)[0];
  };
  return { root, doors, hit };
}

test("shut oak leaves and solid masonry close the full span from both approaches", () => {
  const { hit } = gateScene();
  for (const side of [-1, 1])
    for (const x of [
      -1.64, -1.57, -1.1, -0.31, -0.005, 0.005, 0.82, 1.55, 1.64,
    ])
      for (const y of [
        0.12, 1.7, 2.78, 3.06, 3.119, 3.134, 3.68, 4.19, 4.35, 5.48,
      ])
        assert.ok(hit(x, y, side), `Daylight at x=${x}, y=${y}, side=${side}`);
  const header = OBSTACLES.find((o) => o.id === "gate-header");
  const closed = OBSTACLES.find((o) => o.door === "gate");
  assert.ok(header.minY <= closed.maxY && closed.maxY >= gate.clearance);
});

test("both swings clear a standing traveller while the lintel and flanks stay solid", () => {
  const { root, doors, hit } = gateScene();
  assert.equal(doors.children.length, 2);
  const boundary = gate.width / 2;
  for (let step = -12; step <= 12; step++) {
    for (const pivot of doors.children) {
      const sign = pivot.name === "GateLeft" ? 1 : -1;
      pivot.rotation.y = (sign * gate.swing * step) / 12;
      // Test actual timber vertices: a transformed bounding box would also
      // include empty corners around the rounded pivot.
      const timber = pivot.children[0].children[0];
      timber.updateWorldMatrix(true, false);
      const p = new T.Vector3();
      for (let i = 0; i < timber.geometry.attributes.position.count; i++) {
        p.fromBufferAttribute(
          timber.geometry.attributes.position,
          i,
        ).applyMatrix4(timber.matrixWorld);
        assert.ok(
          Math.abs(p.x) <= boundary + 0.001,
          `Timber entered masonry at angle ${pivot.rotation.y}`,
        );
      }
    }
  }
  for (const direction of [-1, 1]) {
    doors.getObjectByName("GateLeft").rotation.y = direction * gate.swing;
    doors.getObjectByName("GateRight").rotation.y = -direction * gate.swing;
    root.updateMatrixWorld(true);
    for (const side of [-1, 1]) {
      for (const x of [-1.1, 0, 1.1]) {
        for (const y of [0.16, 1.7, 2.96])
          assert.equal(hit(x, y, side), undefined);
        for (const y of [3.13, 3.8, 4.22, 5.3]) assert.ok(hit(x, y, side));
      }
      for (const x of [-7.2, -2.85, 2.85, 7.2]) assert.ok(hit(x, 1.3, side));
    }
  }
});
