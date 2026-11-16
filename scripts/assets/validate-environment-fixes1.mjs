import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { createForest } from "../../src/forest.ts";
import { TREES, OBSTACLES } from "../../src/world-layout.ts";

process.chdir(fileURLToPath(new URL("../../", import.meta.url)));

const forest = createForest(
  TREES,
  new THREE.MeshStandardMaterial(),
  new THREE.Texture(),
  new THREE.Texture(),
  OBSTACLES,
);
const matrix = new THREE.Matrix4(),
  center = new THREE.Vector3(),
  v = new THREE.Vector3(),
  scale = new THREE.Vector3();
const rows = [];
let outsideTrunk = 0,
  fernCrossings = 0,
  standingVertices = 0;
for (const mesh of forest.children) {
  if (!mesh.isInstancedMesh) continue;
  rows.push({
    name: mesh.name,
    instances: mesh.count,
    triangles:
      ((mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) /
        3) *
      mesh.count,
  });
  const vertices = mesh.geometry.attributes.position;
  for (let i = 0; i < vertices.count; i++)
    assert(
      [vertices.getX(i), vertices.getY(i), vertices.getZ(i)].every(
        Number.isFinite,
      ),
    );
  if (mesh.name.startsWith("Branched"))
    for (let j = 0; j < mesh.count; j++) {
      mesh.getMatrixAt(j, matrix);
      center.setFromMatrixPosition(matrix);
      const obstacle = OBSTACLES.find(
        (o) =>
          Math.abs(o.x - center.x) < 0.001 && Math.abs(o.z - center.z) < 0.001,
      );
      if (!obstacle) continue;
      for (let i = 0; i < vertices.count; i++) {
        v.fromBufferAttribute(vertices, i).applyMatrix4(matrix);
        if (v.y < 0.3 || v.y > 1.9) continue;
        standingVertices++;
        if (
          Math.abs(v.x - obstacle.x) > obstacle.hx + 0.01 ||
          Math.abs(v.z - obstacle.z) > obstacle.hz + 0.01
        )
          outsideTrunk++;
      }
    }
  if (mesh.name === "ForestUnderstory")
    for (let j = 0; j < mesh.count; j++) {
      mesh.getMatrixAt(j, matrix);
      center.setFromMatrixPosition(matrix);
      scale.setFromMatrixScale(matrix);
      let radius = 0;
      for (let i = 0; i < vertices.count; i++)
        radius = Math.max(
          radius,
          Math.hypot(vertices.getX(i) * scale.x, vertices.getZ(i) * scale.z),
        );
      for (const obstacle of OBSTACLES) {
        if (
          (obstacle.minY ?? -Infinity) > 0.8 ||
          (obstacle.maxY ?? Infinity) < 0
        )
          continue;
        const dx = Math.max(0, Math.abs(center.x - obstacle.x) - obstacle.hx),
          dz = Math.max(0, Math.abs(center.z - obstacle.z) - obstacle.hz);
        if (dx * dx + dz * dz < radius * radius) fernCrossings++;
      }
    }
}
assert.equal(
  outsideTrunk,
  0,
  "Visible standing trunk exceeds its physical collider",
);
assert.equal(fernCrossings, 0, "A fern intersects a hard ground-level solid");
const report = {
  trees: TREES.length,
  drawCalls: rows.length,
  triangles: rows.reduce((s, r) => s + r.triangles, 0),
  standingVerticesChecked: standingVertices,
  outsideTrunk,
  fernCrossings,
  rows,
};
await mkdir("work/fixes1", { recursive: true });
await writeFile(
  "work/fixes1/environment-geometry.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
