// Geometric regression check for the separate UAL2-derived sword motions.
// Run from project root with Node 26. Does not edit runtime source or assets.
import assert from "node:assert/strict";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "../../node_modules/three/build/three.module.js";
import { MeshBVH } from "../../node_modules/three-mesh-bvh/build/index.module.js";
import { armourModel } from "../../src/gear-visuals.ts";
import { structure, sample, position } from "./pose-sampling.mjs";
import { threeRig, setPose } from "./three-rig.mjs";

const project = fileURLToPath(new URL("../../", import.meta.url));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(resolve(project, "public/assets/cast/prisoner.glb"));
const motion = await io.read(
  resolve(project, "public/assets/motion/prisoner-fixes1.glb"),
);
const floor = JSON.parse(
  await readFile(resolve(project, "public/assets/motion/fixes1-floor.json")),
).profiles.prisoner;
const rig = threeRig(doc),
  info = structure(doc);
const armour = armourModel(rig.root);
armour.position.set(0, 1.16, 0.01);
rig.root.add(armour);
rig.root.updateMatrixWorld(true);
rig.root.getObjectByName("chest").attach(armour);
rig.root.updateMatrixWorld(true);
const plates = [];
armour.traverse((o) => {
  if (o.isMesh) {
    o.geometry.computeBoundingBox();
    plates.push({ mesh: o, bvh: new MeshBVH(o.geometry) });
  }
});
assert(plates.length > 0, "Actual armour main meshes are missing");
const legs = [];
rig.root.traverse((o) => {
  if (!o.isSkinnedMesh) return;
  const j = o.geometry.getAttribute("skinIndex"),
    w = o.geometry.getAttribute("skinWeight");
  if (!j || !w) return;
  const used = o.geometry.index
    ? [...new Set(o.geometry.index.array)]
    : Array.from({ length: j.count }, (_, i) => i);
  const vertices = used.filter((i) => {
    let weight = 0;
    for (let k = 0; k < 4; k++)
      if (
        /^(thigh|shin|foot|toe)_/.test(
          o.skeleton.bones[j.getComponent(i, k)].name,
        )
      )
        weight += w.getComponent(i, k);
    return weight > 0.65;
  });
  if (vertices.length) legs.push({ mesh: o, vertices });
});
assert(
  legs.reduce((sum, l) => sum + l.vertices.length, 0) > 100,
  "Actual indexed leg geometry is missing",
);
const point = new THREE.Vector3(),
  front = new THREE.Ray(),
  back = new THREE.Ray(),
  results = [];
for (const clip of motion
  .getRoot()
  .listAnimations()
  .filter((a) => a.getName().startsWith("Sword"))) {
  const duration = clip.getExtras().semanticDuration,
    curve = floor.clips[clip.getName()];
  let minPelvis = Infinity,
    maxLean = 0,
    maxKneeArmourY = -Infinity,
    maxLegPenetration = 0,
    insideVertices = 0,
    worst;
  for (let frame = 0; frame <= Math.ceil(duration * 120); frame++) {
    const t = Math.min(duration, frame / 120),
      pose = sample(info, clip, t),
      hip = position(info, pose, info.byName.get("pelvis")),
      axis = position(info, pose, info.byName.get("neck")).sub(hip);
    const lean =
      (Math.acos(Math.max(-1, Math.min(1, axis.y / axis.length()))) * 180) /
      Math.PI;
    const i = Math.min(curve.offsets.length - 2, Math.floor(t * 60)),
      a = i / 60,
      b = Math.min(curve.duration, (i + 1) / 60),
      u = b > a ? (t - a) / (b - a) : 0,
      offset = curve.offsets[i] * (1 - u) + curve.offsets[i + 1] * u;
    minPelvis = Math.min(minPelvis, hip.y + offset);
    maxLean = Math.max(maxLean, lean);
    setPose(rig, pose);
    const inverse = armour.matrixWorld.clone().invert();
    for (const side of ["L", "R"])
      maxKneeArmourY = Math.max(
        maxKneeArmourY,
        new THREE.Vector3()
          .copy(position(info, pose, info.byName.get("shin_" + side)))
          .applyMatrix4(inverse).y,
      );
    // The full sweep measures posture. Actual indexed leg/plate volume is
    // checked at 60 Hz, independent of any shader visibility/coverage mask.
    if (frame % 2) continue;
    const transforms = plates.map((p) => ({
      ...p,
      inverse: p.mesh.matrixWorld.clone().invert(),
    }));
    for (const leg of legs) {
      leg.mesh.skeleton.update();
      for (const vertex of leg.vertices) {
        leg.mesh
          .getVertexPosition(vertex, point)
          .applyMatrix4(leg.mesh.matrixWorld);
        for (const plate of transforms) {
          const local = point.clone().applyMatrix4(plate.inverse);
          // Include the actual lower rim and all main-piece bounds. Pelvis
          // fauld and shoulders are separately articulated objects.
          const bounds = plate.mesh.geometry.boundingBox;
          if (
            local.y < bounds.min.y ||
            local.y > bounds.max.y ||
            local.x < bounds.min.x ||
            local.x > bounds.max.x
          )
            continue;
          front.origin.copy(local).add(new THREE.Vector3(0, 0, 2));
          front.direction.set(0, 0, -1);
          back.origin.copy(local).add(new THREE.Vector3(0, 0, -2));
          back.direction.set(0, 0, 1);
          const entry = plate.bvh.raycastFirst(front, THREE.DoubleSide),
            exit = plate.bvh.raycastFirst(back, THREE.DoubleSide);
          if (!entry || !exit) continue;
          const penetration = Math.min(
            entry.point.z - local.z,
            local.z - exit.point.z,
          );
          if (penetration > 0.002) {
            insideVertices++;
            if (penetration > maxLegPenetration) {
              maxLegPenetration = penetration;
              worst = {
                time: t,
                mesh: leg.mesh.name,
                vertex,
                local: local.toArray(),
              };
            }
          }
        }
      }
    }
  }
  results.push({
    clip: clip.getName(),
    minGroundedPelvisY: minPelvis,
    maxPelvisToNeckTiltDegrees: maxLean,
    maxKneeArmourLocalY: maxKneeArmourY,
    mainPlateInsideLegVertices: insideVertices,
    maxLegPenetration,
    worst,
  });
}
const report = {
  method:
    "Actual indexed, weighted source leg vertices and real runtime main-cuirass geometry. Raycast volume tests do not consult shader masks. Posture sampled at120Hz, geometry at60Hz.",
  results,
};
await mkdir(resolve(project, "work/fixes1/references"), { recursive: true });
await writeFile(
  resolve(project, "work/fixes1/references/sword-body-regression-after.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
for (const r of results) {
  assert(
    r.minGroundedPelvisY >= 0.699,
    `${r.clip}: grounded pelvis below .699m`,
  );
  assert(
    r.maxPelvisToNeckTiltDegrees <= 40.2,
    `${r.clip}: torso tilt exceeds40.2deg`,
  );
  assert.equal(
    r.mainPlateInsideLegVertices,
    0,
    `${r.clip}: real leg geometry enters the main cuirass`,
  );
}
