import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { loadAuthorRig } from "./rig-authoring.mjs";
import { makeCombatPoses } from "./combat-poses.mjs";
import {
  animationOnly,
  copyAnimation,
  animationDigest,
} from "./animation-io.mjs";

const project = fileURLToPath(new URL("../../", import.meta.url));
const rig = await loadAuthorRig(project);
const {
  io,
  doc,
  root,
  nodes,
  byName,
  joints,
  base,
  minimumSkinY,
  position,
  worldQ,
} = rig;
const { descriptors, contract } = makeCombatPoses(rig);
const deathSeed = await io.read(
  fileURLToPath(new URL("./seeds/death-knight.glb", import.meta.url)),
);
const preservedDeath = deathSeed
  .getRoot()
  .listAnimations()
  .find((a) => a.getName() === "Death");
for (const old of [...root.listAnimations()]) old.dispose();
copyAnimation(preservedDeath, doc);
const report = {
  version: 2,
  method:
    "Continuous Hermite target curves, per-sample FK/IK and weighted skin floor alignment",
  clips: [],
};
function poseAt(descriptor, t) {
  const pose = descriptor.poseAt(t);
  pose.get(byName.get("pelvis")).p.y += 0.012 - minimumSkinY(pose);
  return pose;
}
for (const descriptor of descriptors) {
  const { name, duration, landmarks = [] } = descriptor;
  const times = [
    ...new Set(
      [
        0,
        duration,
        ...landmarks,
        ...Array.from({ length: Math.ceil(duration * 60) }, (_, i) => i / 60),
      ].filter((t) => t <= duration),
    ),
  ].sort((a, b) => a - b);
  const poses = times.map((t) => poseAt(descriptor, t));
  const animation = doc.createAnimation(name).setExtras({
    provenance: "Original new0 FK/IK skeletal keyframes, not captured motion",
    version: 2,
    ...(contract[name] ?? {}),
  });
  const buffer = root.listBuffers()[0];
  const input = doc
    .createAccessor(`${name}_time`)
    .setType("SCALAR")
    .setArray(new Float32Array(times))
    .setBuffer(buffer);
  for (const joint of joints) {
    const translations = [],
      rotations = [];
    let previous = null;
    for (const pose of poses) {
      const state = pose.get(joint);
      translations.push(...state.p.toArray());
      const q = state.q.clone().normalize();
      if (previous && previous.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      rotations.push(...q.toArray());
      previous = q;
    }
    for (const [path, type, values] of [
      ["translation", "VEC3", translations],
      ["rotation", "VEC4", rotations],
    ]) {
      const output = doc
        .createAccessor(`${name}_${joint.getName()}_${path}`)
        .setType(type)
        .setArray(new Float32Array(values))
        .setBuffer(buffer);
      const sampler = doc
        .createAnimationSampler()
        .setInput(input)
        .setOutput(output)
        .setInterpolation("LINEAR");
      animation
        .addSampler(sampler)
        .addChannel(
          doc
            .createAnimationChannel()
            .setTargetNode(joint)
            .setTargetPath(path)
            .setSampler(sampler),
        );
    }
  }
  const notable = [...new Set([0, duration, ...landmarks])]
    .sort((a, b) => a - b)
    .map((time) => {
      const pose = poseAt(descriptor, time);
      return {
        time,
        pelvis: position(pose, byName.get("pelvis")).toArray(),
        hand: position(pose, byName.get("hand_R")).toArray(),
      };
    });
  report.clips.push({
    name,
    duration,
    samples: times.length,
    channels: 44,
    minimumSurfaceY: Math.min(...poses.map((pose) => minimumSkinY(pose))),
    notable,
  });
}
const desc = new Map(descriptors.map((d) => [d.name, d]));
report.seams = [
  ["Attack1", 0.52, "Attack2"],
  ["Attack2", 0.51, "Attack3"],
].map(([a, time, b]) => {
  const p = poseAt(desc.get(a), time),
    q = poseAt(desc.get(b), 0);
  const h = 1 / 600,
    before = poseAt(desc.get(a), time - h),
    after = poseAt(desc.get(b), h);
  const hand = byName.get("hand_R");
  return {
    from: a,
    link: time,
    to: b,
    maximumJointPositionDelta: Math.max(
      ...joints.map((j) => position(p, j).distanceTo(position(q, j))),
    ),
    maximumJointAngleDelta: Math.max(
      ...joints.map((j) => worldQ(p, j).angleTo(worldQ(q, j))),
    ),
    handIncomingVelocity: position(p, hand)
      .sub(position(before, hand))
      .divideScalar(h)
      .toArray(),
    handOutgoingVelocity: position(after, hand)
      .sub(position(q, hand))
      .divideScalar(h)
      .toArray(),
  };
});
const rest = {};
for (const joint of joints) {
  const idle = base.get(joint);
  rest[joint.getName()] = {
    translation: joint.getTranslation(),
    rotation: joint.getRotation(),
    scale: joint.getScale(),
    idleTranslation: idle.p.toArray(),
    idleRotation: idle.q.toArray(),
    parent: rig.parent.get(joint)?.getName() ?? null,
  };
}
const metadata = {
  source:
    "Patch CC0 knight rig, https://patch.gg/create/toolbox/assets/anymove:knight",
  sourceHeight: 1.85,
  sourcePelvisHeight: base.get(byName.get("pelvis")).p.y,
  joints: rest,
  weapon: {
    bone: "hand_R",
    grip: [0, 0.06, 0],
    bladeAxis: [0, 0, -1],
    crossguardAxis: [1, 0, 0],
  },
  clips: [
    { name: "Death", duration: 1.6 },
    ...report.clips.map((c) => ({ name: c.name, duration: c.duration })),
  ],
  contactTimes: Object.fromEntries(
    Object.entries(contract).map(([name, c]) => [name, c.contact]),
  ),
  comboLinkTimes: Object.fromEntries(
    Object.entries(contract)
      .filter(([, c]) => c.link !== null)
      .map(([name, c]) => [name, c.link]),
  ),
  retarget:
    "Asset-time native Idle world delta with destination arm/leg IK and weighted skin floor alignment.",
};
root.getAsset().extras = {
  sourceRig: "Patch anymove knight CC0",
  motion: "Original new0 FK/IK combat poses v2, no external mocap",
  weapon: metadata.weapon,
  contract,
};
const out = resolve(project, "public/assets/motion"),
  work = resolve(project, "work/asset-authoring");
await mkdir(out, { recursive: true });
await mkdir(work, { recursive: true });
const prepared = animationOnly(doc);
if (
  animationDigest(
    prepared
      .getRoot()
      .listAnimations()
      .find((a) => a.getName() === "Death"),
  ) !== animationDigest(preservedDeath)
)
  throw new Error("Death changed");
await io.write(resolve(out, "combat.glb"), prepared);
await writeFile(
  resolve(out, "source-rest.json"),
  JSON.stringify(metadata, null, 2) + "\n",
);
await writeFile(
  resolve(out, "contract.json"),
  JSON.stringify(
    {
      version: 2,
      attacks: contract,
      dodges: 0.52,
      hits: { HitFront: 0.4, HitLeft: 0.42, HitRight: 0.46 },
      Guard: 0.8,
      BlockHit: 0.32,
      Death: 1.6,
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  resolve(work, "combat-authoring-report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    clips: report.clips.map((c) => ({ name: c.name, duration: c.duration })),
    seams: report.seams,
    deathPreserved: true,
  }),
);
