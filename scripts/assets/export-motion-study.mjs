// Offline posed-skin study data for asset authoring. No game or browser control.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { Matrix4, Vector3 } from "three";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { structure, sample, world, position } from "./pose-sampling.mjs";
const project = fileURLToPath(new URL("../../", import.meta.url));
const character = process.argv[2] ?? "prisoner";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const modelFile =
  character === "knight" ? "knight/knight.glb" : `cast/${character}.glb`;
const motionFile =
  character === "knight" ? "combat.glb" : `${character}-combat.glb`;
const doc = await io.read(`${project}/public/assets/${modelFile}`),
  info = structure(doc);
const motion = await io.read(`${project}/public/assets/motion/${motionFile}`);
const meshes = [];
for (const node of info.nodes) {
  const mesh = node.getMesh(),
    skin = node.getSkin();
  if (!mesh || !skin) continue;
  for (const primitive of mesh.listPrimitives())
    meshes.push({
      pos: primitive.getAttribute("POSITION").getArray(),
      joints: primitive.getAttribute("JOINTS_0").getArray(),
      weights: primitive.getAttribute("WEIGHTS_0").getArray(),
      boneNodes: skin.listJoints(),
      inverse: skin.getInverseBindMatrices().getArray(),
      indices: [...primitive.getIndices().getArray()],
    });
}
const clips = [];
for (const animation of motion.getRoot().listAnimations()) {
  const name = animation.getName();
  if (!name.startsWith("Dodge") && !name.startsWith("Death")) continue;
  const duration = animation.listSamplers()[0].getInput().getArray().at(-1);
  const times = name.startsWith("Dodge")
    ? [0, 0.12, 0.24, 0.34, 0.44, 0.55, 0.66, 0.82]
    : [0, 0.16, 0.35, 0.55, 0.75, 1, 1.3, duration];
  const frames = times.map((time) => {
    const pose = sample(info, animation, time),
      cache = new Map();
    const posedMeshes = meshes.map((mesh) => {
      const ms = mesh.boneNodes.map((bone, i) =>
        world(info, pose, bone, cache).multiply(
          new Matrix4().fromArray(mesh.inverse, i * 16),
        ),
      );
      const vertices = [];
      for (let i = 0; i < mesh.pos.length / 3; i++) {
        const p = new Vector3().fromArray(mesh.pos, i * 3),
          deformed = new Vector3();
        for (let k = 0; k < 4; k++) {
          const weight = mesh.weights[i * 4 + k];
          if (weight)
            deformed.addScaledVector(
              p.clone().applyMatrix4(ms[mesh.joints[i * 4 + k]]),
              weight,
            );
        }
        vertices.push(
          ...deformed.toArray().map((v) => Math.round(v * 100000) / 100000),
        );
      }
      return { vertices, indices: mesh.indices };
    });
    const handWorld = world(info, pose, info.byName.get("hand_R"));
    return {
      time,
      meshes: posedMeshes,
      joints: Object.fromEntries(
        [...info.byName]
          .filter(
            ([name]) =>
              name === "pelvis" ||
              name === "head" ||
              /^(upperarm|forearm|hand|thigh|shin|foot|toe)_/.test(name),
          )
          .map(([name, n]) => [name, position(info, pose, n).toArray()]),
      ),
      sword: [
        new Vector3(0, 0.06, 0).applyMatrix4(handWorld).toArray(),
        new Vector3(0, 0.06, -0.9).applyMatrix4(handWorld).toArray(),
      ],
    };
  });
  clips.push({ name, duration, frames });
}
await mkdir(`${project}/work/asset-authoring`, { recursive: true });
await writeFile(
  `${project}/work/asset-authoring/${character}-motion-study.json`,
  JSON.stringify(clips),
);
console.log(
  JSON.stringify({ character, clips: clips.length, meshes: meshes.length }),
);
