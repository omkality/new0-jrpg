import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { Matrix4, Vector3, Quaternion } from "three";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  animationOnly,
  copyAnimation,
  animationDigest,
} from "./animation-io.mjs";
const rootPath = fileURLToPath(new URL("../../", import.meta.url));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceDoc = await io.read(`${rootPath}/public/assets/motion/combat.glb`);
const metadata = JSON.parse(
  await readFile(`${rootPath}/public/assets/motion/source-rest.json`, "utf8"),
);
const names = Object.keys(metadata.joints);

function structure(doc) {
  const nodes = doc.getRoot().listNodes(),
    byName = new Map(nodes.map((n) => [n.getName(), n])),
    parent = new Map();
  for (const n of nodes) for (const c of n.listChildren()) parent.set(c, n);
  const base = new Map(
    nodes.map((n) => [
      n,
      {
        p: new Vector3().fromArray(n.getTranslation()),
        q: new Quaternion().fromArray(n.getRotation()).normalize(),
        s: new Vector3().fromArray(n.getScale()),
      },
    ]),
  );
  return { nodes, byName, parent, base };
}
const source = structure(sourceDoc);
for (const name of names) {
  const b = source.base.get(source.byName.get(name)),
    m = metadata.joints[name];
  b.p.fromArray(m.idleTranslation);
  b.q.fromArray(m.idleRotation).normalize();
}
function copy(p) {
  return new Map(
    [...p].map(([n, t]) => [
      n,
      { p: t.p.clone(), q: t.q.clone(), s: t.s.clone() },
    ]),
  );
}
function smooth(u) {
  u = Math.min(1, Math.max(0, u));
  return u * u * (3 - 2 * u);
}
function wm(info, pose, node, cache = new Map()) {
  if (cache.has(node)) return cache.get(node).clone();
  const t = pose.get(node),
    local = new Matrix4().compose(t.p, t.q, t.s);
  const m = info.parent.has(node)
    ? wm(info, pose, info.parent.get(node), cache).multiply(local)
    : local;
  cache.set(node, m.clone());
  return m;
}
function wq(info, pose, node) {
  const p = new Vector3(),
    q = new Quaternion(),
    s = new Vector3();
  wm(info, pose, node).decompose(p, q, s);
  return q.normalize();
}
function wp(info, pose, node) {
  return new Vector3().setFromMatrixPosition(wm(info, pose, node));
}
function setWQ(info, pose, node, q) {
  const pq = info.parent.has(node)
    ? wq(info, pose, info.parent.get(node))
    : new Quaternion();
  pose.get(node).q.copy(pq.invert().multiply(q)).normalize();
}
function aim(info, pose, node, child, target) {
  const p = wp(info, pose, node),
    from = wp(info, pose, child).sub(p).normalize(),
    to = target.clone().sub(p).normalize();
  setWQ(
    info,
    pose,
    node,
    new Quaternion()
      .setFromUnitVectors(from, to)
      .multiply(wq(info, pose, node)),
  );
}
function ik(info, pose, aName, bName, cName, target, pole) {
  const a = info.byName.get(aName),
    b = info.byName.get(bName),
    c = info.byName.get(cName),
    start = wp(info, pose, a);
  const l1 = wp(info, pose, b).distanceTo(start),
    l2 = wp(info, pose, c).distanceTo(wp(info, pose, b));
  const dir = target.clone().sub(start),
    d = Math.min(
      l1 + l2 - 0.003,
      Math.max(Math.abs(l1 - l2) + 0.003, dir.length()),
    );
  dir.normalize();
  const end = start.clone().addScaledVector(dir, d);
  const perp = pole.clone().sub(start);
  perp.addScaledVector(dir, -perp.dot(dir));
  if (perp.lengthSq() < 1e-6) perp.set(0, 0, 1);
  perp.normalize();
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d),
    h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const elbow = start
    .clone()
    .addScaledVector(dir, along)
    .addScaledVector(perp, h);
  aim(info, pose, a, b, elbow);
  aim(info, pose, b, c, end);
}
function sample(info, animation, time) {
  const pose = copy(info.base);
  for (const channel of animation.listChannels()) {
    const sampler = channel.getSampler(),
      ts = sampler.getInput().getArray(),
      values = sampler.getOutput().getArray(),
      path = channel.getTargetPath(),
      n = channel.getTargetNode();
    let a = 0;
    while (a < ts.length - 2 && ts[a + 1] < time) a++;
    const b = Math.min(ts.length - 1, a + 1),
      t =
        ts[b] === ts[a]
          ? 0
          : Math.max(0, Math.min(1, (time - ts[a]) / (ts[b] - ts[a])));
    const state = pose.get(n),
      size = path === "rotation" ? 4 : 3;
    if (path === "rotation")
      state.q
        .fromArray(values, a * size)
        .slerp(new Quaternion().fromArray(values, b * size), t)
        .normalize();
    else if (path === "translation")
      state.p
        .fromArray(values, a * size)
        .lerp(new Vector3().fromArray(values, b * size), t);
    else if (path === "scale")
      state.s
        .fromArray(values, a * size)
        .lerp(new Vector3().fromArray(values, b * size), t);
  }
  return pose;
}
function meshesForFloor(info) {
  const result = [];
  for (const node of info.nodes) {
    const mesh = node.getMesh(),
      skin = node.getSkin();
    if (!mesh || !skin) continue;
    for (const primitive of mesh.listPrimitives()) {
      const v = primitive.getAttribute("POSITION")?.getArray(),
        j = primitive.getAttribute("JOINTS_0")?.getArray(),
        w = primitive.getAttribute("WEIGHTS_0")?.getArray();
      if (v && j && w)
        result.push({
          v,
          j,
          w,
          joints: skin.listJoints(),
          bind: skin.getInverseBindMatrices().getArray(),
        });
    }
  }
  return result;
}
function floorY(info, pose, meshes) {
  let minimum = Infinity;
  for (const mesh of meshes) {
    const ms = mesh.joints.map(
      (n, i) =>
        wm(info, pose, n).multiply(new Matrix4().fromArray(mesh.bind, i * 16))
          .elements,
    );
    for (let i = 0; i < mesh.v.length / 3; i++) {
      const x = mesh.v[i * 3],
        y = mesh.v[i * 3 + 1],
        z = mesh.v[i * 3 + 2];
      let py = 0;
      for (let k = 0; k < 4; k++) {
        const weight = mesh.w[i * 4 + k];
        if (!weight) continue;
        const m = ms[mesh.j[i * 4 + k]];
        py += weight * (m[1] * x + m[5] * y + m[9] * z + m[13]);
      }
      minimum = Math.min(minimum, py);
    }
  }
  return minimum;
}
function chainLength(info, pose, a, b, c) {
  return (
    wp(info, pose, info.byName.get(a)).distanceTo(
      wp(info, pose, info.byName.get(b)),
    ) +
    wp(info, pose, info.byName.get(b)).distanceTo(
      wp(info, pose, info.byName.get(c)),
    )
  );
}
const sourceWorld = new Map(
  names.map((name) => [
    name,
    {
      q: wq(source, source.base, source.byName.get(name)),
      p: wp(source, source.base, source.byName.get(name)),
    },
  ]),
);
const reports = [];
for (const character of ["prisoner", "gaoler"]) {
  const targetDoc = await io.read(
      `${rootPath}/public/assets/cast/${character}.glb`,
    ),
    target = structure(targetDoc),
    root = targetDoc.getRoot();
  const idle = root.listAnimations().find((a) => a.getName() === "Idle");
  if (idle) target.base = sample(target, idle, 0);
  const targetWorld = new Map(
    names.map((name) => [
      name,
      {
        q: wq(target, target.base, target.byName.get(name)),
        p: wp(target, target.base, target.byName.get(name)),
      },
    ]),
  );
  const meshes = meshesForFloor(target),
    pelvis = target.byName.get("pelvis");
  const hipRatio =
    targetWorld.get("pelvis").p.y / sourceWorld.get("pelvis").p.y;
  const legRatio =
    chainLength(target, target.base, "thigh_R", "shin_R", "foot_R") /
    chainLength(source, source.base, "thigh_R", "shin_R", "foot_R");
  const armRatio =
    chainLength(target, target.base, "upperarm_R", "forearm_R", "hand_R") /
    chainLength(source, source.base, "upperarm_R", "forearm_R", "hand_R");
  for (const old of [...root.listAnimations()]) old.dispose();
  const deathSeed = await io.read(
    fileURLToPath(new URL(`./seeds/death-${character}.glb`, import.meta.url)),
  );
  const approvedDeath = deathSeed
    .getRoot()
    .listAnimations()
    .find((a) => a.getName() === "Death");
  copyAnimation(approvedDeath, targetDoc);
  const report = { character, hipRatio, legRatio, armRatio, clips: [] };
  for (const animation of sourceDoc.getRoot().listAnimations()) {
    const name = animation.getName();
    if (name === "Death") continue;
    const fullBody = animation.getExtras().fullBody === true;
    const sourceTimes = animation.listSamplers()[0].getInput().getArray(),
      duration = sourceTimes.at(-1),
      poses = [];
    let maximumCorrection = 0;
    for (const time of sourceTimes) {
      const src = sample(source, animation, time),
        dst = copy(target.base);
      // Transfer local positional deltas while preserving the destination rest lengths.
      for (const boneName of names) {
        const sn = source.byName.get(boneName),
          dn = target.byName.get(boneName),
          ratio = boneName === "pelvis" ? hipRatio : 1;
        dst
          .get(dn)
          .p.addScaledVector(
            src.get(sn).p.clone().sub(source.base.get(sn).p),
            ratio,
          );
        const desired = wq(source, src, sn)
          .multiply(sourceWorld.get(boneName).q.clone().invert())
          .multiply(targetWorld.get(boneName).q);
        setWQ(target, dst, dn, desired);
      }
      // Fixed-reference endpoint deltas work for planted combat poses. They must
      // not pull limbs back towards standing reference anchors during a roll.
      if (!fullBody)
        for (const side of ["L", "R"]) {
          for (const [a, b, c, ratio] of [
            [`thigh_${side}`, `shin_${side}`, `foot_${side}`, legRatio],
            [`upperarm_${side}`, `forearm_${side}`, `hand_${side}`, armRatio],
          ]) {
            const endpoint = targetWorld
              .get(c)
              .p.clone()
              .addScaledVector(
                wp(source, src, source.byName.get(c)).sub(sourceWorld.get(c).p),
                ratio,
              );
            const pole = targetWorld
              .get(b)
              .p.clone()
              .addScaledVector(
                wp(source, src, source.byName.get(b)).sub(sourceWorld.get(b).p),
                ratio,
              );
            const endQ = wq(target, dst, target.byName.get(c));
            ik(target, dst, a, b, c, endpoint, pole);
            setWQ(target, dst, target.byName.get(c), endQ);
          }
        }
      // Rebuild the right-hand grip basis after IK. Different bind wrist rolls
      // must not rotate the blade away from the authored cut direction.
      {
        const hand = target.byName.get("hand_R"),
          forearm = target.byName.get("forearm_R");
        const finger = wp(target, dst, hand)
          .sub(wp(target, dst, forearm))
          .normalize();
        const blade = new Vector3(0, 0, -1).applyQuaternion(
          wq(source, src, source.byName.get("hand_R")),
        );
        if (fullBody) {
          finger.addScaledVector(blade, -finger.dot(blade)).normalize();
        } else blade.addScaledVector(finger, -blade.dot(finger)).normalize();
        const z = blade.negate(),
          x = finger.clone().cross(z).normalize();
        z.crossVectors(x, finger).normalize();
        setWQ(
          target,
          dst,
          hand,
          new Quaternion().setFromRotationMatrix(
            new Matrix4().makeBasis(x, finger, z),
          ),
        );
      }
      const floor = floorY(target, dst, meshes),
        correction = 0.012 - floor;
      dst.get(pelvis).p.y += correction;
      if (fullBody) {
        // At entry/recovery use the *baked target* Guard, because the planted
        // combat IK has proportion-specific offsets absent from the airborne FK.
        const guard = root
          .listAnimations()
          .find((a) => a.getName() === "Guard");
        const amount = Math.max(
          1 - smooth(time / 0.1),
          name.startsWith("Dodge") ? smooth((time - 0.7) / 0.12) : 0,
        );
        if (guard && amount > 0) {
          const resting = sample(target, guard, 0);
          for (const [node, state] of dst) {
            state.p.lerp(resting.get(node).p, amount);
            state.q.slerp(resting.get(node).q, amount).normalize();
          }
          dst.get(pelvis).p.y += 0.012 - floorY(target, dst, meshes);
        }
      }
      maximumCorrection = Math.max(maximumCorrection, Math.abs(correction));
      poses.push(dst);
    }
    const output = targetDoc.createAnimation(name).setExtras({
      retargetedFor: character,
      method:
        "Native Idle world delta, arm/leg endpoint IK using target lengths, weighted floor correction",
      version: fullBody ? 3 : 2,
      provenance: animation.getExtras().provenance,
      fullBody,
    });
    const buffer = root.listBuffers()[0],
      input = targetDoc
        .createAccessor(`${name}_time`)
        .setType("SCALAR")
        .setArray(new Float32Array(sourceTimes))
        .setBuffer(buffer);
    for (const boneName of names) {
      const joint = target.byName.get(boneName),
        ps = [],
        qs = [];
      let previous = null;
      for (const pose of poses) {
        const t = pose.get(joint);
        ps.push(...t.p.toArray());
        const q = t.q.clone().normalize();
        if (previous && q.dot(previous) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        qs.push(...q.toArray());
        previous = q;
      }
      for (const [path, type, values] of [
        ["translation", "VEC3", ps],
        ["rotation", "VEC4", qs],
      ]) {
        const accessor = targetDoc
          .createAccessor(`${name}_${boneName}_${path}`)
          .setType(type)
          .setArray(new Float32Array(values))
          .setBuffer(buffer);
        const sampler = targetDoc
          .createAnimationSampler()
          .setInput(input)
          .setOutput(accessor)
          .setInterpolation("LINEAR");
        output
          .addSampler(sampler)
          .addChannel(
            targetDoc
              .createAnimationChannel()
              .setTargetNode(joint)
              .setTargetPath(path)
              .setSampler(sampler),
          );
      }
    }
    report.clips.push({
      name,
      duration,
      maximumFloorCorrection: maximumCorrection,
      minSurfaceY: Math.min(...poses.map((p) => floorY(target, p, meshes))),
    });
  }
  const a = root.getAsset();
  a.extras = {
    sourceRig: character,
    source: "Patch anymove CC0 character",
    motion:
      "Original new0 combat v2 and CC0 Quaternius roll/death adaptation v3, asset-time retargeted with floor checks",
  };
  const prepared = animationOnly(targetDoc);
  if (
    animationDigest(
      prepared
        .getRoot()
        .listAnimations()
        .find((a) => a.getName() === "Death"),
    ) !== animationDigest(approvedDeath)
  )
    throw new Error("Death changed for " + character);
  await io.write(
    `${rootPath}/public/assets/motion/${character}-combat.glb`,
    prepared,
  );
  reports.push(report);
}
await writeFile(
  `${rootPath}/work/asset-authoring/cast-combat-retarget-report.json`,
  JSON.stringify(reports, null, 2),
);
console.log(JSON.stringify(reports));
