import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshBVH } from "three-mesh-bvh";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Matrix4,
  Vector3,
  Group,
  Object3D,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { structure, sample, world, blend } from "./pose-sampling.mjs";
import { WEAPON_MOUNTS } from "../../src/weapon-spec.ts";
import { GearPose } from "../../src/gear-pose.ts";
import { ATTACKS } from "../../src/game.ts";
import assert from "node:assert/strict";

const project = fileURLToPath(new URL("../../", import.meta.url));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const character = process.argv.includes("--character")
  ? process.argv[process.argv.indexOf("--character") + 1]
  : "prisoner";
const doc = await io.read(
  resolve(project, `public/assets/cast/${character}.glb`),
);
const motion = await io.read(
  resolve(project, "public/assets/motion/prisoner-combat.glb"),
);
const info = structure(doc);
const floorTable = JSON.parse(
  await readFile(resolve(project, "public/assets/cast/floor-v7.json"), "utf8"),
);
const rig = new Group(),
  objects = new Map(info.nodes.map((n) => [n, new Object3D()]));
for (const [node, o] of objects) {
  o.name = node.getName();
  (info.parent.has(node) ? objects.get(info.parent.get(node)) : rig).add(o);
}
const controller = new GearPose(rig);
function fitted(pose, weapon, clip, time) {
  const curve = floorTable.profiles[character]?.clips[clip];
  const fi = Math.min((curve?.offsets.length ?? 1) - 1, Math.round(time * 60));
  const offset = curve?.offsets[fi] ?? 0;
  rig.position.y = offset;
  for (const [n, o] of objects) {
    const s = pose.get(n);
    o.position.copy(s.p);
    o.quaternion.copy(s.q);
    o.scale.copy(s.s);
  }
  rig.updateMatrixWorld(true);
  if (process.argv.includes("--fit")) {
    const pieces = [];
    for (const node of cloth)
      for (const primitive of node.getMesh().listPrimitives())
        pieces.push(skin(node, pose, primitive));
    const body = mergeGeometries(pieces);
    for (const p of pieces) p.dispose();
    body.translate(0, offset, 0);
    body.boundsTree = new MeshBVH(body);
    const matrix = new Matrix4(),
      box = weapon.geometry.boundingBox.clone();
    controller.apply(
      weapon.id,
      clip,
      0,
      (m) => {
        matrix.copy(m).multiply(mount);
        const collision = body.boundsTree.intersectsGeometry(
          weapon.geometry,
          matrix,
        );
        box.copy(weapon.geometry.boundingBox).applyMatrix4(matrix);
        return (collision ? 1000 : 0) + Math.max(0, 0.008 - box.min.y) * 10000;
      },
      time,
    );
    body.dispose();
  }
  for (const [n, o] of objects) {
    const s = pose.get(n);
    s.p.copy(o.position);
    s.q.copy(o.quaternion);
    s.s.copy(o.scale);
  }
  return offset;
}
if (process.argv.includes("--leading")) {
  const result = [];
  for (const [name, time] of [
    ["Attack1", 0.3],
    ["Attack2", 0.32],
    ["Attack3", 0.43],
  ]) {
    const clip = motion
        .getRoot()
        .listAnimations()
        .find((a) => a.getName() === name),
      pose = sample(info, clip, time);
    const m = world(info, pose, info.byName.get("hand_R"))
      .multiply(new Matrix4().makeTranslation(0, 0.06, 0))
      .multiply(new Matrix4().makeRotationX(-Math.PI / 2));
    const grip = new Vector3().applyMatrix4(m),
      head = new Vector3(0, 0.65, 0).applyMatrix4(m);
    result.push({
      name,
      hand: grip.toArray(),
      shaft: head.toArray(),
      longAxis: head.clone().sub(grip).normalize().toArray(),
      edge: [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((twist) => ({
        twist,
        headOutward: new Vector3(1, 0, 0)
          .transformDirection(
            new Matrix4().multiplyMatrices(
              m,
              new Matrix4().makeRotationY(twist),
            ),
          )
          .toArray(),
      })),
    });
  }
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
if (process.argv.includes("--describe")) {
  console.log(
    JSON.stringify(
      info.nodes
        .filter((n) => n.getMesh())
        .map((n) => ({
          node: n.getName(),
          mesh: n.getMesh().getName(),
          materials: n
            .getMesh()
            .listPrimitives()
            .map((p) => p.getMaterial().getName()),
        })),
      null,
      2,
    ),
  );
  process.exit(0);
}
const cloth = info.nodes.filter(
  (n) =>
    n.getMesh() &&
    !n.getMesh().getName().startsWith("tripo_mesh_") &&
    !/mask|eye|mouth/i.test(n.getMesh().getName()),
);
function geometry(primitive) {
  const g = new BufferGeometry();
  g.setAttribute(
    "position",
    new Float32BufferAttribute(
      primitive.getAttribute("POSITION").getArray(),
      3,
    ),
  );
  if (primitive.getIndices())
    g.setIndex([...primitive.getIndices().getArray()]);
  return g;
}
function skin(node, pose, primitive) {
  const g = geometry(primitive),
    attr = g.getAttribute("position"),
    source = primitive.getAttribute("POSITION").getArray();
  const skeleton = node.getSkin(),
    inv = skeleton.getInverseBindMatrices().getArray();
  const matrices = skeleton
    .listJoints()
    .map((j, i) =>
      world(info, pose, j).multiply(new Matrix4().fromArray(inv, i * 16)),
    );
  const joints = primitive.getAttribute("JOINTS_0").getArray(),
    weights = primitive.getAttribute("WEIGHTS_0").getArray();
  const p = new Vector3(),
    v = new Vector3(),
    out = new Vector3();
  for (let i = 0; i < attr.count; i++) {
    p.fromArray(source, i * 3);
    out.set(0, 0, 0);
    for (let k = 0; k < 4; k++)
      if (weights[i * 4 + k])
        out.addScaledVector(
          v.copy(p).applyMatrix4(matrices[joints[i * 4 + k]]),
          weights[i * 4 + k],
        );
    attr.setXYZ(i, out.x, out.y, out.z);
  }
  return g;
}
const clips = [
  ...doc
    .getRoot()
    .listAnimations()
    .filter((a) => ["Idle", "Walk", "Run"].includes(a.getName())),
  ...motion.getRoot().listAnimations(),
];
const byClip = new Map(clips.map((c) => [c.getName(), c]));
for (const [from, at, to, duration] of [
  ["Idle", 0.3, "Walk", 0.18],
  ["Walk", 0.7, "Run", 0.18],
  ["Run", 0.8, "Guard", 0.18],
  ["Guard", 0.2, "Attack1", 0.09],
  ["Attack1", ATTACKS[0].link, "Attack2", 0.09],
  ["Attack2", ATTACKS[1].link, "Attack3", 0.09],
  ["Attack1", 0.65, "Guard", 0.18],
  ["Attack3", 0.9, "Guard", 0.18],
  ["Guard", 0.2, "DodgeForward", 0.09],
  ["Run", 0.6, "DodgeLeft", 0.09],
  ["Attack2", 0.4, "HitFront", 0.055],
  ["Idle", 0.2, "DeathBack", 0.16],
  ["DodgeForward", 0.65, "Idle", 0.18],
]) {
  const a = byClip.get(from),
    b = byClip.get(to);
  clips.push({
    getName: () => `Blend ${from} -> ${to}`,
    listSamplers: () => [
      { getInput: () => ({ getArray: () => [0, duration] }) },
    ],
    hint: to,
    poseAt: (t) =>
      blend(sample(info, a, at + t), sample(info, b, t), t / duration),
  });
}
const weapons = [];
for (const id of character === "watcher" &&
!process.argv.includes("--all-weapons")
  ? ["sword"]
  : ["sword", "axe", "spear"]) {
  const d = await io.read(
      resolve(project, `public/assets/props-v7/weapon-${id}.glb`),
    ),
    wi = structure(d),
    pieces = [];
  for (const node of wi.nodes)
    if (node.getMesh())
      for (const p of node.getMesh().listPrimitives())
        pieces.push(geometry(p).applyMatrix4(world(wi, wi.base, node)));
  const g = mergeGeometries(pieces);
  for (const p of pieces) p.dispose();
  const spec = WEAPON_MOUNTS[id];
  g.applyMatrix4(new Matrix4().makeRotationY(spec.twist)).scale(
    spec.scale,
    spec.scale,
    spec.scale,
  );
  g.computeBoundingBox();
  g.boundsTree = new MeshBVH(g);
  weapons.push({ id, geometry: g });
}
const mount = new Matrix4()
  .makeTranslation(0, 0.06, 0)
  .multiply(new Matrix4().makeRotationX(-Math.PI / 2));
const report = [];
for (const clip of clips) {
  const duration = Math.max(
      ...clip.listSamplers().map((s) => s.getInput().getArray().at(-1)),
    ),
    hits = Object.fromEntries(weapons.map((w) => [w.id, []])),
    minimumFloor = Object.fromEntries(weapons.map((w) => [w.id, Infinity])),
    cuttingEdge = [];
  let samples = 0;
  const hz = process.argv.includes("--full") ? 60 : 12;
  for (let frame = 0; frame <= Math.ceil(duration * hz); frame++) {
    const t = Math.min(duration, frame / hz);
    if (clip.getName().startsWith("Death") && t > 0.65) continue;
    samples++;
    for (const w of weapons) {
      const pose = clip.poseAt ? clip.poseAt(t) : sample(info, clip, t),
        offset = fitted(pose, w, clip.hint ?? clip.getName(), t),
        matrix = objects
          .get(info.byName.get("hand_R"))
          .matrixWorld.clone()
          .multiply(mount);
      const positions = w.geometry.getAttribute("position"),
        e = matrix.elements;
      for (let i = 0; i < positions.count; i++)
        minimumFloor[w.id] = Math.min(
          minimumFloor[w.id],
          e[1] * positions.getX(i) +
            e[5] * positions.getY(i) +
            e[9] * positions.getZ(i) +
            e[13],
        );
      const stage = Number(clip.getName().replace("Attack", "")) - 1;
      if (
        w.id === "axe" &&
        clip.getName().startsWith("Attack") &&
        Math.abs(t - ATTACKS[stage].contact) < 0.5 / hz + 0.00001
      )
        cuttingEdge.push(
          new Vector3(1, 0, 0).transformDirection(
            matrix
              .clone()
              .multiply(new Matrix4().makeRotationY(WEAPON_MOUNTS.axe.twist)),
          ).z,
        );
      const clothParts = [];
      for (const node of cloth)
        for (const primitive of node.getMesh().listPrimitives())
          clothParts.push(skin(node, pose, primitive));
      const body = mergeGeometries(clothParts);
      for (const p of clothParts) p.dispose();
      body.translate(0, offset, 0);
      body.boundsTree = new MeshBVH(body);
      if (body.boundsTree.intersectsGeometry(w.geometry, matrix)) {
        hits[w.id].push(Number(t.toFixed(4)));
        if (process.argv.includes("--details") && hits[w.id].length <= 2) {
          const a = {},
            b = {};
          body.boundsTree.closestPointToGeometry(w.geometry, matrix, a, b);
          console.error(
            JSON.stringify({
              clip: clip.getName(),
              weapon: w.id,
              t,
              hand: objects
                .get(info.byName.get("hand_R"))
                .getWorldPosition(new Vector3())
                .toArray(),
              point: a.point?.toArray(),
            }),
          );
        }
      }
      body.dispose();
    }
  }
  report.push({
    clip: clip.getName(),
    samples,
    hits,
    minimumFloor,
    cuttingEdge,
  });
}
await mkdir(resolve(project, "work/gear-v8"), { recursive: true });
await writeFile(
  resolve(
    project,
    `work/gear-v8/cloth-${process.argv.includes("--fit") ? "fitted" : "raw"}-${character}.json`,
  ),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      character,
      samplesPerSecond: process.argv.includes("--full") ? 60 : 12,
      posedWeaponSamples: report.reduce(
        (n, r) => n + r.samples * weapons.length,
        0,
      ),
      results: report.map((r) => ({
        clip: r.clip,
        frames: Object.fromEntries(
          Object.entries(r.hits).map(([k, v]) => [k, v.length]),
        ),
        minimumFloor: r.minimumFloor,
        cuttingEdge: r.cuttingEdge,
      })),
    },
    null,
    2,
  ),
);
if (process.argv.includes("--strict"))
  for (const r of report) {
    for (const [weapon, hits] of Object.entries(r.hits))
      assert.equal(
        hits.length,
        0,
        `${character} ${r.clip} ${weapon}: cloth intersection`,
      );
    for (const [weapon, y] of Object.entries(r.minimumFloor))
      assert.ok(y >= -0.002, `${character} ${r.clip} ${weapon}: floor ${y}`);
    for (const dot of r.cuttingEdge)
      assert.ok(dot > 0.1, `${r.clip}: axe cutting edge faces backwards`);
  }
