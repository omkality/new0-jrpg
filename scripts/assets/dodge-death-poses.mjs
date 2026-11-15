// Quaternius CC0 Roll / Death01 adaptation and original directional collapse variants.
// Horizontal root travel remains entirely in the game controller.
import { Matrix4, Quaternion, Vector3 } from "three";
import { fileURLToPath } from "node:url";
import {
  structure,
  sample,
  position,
  rotation,
  blend,
  smooth,
} from "./pose-sampling.mjs";

const boneMap = {
  pelvis: "pelvis",
  spine_01: "spine1",
  spine_02: "spine2",
  spine_03: "chest",
  neck_01: "neck",
  Head: "head",
  clavicle_l: "clavicle_L",
  upperarm_l: "upperarm_L",
  lowerarm_l: "forearm_L",
  hand_l: "hand_L",
  clavicle_r: "clavicle_R",
  upperarm_r: "upperarm_R",
  lowerarm_r: "forearm_R",
  hand_r: "hand_R",
  thigh_l: "thigh_L",
  calf_l: "shin_L",
  foot_l: "foot_L",
  ball_l: "toe_L",
  thigh_r: "thigh_R",
  calf_r: "shin_R",
  foot_r: "foot_R",
  ball_r: "toe_R",
};
const X = new Vector3(1, 0, 0),
  Y = new Vector3(0, 1, 0),
  Z = new Vector3(0, 0, 1);

function mapTime(t, keys) {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const [a, av] = keys[i],
    [b, bv] = keys[i + 1];
  // Piecewise linear source clock preserves the original motion's own ease.
  return av + (bv - av) * Math.max(0, Math.min(1, (t - a) / (b - a)));
}

