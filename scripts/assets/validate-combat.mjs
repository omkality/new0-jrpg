import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { Matrix4, Vector3, Quaternion } from "three";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { animationDigest } from "./animation-io.mjs";

const project = fileURLToPath(new URL("../../", import.meta.url));
const inputDirectory = process.argv[2]
  ? resolve(project, process.argv[2])
  : resolve(project, "public/assets/motion");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const expected = {
  Death: 1.6,
  Attack1: 0.74,
  Attack2: 0.7,
  Attack3: 1,
  DodgeLeft: 0.52,
  DodgeRight: 0.52,
  DodgeBack: 0.52,
  DodgeForward: 0.52,
  HitFront: 0.4,
  HitLeft: 0.42,
  HitRight: 0.46,
  Guard: 0.8,
  BlockHit: 0.32,
};
function structure(doc) {
  const nodes = doc.getRoot().listNodes(),
    byName = new Map(nodes.map((n) => [n.getName(), n])),
    parent = new Map();
  for (const node of nodes)
    for (const child of node.listChildren()) parent.set(child, node);
  const base = new Map(
    nodes.map((n) => [
      n,
      {
        p: new Vector3().fromArray(n.getTranslation()),
        q: new Quaternion().fromArray(n.getRotation()),
        s: new Vector3().fromArray(n.getScale()),
      },
    ]),
  );
  return { nodes, byName, parent, base };
}
function world(info, pose, node, cache = new Map()) {
  if (cache.has(node)) return cache.get(node);
  const t = pose.get(node),
    m = new Matrix4().compose(t.p, t.q, t.s);
  if (info.parent.has(node))
    m.premultiply(world(info, pose, info.parent.get(node), cache));
  cache.set(node, m);
  return m;
}
function position(info, pose, node) {
  return new Vector3().setFromMatrixPosition(world(info, pose, node));
}
function rotation(info, pose, node) {
  const p = new Vector3(),
    q = new Quaternion(),
    s = new Vector3();
  world(info, pose, node).decompose(p, q, s);
  return q.normalize();
}
function sample(info, animation, t) {
  const pose = new Map(
    [...info.base].map(([n, s]) => [
      n,
      { p: s.p.clone(), q: s.q.clone(), s: s.s.clone() },
    ]),
  );
  for (const channel of animation.listChannels()) {
    const sampler = channel.getSampler(),
      times = sampler.getInput().getArray(),
      values = sampler.getOutput().getArray(),
      path = channel.getTargetPath();
    const node = info.byName.get(channel.getTargetNode().getName());
    assert.ok(node);
    let i = 0;
    while (i < times.length - 2 && times[i + 1] < t) i++;
    const j = Math.min(i + 1, times.length - 1),
      f =
        times[j] === times[i]
          ? 0
          : Math.max(0, Math.min(1, (t - times[i]) / (times[j] - times[i])));
    if (path === "rotation")
      pose
        .get(node)
        .q.fromArray(values, i * 4)
        .slerp(new Quaternion().fromArray(values, j * 4), f)
        .normalize();
    else if (path === "translation")
      pose
        .get(node)
        .p.fromArray(values, i * 3)
        .lerp(new Vector3().fromArray(values, j * 3), f);
    else assert.fail(`Unexpected animation path ${path}`);
  }
  return pose;
}
function weightedMeshes(info) {
  const out = [];
  for (const node of info.nodes) {
    const mesh = node.getMesh(),
      skin = node.getSkin();
    if (!mesh || !skin) continue;
    for (const primitive of mesh.listPrimitives())
      out.push({
        positions: primitive.getAttribute("POSITION").getArray(),
        joints: primitive.getAttribute("JOINTS_0").getArray(),
        weights: primitive.getAttribute("WEIGHTS_0").getArray(),
        bones: skin.listJoints(),
        inverse: skin.getInverseBindMatrices().getArray(),
      });
  }
  assert.ok(out.length);
  return out;
}
function minimumY(info, pose, meshes) {
  let minimum = Infinity;
  const cache = new Map();
  for (const mesh of meshes) {
    const matrices = mesh.bones.map(
      (n, i) =>
        world(info, pose, n, cache)
          .clone()
          .multiply(new Matrix4().fromArray(mesh.inverse, i * 16)).elements,
    );
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      const x = mesh.positions[i * 3],
        y = mesh.positions[i * 3 + 1],
        z = mesh.positions[i * 3 + 2];
      let py = 0;
      for (let k = 0; k < 4; k++) {
        const w = mesh.weights[i * 4 + k];
        if (!w) continue;
        const m = matrices[mesh.joints[i * 4 + k]];
        py += w * (m[1] * x + m[5] * y + m[9] * z + m[13]);
      }
      minimum = Math.min(minimum, py);
    }
  }
  return minimum;
}
function surfaceDelta(info, a, b, meshes) {
  let maximum = 0;
  for (const mesh of meshes) {
    const am = mesh.bones.map(
      (n, i) =>
        world(info, a, n)
          .clone()
          .multiply(new Matrix4().fromArray(mesh.inverse, i * 16)).elements,
    );
    const bm = mesh.bones.map(
      (n, i) =>
        world(info, b, n)
          .clone()
          .multiply(new Matrix4().fromArray(mesh.inverse, i * 16)).elements,
    );
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      const x = mesh.positions[i * 3],
        y = mesh.positions[i * 3 + 1],
        z = mesh.positions[i * 3 + 2];
      let dx = 0,
        dy = 0,
        dz = 0;
      for (let k = 0; k < 4; k++) {
        const w = mesh.weights[i * 4 + k];
        if (!w) continue;
        const aa = am[mesh.joints[i * 4 + k]],
          bb = bm[mesh.joints[i * 4 + k]];
        dx +=
          w *
          ((aa[0] - bb[0]) * x +
            (aa[4] - bb[4]) * y +
            (aa[8] - bb[8]) * z +
            aa[12] -
            bb[12]);
        dy +=
          w *
          ((aa[1] - bb[1]) * x +
            (aa[5] - bb[5]) * y +
            (aa[9] - bb[9]) * z +
            aa[13] -
            bb[13]);
        dz +=
          w *
          ((aa[2] - bb[2]) * x +
            (aa[6] - bb[6]) * y +
            (aa[10] - bb[10]) * z +
            aa[14] -
            bb[14]);
      }
      maximum = Math.max(maximum, Math.hypot(dx, dy, dz));
    }
  }
  return maximum;
}
const reports = [];
for (const [file, model, seed] of [
  ["combat.glb", "public/assets/knight/knight.glb", "death-knight.glb"],
  [
    "prisoner-combat.glb",
    "public/assets/cast/prisoner.glb",
    "death-prisoner.glb",
  ],
  ["gaoler-combat.glb", "public/assets/cast/gaoler.glb", "death-gaoler.glb"],
]) {
  const doc = await io.read(resolve(inputDirectory, file)),
    root = doc.getRoot();
  assert.equal(root.listAnimations().length, 13);
  assert.equal(root.listMeshes().length, 0);
  assert.equal(root.listSkins().length, 0);
  assert.equal(root.listTextures().length, 0);
  const animations = new Map(
    root.listAnimations().map((a) => [a.getName(), a]),
  );
  for (const [name, duration] of Object.entries(expected)) {
    const a = animations.get(name);
    assert.ok(a, `Missing ${name}`);
    assert.equal(a.listChannels().length, 44);
    for (const channel of a.listChannels()) {
      assert.ok(["translation", "rotation"].includes(channel.getTargetPath()));
      const sampler = channel.getSampler(),
        times = sampler.getInput().getArray(),
        values = sampler.getOutput().getArray();
      assert.ok(
        Math.abs(times.at(-1) - duration) < 1e-5,
        `${file}/${name}: duration ${times.at(-1)} != ${duration}`,
      );
      assert.ok(times[0] === 0);
      for (let i = 1; i < times.length; i++) {
        assert.ok(times[i] > times[i - 1]);
        assert.ok(
          times[i] - times[i - 1] <= 1 / 60 + 1e-6,
          `${name} has a gap over 1/60s`,
        );
      }
      assert.ok([...values].every(Number.isFinite));
      if (channel.getTargetPath() === "rotation")
        for (let i = 0; i < values.length; i += 4) {
          const q = new Quaternion().fromArray(values, i);
          assert.ok(Math.abs(q.lengthSq() - 1) < 1e-5);
        }
    }
  }
  const seedDoc = await io.read(
    fileURLToPath(new URL(`./seeds/${seed}`, import.meta.url)),
  );
  assert.equal(
    animationDigest(animations.get("Death")),
    animationDigest(seedDoc.getRoot().listAnimations()[0]),
    `${file}: approved death changed`,
  );
  const modelDoc = await io.read(resolve(project, model)),
    info = structure(modelDoc),
    meshes = weightedMeshes(info);
  const joints = meshes[0].bones,
    hand = info.byName.get("hand_R"),
    seams = [];
  for (const [from, link, to] of [
    ["Attack1", 0.52, "Attack2"],
    ["Attack2", 0.51, "Attack3"],
  ]) {
    const a = sample(info, animations.get(from), link),
      b = sample(info, animations.get(to), 0);
    const maxPosition = Math.max(
      ...joints.map((n) =>
        position(info, a, n).distanceTo(position(info, b, n)),
      ),
    );
    const maxAngle = Math.max(
      ...joints.map((n) => rotation(info, a, n).angleTo(rotation(info, b, n))),
    );
    const maxSurface = surfaceDelta(info, a, b, meshes);
    assert.ok(
      maxPosition < 2e-5,
      `${file}: ${from}/${to} position seam ${maxPosition}`,
    );
    assert.ok(
      maxAngle < 5e-4,
      `${file}: ${from}/${to} rotation seam ${maxAngle}`,
    );
    assert.ok(
      maxSurface < 3e-5,
      `${file}: ${from}/${to} skin seam ${maxSurface}`,
    );
    const h = 1 / 240,
      pre = sample(info, animations.get(from), link - h),
      post = sample(info, animations.get(to), h);
    const incoming = position(info, a, hand)
        .sub(position(info, pre, hand))
        .divideScalar(h),
      outgoing = position(info, post, hand)
        .sub(position(info, b, hand))
        .divideScalar(h);
    seams.push({
      from,
      link,
      to,
      maxPosition,
      maxAngle,
      maxSurface,
      handVelocityDelta: incoming.distanceTo(outgoing),
    });
  }
  let minFloor = Infinity,
    maxFloor = -Infinity;
  for (const [name, duration] of Object.entries(expected))
    for (let i = 0; i <= Math.ceil(duration * 60); i++) {
      const t = Math.min(duration, i / 60),
        floor = minimumY(info, sample(info, animations.get(name), t), meshes);
      minFloor = Math.min(minFloor, floor);
      maxFloor = Math.max(maxFloor, floor);
    }
  assert.ok(minFloor >= -0.005, `${file}: floor penetration ${minFloor}`);
  assert.ok(maxFloor < 0.04, `${file}: unexplained floating ${maxFloor}`);
  reports.push({
    file,
    bytes: (await stat(resolve(inputDirectory, file))).size,
    clips: 13,
    channelsEach: 44,
    finiteNormalized: true,
    deathUnchanged: true,
    minFloor,
    maxFloor,
    seams,
  });
}
const work = resolve(project, "work/asset-authoring");
await mkdir(work, { recursive: true });
await writeFile(
  resolve(work, "validation-report.json"),
  JSON.stringify(reports, null, 2) + "\n",
);
console.log(JSON.stringify(reports, null, 2));
