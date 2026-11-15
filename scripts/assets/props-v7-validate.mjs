import { NodeIO } from "@gltf-transform/core";
import * as T from "three";
import { readFile, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  sharp = require("sharp");
const project = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  ),
  out = path.join(project, "public/assets/props-v7");
const io = new NodeIO(),
  contract = JSON.parse(
    await readFile(path.join(out, "contract.json"), "utf8"),
  );
const models = new Map(),
  report = {
    models: [],
    cavity: [],
    weaponDisplay: [],
    textureSizes: [],
    mimicMotion: [],
  };
function asThree(doc) {
  const nodes = new Map();
  for (const n of doc.getRoot().listNodes()) {
    const object = new T.Group();
    object.name = n.getName();
    object.position.fromArray(n.getTranslation());
    object.quaternion.fromArray(n.getRotation());
    object.scale.fromArray(n.getScale());
    for (const p of n.getMesh()?.listPrimitives() || []) {
      const g = new T.BufferGeometry().setAttribute(
        "position",
        new T.BufferAttribute(p.getAttribute("POSITION").getArray(), 3),
      );
      g.setIndex(new T.BufferAttribute(p.getIndices().getArray(), 1));
      object.add(
        new T.Mesh(g, new T.MeshBasicMaterial({ side: T.DoubleSide })),
      );
    }
    nodes.set(n, object);
  }
  for (const [n, o] of nodes)
    for (const c of n.listChildren()) o.add(nodes.get(c));
  const group = new T.Group();
  for (const n of doc.getRoot().listScenes()[0].listChildren())
    group.add(nodes.get(n));
  group.updateMatrixWorld(true);
  return group;
}
for (const name of [
  "chest",
  "mimic",
  "weapon-sword",
  "weapon-axe",
  "weapon-spear",
  "key",
  "coins",
  "door",
]) {
  const file = path.join(out, name + ".glb"),
    doc = await io.read(file),
    root = doc.getRoot(),
    bytes = (await stat(file)).size;
  assert(bytes < 3_000_000, `${name}: file exceeds 3MB`);
  for (const p of root.listMeshes().flatMap((m) => m.listPrimitives())) {
    const count = p.getAttribute("POSITION").getCount();
    assert(
      [...p.getIndices().getArray()].every((i) => i < count),
      `${name}: invalid indices`,
    );
    for (const attr of p.listAttributes())
      assert.equal(attr.getCount(), count, `${name}: attribute mismatch`);
    assert(
      [...p.getAttribute("POSITION").getArray()].every(Number.isFinite),
      `${name}: non-finite positions`,
    );
  }
  for (const texture of root.listTextures()) {
    assert(texture.getImage()?.length, `${name}: external or missing image`);
    const metadata = await sharp(texture.getImage()).metadata();
    assert(
      metadata.width <= 512 && metadata.height <= 512,
      `${name}: texture exceeds 512px`,
    );
    report.textureSizes.push({
      model: name,
      name: texture.getName(),
      width: metadata.width,
      height: metadata.height,
    });
  }
  for (const animation of root.listAnimations())
    for (const sampler of animation.listSamplers()) {
      const times = [...sampler.getInput().getArray()];
      assert(
        times.every(
          (t, i) => Number.isFinite(t) && (i === 0 || t > times[i - 1]),
        ),
        `${name}: invalid animation time`,
      );
      assert(
        [...sampler.getOutput().getArray()].every(Number.isFinite),
        `${name}: invalid animation values`,
      );
      assert.equal(
        sampler.getOutput().getCount(),
        times.length,
        `${name}: invalid animation sample count`,
      );
    }
  const object = asThree(doc),
    bounds = new T.Box3().setFromObject(object),
    details = {
      name,
      bytes,
      bounds: {
        min: bounds.min.toArray(),
        max: bounds.max.toArray(),
        size: bounds.getSize(new T.Vector3()).toArray(),
      },
    };
  models.set(name, { doc, object, details });
  report.models.push(details);
}
function sampleAnimation(doc, object, animation, t) {
  for (const node of doc.getRoot().listNodes()) {
    const target = object.getObjectByName(node.getName());
    if (!target) continue;
    target.position.fromArray(node.getTranslation());
    target.quaternion.fromArray(node.getRotation());
    target.scale.fromArray(node.getScale());
  }
  for (const channel of animation.listChannels()) {
    const target = object.getObjectByName(channel.getTargetNode().getName()),
      sampler = channel.getSampler(),
      times = sampler.getInput().getArray(),
      values = sampler.getOutput().getArray(),
      stride = sampler.getOutput().getElementSize();
    let index = 0;
    while (index < times.length - 2 && times[index + 1] < t) index++;
    const alpha = T.MathUtils.clamp(
        (t - times[index]) / (times[index + 1] - times[index]),
        0,
        1,
      ),
      a = values.slice(index * stride, (index + 1) * stride),
      b = values.slice((index + 1) * stride, (index + 2) * stride);
    if (channel.getTargetPath() === "rotation")
      target.quaternion
        .fromArray(a)
        .slerp(new T.Quaternion().fromArray(b), alpha);
    else
      (channel.getTargetPath() === "translation"
        ? target.position
        : target.scale
      )
        .fromArray(a)
        .lerp(new T.Vector3().fromArray(b), alpha);
  }
  object.updateMatrixWorld(true);
}
{
  const { doc, object } = models.get("mimic"),
    tongue = object.getObjectByName("TongueRoot"),
    vertex = new T.Vector3();
  for (const animation of doc.getRoot().listAnimations()) {
    const duration = Math.max(
        ...animation
          .listSamplers()
          .map((s) => s.getInput().getMaxNormalized([0])[0]),
      ),
      samples = Math.ceil(duration * 120);
    let wallPoints = 0,
      minY = Infinity;
    for (let sample = 0; sample <= samples; sample++) {
      sampleAnimation(doc, object, animation, (sample / samples) * duration);
      tongue.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const positions = mesh.geometry.getAttribute("position");
        for (let i = 0; i < positions.count; i++) {
          vertex
            .fromBufferAttribute(positions, i)
            .applyMatrix4(mesh.matrixWorld);
          if (vertex.z > 0.225 && vertex.z < 0.265) {
            wallPoints++;
            minY = Math.min(minY, vertex.y);
            assert(
              vertex.y > 0.395,
              `Mimic ${animation.getName()}: tongue intersects front wooden wall at ${(sample / samples) * duration}s, y=${vertex.y}`,
            );
          }
        }
      });
    }
    report.mimicMotion.push({
      clip: animation.getName(),
      samples: samples + 1,
      frontWallCrossingVertices: wallPoints,
      minCrossingY: wallPoints ? minY : null,
    });
  }
}
for (const name of ["chest", "mimic"]) {
  const { doc, object } = models.get(name),
    body = object.getObjectByName("ChestBody");
  assert(body, `${name}: ChestBody missing`);
  for (const [x, z] of [
    [0, 0],
    [0.2, 0.1],
    [-0.2, -0.1],
    [0, 0.15],
    [0.35, 0],
  ]) {
    const hit = new T.Raycaster(
      new T.Vector3(x, 2, z),
      new T.Vector3(0, -1, 0),
    ).intersectObject(body, true)[0];
    assert(
      hit && hit.point.y < 0.065 && hit.point.y > -0.01,
      `${name}: interior is capped or missing`,
    );
    report.cavity.push({ name, x, z, floorY: hit.point.y });
  }
  const lid = object.getObjectByName("ChestLid");
  assert(lid);
  lid.rotation.x = -1.75;
  object.updateMatrixWorld(true);
  assert(
    new T.Box3().setFromObject(lid).max.y > 0.85,
    `${name}: lid does not open upwards`,
  );
  assert(
    doc
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === "LootAnchor")
      .listChildren().length === 0,
    "LootAnchor must be empty",
  );
  if (name === "mimic")
    for (const part of [
      "UpperTeeth",
      "LowerTeeth",
      "TongueRoot",
      "TongueMid",
      "TongueTip",
      "LowerGums",
      "UpperGums",
      "MouthFloor",
    ])
      assert(object.getObjectByName(part), `Mimic anatomy missing: ${part}`);
}
contract.chest.weaponDisplay.offsets = {
  sword: [0, 0, 0],
  axe: [0, 0, 0],
  spear: [-0.045, 0, 0],
};
for (const name of ["sword", "axe", "spear"]) {
  const weapon = models.get("weapon-" + name).object;
  weapon.rotation.set(...contract.chest.weaponDisplay.rotationEulerXYZ);
  weapon.scale.setScalar(contract.chest.weaponDisplay.scales[name]);
  weapon.position
    .fromArray(contract.chest.lootAnchorPosition)
    .add(new T.Vector3(...contract.chest.weaponDisplay.offsets[name]));
  weapon.updateMatrixWorld(true);
  const b = new T.Box3().setFromObject(weapon),
    limits = contract.chest.interiorBounds;
  assert(
    b.min.x >= limits.min[0] && b.max.x <= limits.max[0],
    `${name}: display exceeds cavity width`,
  );
  assert(
    b.min.z >= limits.min[2] && b.max.z <= limits.max[2],
    `${name}: display exceeds cavity depth`,
  );
  assert(
    b.min.y >= limits.min[1] && b.max.y <= limits.max[1],
    `${name}: display intersects floor/lid`,
  );
  report.weaponDisplay.push({
    name,
    scale: contract.chest.weaponDisplay.scales[name],
    offset: contract.chest.weaponDisplay.offsets[name],
    bounds: { min: b.min.toArray(), max: b.max.toArray() },
  });
}
const door = models.get("door").object,
  pivot = door.getObjectByName("DoorPivot"),
  leaf = door.getObjectByName("DoorLeaf");