export async function makeDodgeDeathPoses(rig, guardPoseAt) {
  const doc = await rig.io.read(
    fileURLToPath(
      new URL("./seeds/quaternius-ual1-roll-death.glb", import.meta.url),
    ),
  );
  const source = structure(doc),
    animations = new Map(
      doc
        .getRoot()
        .listAnimations()
        .map((a) => [a.getName(), a]),
    );
  const idle = sample(source, animations.get("Idle_Loop"), 0);
  const sourceRef = new Map(
    Object.entries(boneMap).map(([sn, dn]) => [
      sn,
      {
        p: position(source, idle, source.byName.get(sn)),
        q: rotation(source, idle, source.byName.get(sn)),
        destQ: rig.worldQ(rig.base, rig.byName.get(dn)),
      },
    ]),
  );
  const hipRatio =
    rig.position(rig.base, rig.byName.get("pelvis")).y /
    sourceRef.get("pelvis").p.y;
  const targetHip = rig.position(rig.base, rig.byName.get("pelvis"));
  const guard = guardPoseAt(0);
  const seed = await rig.io.read(
    fileURLToPath(new URL("./seeds/death-knight.glb", import.meta.url)),
  );
  const oldDeath = seed
    .getRoot()
    .listAnimations()
    .find((a) => a.getName() === "Death");
  const targetInfo = { ...rig, base: rig.base };

  function foreignPose(name, t) {
    const animated = sample(source, animations.get(name), t),
      pose = rig.clonePose();
    // Both rigs are Y-up / +Z-forward. Retain destination rest lengths and use
    // source world rotation deltas, including every full-body inversion.
    for (const [sn, dn] of Object.entries(boneMap)) {
      const sourceBone = source.byName.get(sn),
        destBone = rig.byName.get(dn),
        ref = sourceRef.get(sn);
      const q = rotation(source, animated, sourceBone)
        .multiply(ref.q.clone().invert())
        .multiply(ref.destQ);
      rig.setWorldQ(pose, destBone, q);
    }
    const p = position(source, animated, source.byName.get("pelvis"));
    const dest = targetHip
      .clone()
      .addScaledVector(p.sub(sourceRef.get("pelvis").p), hipRatio);
    const parent = rig.parent.get(rig.byName.get("pelvis"));
    if (parent) dest.applyMatrix4(rig.world(pose, parent).invert());
    pose.get(rig.byName.get("pelvis")).p.copy(dest);
    return pose;
  }

  function horizontalSword(pose, preferred, amount = 1) {
    const hand = rig.byName.get("hand_R"),
      forearm = rig.byName.get("forearm_R");
    const blade = preferred.clone().normalize();
    const finger = rig
      .position(pose, hand)
      .sub(rig.position(pose, forearm))
      .normalize();
    finger.addScaledVector(blade, -finger.dot(blade));
    if (finger.lengthSq() < 0.001) finger.copy(Y);
    finger.normalize();
    const z = blade.negate(),
      x = finger.clone().cross(z).normalize();
    z.crossVectors(x, finger).normalize();
    const q = new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(x, finger, z),
    );
    rig.setWorldQ(pose, hand, rig.worldQ(pose, hand).slerp(q, amount));
  }

  function rotateBody(pose, yaw) {
    const pelvis = rig.byName.get("pelvis"),
      p = pose.get(pelvis).p;
    const anchor = guard.get(pelvis).p;
    p.sub(anchor).applyAxisAngle(Y, yaw).add(anchor);
    rig.rotateWorld(pose, "pelvis", Y, yaw);
  }

  // A relaxed side-lying hold. Reusing a prone pose with a 90-degree axial twist
  // leaves the bent shins underneath the torso, visibly propping up the corpse.
  // Here the bottom leg extends, the top knee folds in the ground plane and both
  // forearms rest in front of the chest rather than beneath the abdomen.
  const sideRest = rig.clonePose();
  sideRest.get(rig.byName.get("pelvis")).p.set(-0.22, 0.25, 0.08);
  rig.rotateWorld(sideRest, "pelvis", Z, Math.PI / 2);
  rig.rotateWorld(sideRest, "thigh_L", Y, 0.55);
  rig.rotateWorld(sideRest, "shin_L", Y, -1.0);
  rig.rotateWorld(sideRest, "thigh_R", Y, 0.1);
  rig.rotateWorld(sideRest, "shin_R", Y, -0.2);
  const sideHip = rig.position(sideRest, rig.byName.get("pelvis"));
  rig.arms(
    sideRest,
    sideHip
      .clone()
      .add(new Vector3(-0.45, -0.03, 0.3))
      .toArray(),
    sideHip
      .clone()
      .add(new Vector3(-0.3, 0.25, 0.2))
      .toArray(),
    [0, 0, 1],
    sideHip
      .clone()
      .add(new Vector3(-0.45, 0.15, 0.65))
      .toArray(),
    sideHip
      .clone()
      .add(new Vector3(-0.6, 0.5, 0.6))
      .toArray(),
  );

  const descriptors = [];
  for (const [name, yaw, reverse] of [
    ["DodgeForward", 0, false],
    ["DodgeBack", 0, true],
    ["DodgeLeft", Math.PI / 2, false],
    ["DodgeRight", -Math.PI / 2, false],
  ]) {
    descriptors.push({
      name,
      duration: 0.82,
      landmarks: [0.08, 0.14, 0.26, 0.38, 0.5, 0.65, 0.72],
      provenance:
        "Quaternius UAL Standard Roll, CC0. Retimed, directional adaptation and sword-safe wrist curves by new0.",
      fullBody: true,
      poseAt(t) {
        const sourceTime = reverse
          ? mapTime(t, [
              [0, 1.4666667],
              [0.14, 0.97],
              [0.65, 0],
              [0.82, 0],
            ])
          : mapTime(t, [
              [0, 0],
              [0.14, 0.16],
              [0.65, 0.98],
              [0.82, 1.4666667],
            ]);
        let pose = foreignPose("Roll", sourceTime);
        const turn = smooth(t / 0.14) * (1 - smooth((t - 0.65) / 0.17));
        if (yaw) rotateBody(pose, yaw * turn);
        const startBlend = smooth(t / (reverse ? 0.1 : 0.12));
        const finishBlend = smooth((t - 0.68) / 0.14);
        pose = blend(guard, pose, startBlend);
        pose = blend(pose, guard, finishBlend);
        horizontalSword(pose, yaw ? Z : X, turn);
        return pose;
      },
    });
  }
  descriptors.push({
    name: "DeathBack",
    duration: 1.85,
    landmarks: [0.12, 0.45, 0.77, 0.98, 1.25, 1.6],
    fullBody: true,
    provenance:
      "Quaternius UAL Standard Death01, CC0. Retiming, guard entry and grip adaptation by new0.",
    poseAt(t) {
      const sourceTime = Math.min(2.4, (t / 1.7) * 2.4);
      let pose = foreignPose("Death01", sourceTime);
      pose = blend(guard, pose, smooth(t / 0.14));
      horizontalSword(pose, X, smooth(t / 0.32));
      return pose;
    },
  });
  descriptors.push({
    name: "DeathFront",
    duration: 1.75,
    landmarks: [0.12, 0.35, 0.65, 1.05, 1.4],
    fullBody: true,
    provenance:
      "Original new0 forward collapse derived from the preserved Death, guard entry and prone settling.",
    poseAt(t) {
      const sourceTime = Math.min(1.6, (t / 1.61) * 1.6);
      let pose = sample(targetInfo, oldDeath, sourceTime);
      const pelvis = pose.get(rig.byName.get("pelvis"));
      pelvis.p.x =
        guard.get(rig.byName.get("pelvis")).p.x +
        (pelvis.p.x - guard.get(rig.byName.get("pelvis")).p.x) * 0.45;
      pose = blend(guard, pose, smooth(t / 0.13));
      horizontalSword(pose, X, smooth(t / 0.4));
      return pose;
    },
  });
  descriptors.push({
    name: "DeathSide",
    duration: 1.7,
    landmarks: [0.12, 0.35, 0.65, 0.95, 1.35],
    fullBody: true,
    provenance:
      "Original new0 lateral collapse derived from the preserved Death, shoulder roll and side settling.",
    poseAt(t) {
      const sourceTime = Math.min(1.6, (t / 1.55) * 1.6);
      let pose = sample(targetInfo, oldDeath, sourceTime);
      const pelvis = pose.get(rig.byName.get("pelvis"));
      const fall = smooth((t - 0.18) / 0.75);
      rig.setWorldQ(
        pose,
        rig.byName.get("pelvis"),
        new Quaternion()
          .setFromAxisAngle(Z, (Math.PI / 2) * fall)
          .multiply(rig.worldQ(rig.base, rig.byName.get("pelvis"))),
      );
      pelvis.p.x -= 0.22 * fall;
      pelvis.p.z *= 0.25;
      pose = blend(pose, sideRest, smooth((t - 0.65) / 0.65));
      pose = blend(guard, pose, smooth(t / 0.13));
      horizontalSword(pose, Z, smooth(t / 0.4));
      return pose;
    },
  });
  return {
    descriptors,
    provenance: {
      author: "Quaternius",
      license: "CC0-1.0",
      source: "https://quaternius.itch.io/universal-animation-library",
      originalClips: { Roll: 1.4666667, Death01: 2.4 },
      research:
        "KayKit Adventure Mage directional Dodges were evaluated and rejected because they do not invert the torso. No KayKit data is shipped.",
    },
  };
}
