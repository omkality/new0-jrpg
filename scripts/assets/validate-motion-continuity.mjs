import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import * as THREE from "three";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { sample, blend } from "./pose-sampling.mjs";
import { threeRig, setPose, weaponGroup } from "./three-rig.mjs";
import { motionName, sourceAttackTime } from "../../src/motion-policy.ts";
import { SkeletonContinuity } from "../../src/skeleton-continuity.ts";
import { GearPose } from "../../src/gear-pose.ts";
import { FootContact } from "../../src/foot-contact.ts";
import {
  WEAPONS,
  WEAPON_MOUNTS,
  WEAPON_GRIP_SHIFT,
  HAND_GRIP,
} from "../../src/weapon-spec.ts";

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS),
  report = [];
const floorProfiles = JSON.parse(
  await readFile("public/assets/cast/floor-v7.json", "utf8"),
).profiles;
function nativeFloor(profile, name, time) {
  const c = floorProfiles[profile]?.clips[name];
  if (!c) return 0;
  const i = Math.min(
      c.offsets.length - 2,
      Math.floor(Math.min(c.duration, time) * 60),
    ),
    u = Math.min(
      1,
      (time - i / 60) / (Math.min(c.duration, (i + 1) / 60) - i / 60 || 1),
    );
  return c.offsets[i] * (1 - u) + c.offsets[i + 1] * u;
}