const ray = new T.Raycaster(new T.Vector3(0, 1, 2), new T.Vector3(0, 0, -1));
assert(
  ray.intersectObject(leaf, true).length > 0,
  "Closed door must block the doorway",
);
pivot.rotation.y = -1.55;
door.updateMatrixWorld(true);
assert.equal(
  ray.intersectObject(leaf, true).length,
  0,
  "Open door must leave the central doorway clear",
);
contract.door.outerDimensions = models.get("door").details.bounds.size;
contract.chest.closedBounds = models.get("chest").details.bounds;
contract.mimic.closedBounds = models.get("mimic").details.bounds;
contract.validation = {
  hollowCavityRays: 10,
  weaponDisplaysFit: true,
  doorClearsOpening: true,
  allAccessorCountsValid: true,
  allEmbeddedImagesMax512: true,
  mimicTongueClearsFrontWallAt120Hz: true,
};
for (const name of ["sword", "axe", "spear"])
  contract.weapons[name].dimensions = models.get(
    "weapon-" + name,
  ).details.bounds.size;
await writeFile(
  path.join(out, "contract.json"),
  JSON.stringify(contract, null, 2),
);
await writeFile(
  path.join(project, "work/props-v7/validation-report.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      status: "passed",
      files: report.models.map((m) => ({
        name: m.name,
        bytes: m.bytes,
        dimensions: m.bounds.size,
      })),
      cavityRays: report.cavity,
      weaponDisplay: report.weaponDisplay,
      mimicMotion: report.mimicMotion,
      allEmbeddedImagesMax512: true,
      doorClearsOpening: true,
    },
    null,
    2,
  ),
);