const sequence = [
  ["Idle", 0.4],
  ["Attack1", 0.62],
  ["DodgeBack", 0.82],
  ["Guard", 0.35],
  ["Attack2", 0.7],
  ["DodgeRight", 0.82],
  ["Run", 0.4],
  ["Attack3", 1.15],
  ["HitFront", 0.4],
  ["Idle", 0.4],
  ["DodgeForward", 0.82],
  ["DodgeLeft", 0.82],
  ["Drink", 1.3],
  ["HitFront", 0.4],
  ["DeathBack", 2],
  ["RESET", 0],
  ["Idle", 0.3],
  ["DeathFront", 2],
  ["RESET", 0],
  ["Idle", 0.3],
  ["DeathSide", 2],
];
for (const character of ["prisoner", "watcher", "gaoler", "effigy"]) {
  const model = character === "effigy" ? "prisoner" : character;
  const d = await io.read(`public/assets/cast/${model}.glb`),
    motion = await io.read(
      `public/assets/motion/${character === "gaoler" ? "gaoler" : "prisoner"}-combat.glb`,
    );
  const fixes = await io.read(
    `public/assets/motion/${character === "gaoler" ? "gaoler" : "prisoner"}-fixes1.glb`,
  );
  const clips = new Map(
    [
      ...d.getRoot().listAnimations(),
      ...motion.getRoot().listAnimations(),
      ...fixes.getRoot().listAnimations(),
    ].map((c) => [c.getName(), c]),
  );
  const variants =
    character === "prisoner"
      ? [
          ["sword", 1],
          ["axe", 1],
          ["spear", 1],
          ["unarmed", 1],
          ["unarmed", 0],
        ]
      : character === "gaoler"
        ? [["axe", 0]]
        : character === "effigy"
          ? [["unarmed", 0]]
          : [["sword", 0]];
  for (const [weapon, armour] of variants) {
    const rig = threeRig(d);
    if (character === "effigy") rig.root.scale.setScalar(1.03);
    const controller = new GearPose(rig.root, character === "gaoler"),
      continuity = new SkeletonContinuity(rig.root, character === "gaoler"),
      feet = new FootContact(rig.root);
    const bones = [
      "upperarm_R",
      "forearm_R",
      "hand_R",
      "upperarm_L",
      "forearm_L",
      "hand_L",
    ].map((n) => rig.root.getObjectByName(n));
    const allBones = [];
    rig.root.traverse((o) => {
      if (o.isBone) allBones.push(o);
    });
    const previousSkeleton = allBones.map((o) => o.quaternion.clone());
    let maxSkeleton = 0,
      worstSkeleton = {};
    const chain = [];
    for (let o = bones[2]; o; o = o.parent) chain.push(o);
    let priorChain = [];
    const previous = bones.map(() => new THREE.Quaternion()),
      prevHand = new THREE.Vector3(),
      prevLeft = new THREE.Vector3();
    let first = true,
      maxAngle = 0,
      maxJump = 0,
      worst = {},
      worstHand = {},
      priorNative = null,
      total = 0;
    let floorOffset = 0;
    const times = [];
    for (const [semanticName, duration] of sequence) {
      if (semanticName === "RESET") {
        controller.reset();
        continuity.reset();
        priorNative = null;
        floorOffset = 0;
        first = true;
        continue;
      }
      const name = semanticName.startsWith("Dodge")
        ? motionName({
            mode: "dodge",
            kind: character === "prisoner" ? "pilgrim" : character,
            weapon,
            armour,
            dodgeSide: semanticName.slice(5),
          })
        : weapon === "sword" && semanticName.startsWith("Attack")
          ? "Sword" + semanticName
          : semanticName;
      const c = clips.get(name === "Drink" ? "Idle" : name);
      assert(c, `${character}: missing ${name}`);
      let lastNative;
      const tempo = /Attack/.test(name) ? WEAPONS[weapon].tempo : 1;
      for (let f = 0; f <= Math.ceil((duration * 60) / tempo); f++) {
        const worldTime = f / 60,
          t = Math.min(duration, worldTime * tempo),
          raw = sample(
            rig.info,
            c,
            /Attack/.test(name)
              ? sourceAttackTime(name, t, Number(name.at(-1)) - 1)
              : t,
          ),
          pose =
            priorNative && worldTime < 0.09
              ? blend(priorNative, raw, worldTime / 0.09)
              : raw;
        lastNative = raw;
        rig.root.position.y = 0;
        setPose(rig, pose);
        continuity.apply(1 / 60);
        const floorTarget = /^(Death|Dodge)/.test(name)
          ? nativeFloor(model, name, t) * rig.root.scale.y
          : feet.offset(0);
        floorOffset =
          floorTarget > floorOffset
            ? floorTarget
            : THREE.MathUtils.damp(floorOffset, floorTarget, 28, 1 / 60);
        rig.root.position.y = floorOffset;
        const start = performance.now();
        if (name.startsWith("Death") && t > 0.25) controller.release(1 / 60);
        else controller.apply(weapon, name, 0, undefined, t, 1 / 60);
        if (name === "Drink") controller.drink(t, 1 / 60);
        times.push(performance.now() - start);
        const hand = bones[2].getWorldPosition(new THREE.Vector3()),
          leftHand = bones[5].getWorldPosition(new THREE.Vector3());
        if (!first) {
          for (let i = 0; i < allBones.length; i++) {
            const angle = THREE.MathUtils.radToDeg(
              previousSkeleton[i].angleTo(allBones[i].quaternion),
            );
            assert(
              Number.isFinite(angle),
              `${character}/${name}/${t}: non-finite skeleton`,
            );
            if (angle > maxSkeleton) {
              maxSkeleton = angle;
              worstSkeleton = { clip: name, time: t, bone: allBones[i].name };
            }
          }
          for (let i = 0; i < bones.length; i++) {
            const angle = THREE.MathUtils.radToDeg(
              previous[i].angleTo(bones[i].quaternion),
            );
            if (angle > maxAngle) {
              maxAngle = angle;
              worst = { clip: name, time: t, bone: bones[i].name };
            }
          }
          const jump = Math.max(
            hand.distanceTo(prevHand),
            leftHand.distanceTo(prevLeft),
          );
          if (jump > maxJump) {
            maxJump = jump;
            worstHand = {
              clip: name,
              time: t,
              parents: chain.map((o, i) => ({
                name: o.name,
                localDegrees: priorChain[i]
                  ? THREE.MathUtils.radToDeg(
                      priorChain[i].q.angleTo(o.quaternion),
                    )
                  : 0,
                translation: priorChain[i]
                  ? priorChain[i].p.distanceTo(o.position)
                  : 0,
                scale: o.scale.toArray(),
              })),
            };
          }
        }
        allBones.forEach((o, i) => previousSkeleton[i].copy(o.quaternion));
        priorChain = chain.map((o) => ({
          q: o.quaternion.clone(),
          p: o.position.clone(),
        }));
        bones.forEach((b, i) => previous[i].copy(b.quaternion));
        prevHand.copy(hand);
        prevLeft.copy(leftHand);
        first = false;
        total++;
      }
      priorNative = lastNative;
    }
    times.sort((a, b) => a - b);
    report.push({
      character,
      weapon,
      armour,
      frames: total,
      max_skeleton_degrees_per_frame: maxSkeleton,
      worstSkeleton,
      max_joint_degrees_per_frame: maxAngle,
      max_hand_metres_per_frame: maxJump,
      worst,
      worstHand,
      pose_p95_ms: times[Math.floor(times.length * 0.95)],
    });
  }
}
await mkdir("work/fixes1", { recursive: true });
await writeFile(
  `work/fixes1/${process.argv.includes("--baseline") ? "baseline-" : "current-"}continuity.json`,
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    report.map(({ worstHand, ...r }) => ({
      ...r,
      worstHand: { clip: worstHand.clip, time: worstHand.time },
    })),
  ),
);
if (!process.argv.includes("--baseline")) {
  assert(
    report.every((r) => r.max_joint_degrees_per_frame < 18),
    "Arm joint jumps by >=18 degrees between consecutive 60 Hz frames",
  );
  assert(
    report.every((r) => r.max_skeleton_degrees_per_frame < 28),
    "Skeleton joint jumps by >=28 degrees between consecutive 60 Hz frames",
  );
  assert(
    report.every((r) => r.max_hand_metres_per_frame < 0.16),
    "Hand jumps >=16 cm in one frame",
  );
}
