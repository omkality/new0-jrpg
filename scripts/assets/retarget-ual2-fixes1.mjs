// Separate CC0 motion assets. Never rewrites the approved *-combat.glb files.
// Run: node scripts/assets/retarget-ual2-fixes1.mjs [--swords-only]
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { Matrix4, Quaternion, Vector3 } from "three";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { animationOnly, animationDigest } from "./animation-io.mjs";
import {
  structure,
  sample,
  clone,
  blend,
  smooth,
  position,
  rotation,
  world,
} from "./pose-sampling.mjs";

const project = fileURLToPath(new URL("../../", import.meta.url));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const work = resolve(project, "work/fixes1/references");
const outputDir = resolve(project, "public/assets/motion");
const swordsOnly = process.argv.includes("--swords-only");
const sha = (b) => createHash("sha256").update(b).digest("hex");
await mkdir(work, { recursive: true });
const protectedFiles = [
  "combat.glb",
  "prisoner-combat.glb",
  "gaoler-combat.glb",
  "contract.json",
];
const protectedBefore = Object.fromEntries(
  await Promise.all(
    protectedFiles.map(async (f) => [
      f,
      sha(await readFile(resolve(outputDir, f))),
    ]),
  ),
);
const previousStepDigests = new Map();
let previousGaolerHash = null;
for (const character of ["prisoner", "gaoler"]) {
  try {
    const document = await io.read(
      resolve(outputDir, `${character}-fixes1.glb`),
    );
    if (character === "gaoler")
      previousGaolerHash = sha(
        await readFile(resolve(outputDir, "gaoler-fixes1.glb")),
      );
    for (const a of document
      .getRoot()
      .listAnimations()
      .filter((a) => a.getName().startsWith("WeaponStep")))
      previousStepDigests.set(
        character + "/" + a.getName(),
        animationDigest(a),
      );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const swordPosture = {
  minimumGroundedPelvisMetres: 0.7,
  maximumPelvisTiltDegrees: 20,
  maximumPelvisToNeckTiltDegrees: 40,
  pelvisTiltSoftBandDegrees: 5,
  torsoTiltSoftBandDegrees: 6,
  ankleHeightAndWorldOrientationPreserved: true,
  recoveryExportOffsetCompensated: true,
  nativeIdleEndpointTRS: true,
  footHorizontalPolicy:
    "Only reduce source reach when the raised pelvis makes the target physically unreachable. Bone lengths and scales remain unchanged.",
};
const swordPostureQA = {
  samples: 0,
  modifiedSamples: 0,
  maxFootHeightError: 0,
  maxFootWorldAngleErrorDegrees: 0,
  maxFootHorizontalShift: 0,
};

const ual1File = resolve(
  project,
  "work/roll-research/quaternius/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb",
);
const ual2File = resolve(work, "UAL2_Standard.glb");
const ual1Doc = await io.read(ual1File),
  ual2Doc = await io.read(ual2File);
const ual1 = structure(ual1Doc),
  ual2 = structure(ual2Doc);
const clips1 = new Map(
  ual1Doc
    .getRoot()
    .listAnimations()
    .map((a) => [a.getName(), a]),
);
const clips2 = new Map(
  ual2Doc
    .getRoot()
    .listAnimations()
    .map((a) => [a.getName(), a]),
);
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
const names = Object.values(boneMap);
const duration = (clip) =>
  Math.max(...clip.listSamplers().map((s) => s.getInput().getArray().at(-1)));
const sourceIdle = sample(ual2, clips1.get("Idle_Loop"), 0);
const sourceRefs = new Map(
  Object.keys(boneMap).map((name) => [
    name,
    {
      p: position(ual2, sourceIdle, ual2.byName.get(name)),
      q: rotation(ual2, sourceIdle, ual2.byName.get(name)),
    },
  ]),
);
const Y = new Vector3(0, 1, 0),
  X = new Vector3(1, 0, 0),
  Z = new Vector3(0, 0, 1);
const controlledArms = new Set([
  "upperarm_L",
  "forearm_L",
  "hand_L",
  "upperarm_R",
  "forearm_R",
  "hand_R",
]);
const attackContract = [
  {
    name: "Attack1",
    clip: "SwordAttack1",
    duration: 0.85,
    contact: 0.3,
    link: 0.52,
    cancel: 0.57,
    damage: 16,
    cost: 16,
    lunge: 1.5,
    chain: true,
  },
  {
    name: "Attack2",
    clip: "SwordAttack2",
    duration: 0.77,
    contact: 0.27,
    link: 0.51,
    cancel: 0.56,
    damage: 18,
    cost: 18,
    lunge: 1.8,
    chain: true,
  },
  {
    name: "Attack3",
    clip: "SwordAttack3",
    duration: 1.15,
    contact: 0.62,
    link: 1.15,
    cancel: 0.96,
    damage: 28,
    cost: 24,
    lunge: 2.3,
    chain: false,
  },
];
function phaseMapping(descriptor) {
  if (descriptor.clock) {
    const clock = descriptor.clock;
    return {
      method:
        "Monotone PCHIP source-to-semantic arc clock, inverse sampled during baking. Semantic time is runtime clip time.",
      sourceClips: descriptor.sourceName.includes("_C")
        ? [descriptor.sourceName]
        : [descriptor.sourceName, descriptor.sourceName + "_Rec"],
      sourceClockLandmarks: clock.landmarks,
      postureAdaptation: swordPosture,
      semanticToConcatenatedSource: Array.from(
        { length: Math.ceil(descriptor.duration * 60) + 1 },
        (_, i) => {
          const t = Math.min(descriptor.duration, i / 60);
          return [t, clock.at(t)];
        },
      ),
    };
  }
  return {
    method:
      "Original low-body directional adaptation of UAL1 Walk_Loop. Runtime clip time is semantic time.",
    sourceClip: "Walk_Loop",
    sourceDuration: duration(clips1.get("Walk_Loop")),
    sourceCycleWindow: [0.1, 0.7],
    reverseSource: descriptor.name === "WeaponStepBack",
    fadeInEnd: 0.14,
    fadeOutStart: 0.65,
    horizontalFootAmplitude: 0.65,
    rootLoweringMetres: 0.1,
    controllerOwnsHorizontalTravel: true,
  };
}

function setWorldQ(info, pose, node, q) {
  const parent = info.parent.get(node);
  const parentQ = parent ? rotation(info, pose, parent) : new Quaternion();
  pose.get(node).q.copy(parentQ.invert().multiply(q)).normalize();
}
function rotateWorld(info, pose, name, axis, amount) {
  const n = info.byName.get(name);
  setWorldQ(
    info,
    pose,
    n,
    new Quaternion()
      .setFromAxisAngle(axis, amount)
      .multiply(rotation(info, pose, n)),
  );
}
function aim(info, pose, a, b, target) {
  const start = position(info, pose, a);
  const from = position(info, pose, b).sub(start).normalize();
  const to = target.clone().sub(start).normalize();
  setWorldQ(
    info,
    pose,
    a,
    new Quaternion()
      .setFromUnitVectors(from, to)
      .multiply(rotation(info, pose, a)),
  );
}
function legIK(info, pose, side, endpoint, pole) {
  const a = info.byName.get(`thigh_${side}`),
    b = info.byName.get(`shin_${side}`),
    c = info.byName.get(`foot_${side}`);
  const start = position(info, pose, a),
    l1 = pose.get(b).p.length(),
    l2 = pose.get(c).p.length();
  const dir = endpoint.clone().sub(start);
  // A lowered heavy-weapon step keeps a bent knee. Smoothly approach maximum
  // reach instead of suddenly releasing a straight, hard-clamped leg.
  const maxReach = l1 + l2 - 0.025,
    band = 0.04;
  const requested = Math.max(Math.abs(l1 - l2) + 0.01, dir.length());
  const d =
    requested <= maxReach - band
      ? requested
      : maxReach - band * Math.exp(-(requested - (maxReach - band)) / band);
  dir.normalize();
  const perpendicular = pole.clone().sub(start);
  perpendicular.addScaledVector(dir, -perpendicular.dot(dir));
  if (perpendicular.lengthSq() < 1e-8) perpendicular.copy(Z);
  perpendicular.normalize();
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const knee = start
    .clone()
    .addScaledVector(dir, along)
    .addScaledVector(
      perpendicular,
      Math.sqrt(Math.max(0, l1 * l1 - along * along)),
    );
  aim(info, pose, a, b, knee);
  aim(info, pose, b, c, start.clone().addScaledVector(dir, d));
}

// Source hand travel determines the physical source contact. It is not inferred
// from an arbitrary percentage of clip duration. Store the measured trajectory.
function wristTrajectory(name) {
  const c = clips2.get(name),
    end = duration(c),
    rows = [];
  for (let i = 0; i <= Math.ceil(end * 240); i++) {
    const t = Math.min(end, i / 240),
      pose = sample(ual2, c, t);
    const hand = position(ual2, pose, ual2.byName.get("hand_r"));
    const hip = position(ual2, pose, ual2.byName.get("pelvis"));
    rows.push({ time: t, hand: hand.toArray(), reach: hand.z - hip.z });
  }
  // The forward-most hand in the attack's first active burst is the extension
  // landmark. The third clip includes its own long recovery after this burst.
  const candidates = rows.filter(
    (r) => r.time > 0.08 && r.time < Math.min(end, 0.95),
  );
  const contact = candidates.reduce((a, b) => (b.reach > a.reach ? b : a));
  return { contact: contact.time, contactPosition: contact.hand, rows };
}
const trajectory = Object.fromEntries(
  ["A", "B", "C"].map((x) => [
    `Sword_Regular_${x}`,
    wristTrajectory(`Sword_Regular_${x}`),
  ]),
);

// Shape-preserving cubic interpolation. The domain is a strictly monotone
// concatenated source clock; output inversion never reverses/restarts a clip.
function monotoneSpline(xs, ys) {
  const h = xs.slice(1).map((x, i) => x - xs[i]);
  const d = h.map((v, i) => (ys[i + 1] - ys[i]) / v);
  const m = xs.map((_, i) => {
    if (i === 0) return d[0];
    if (i === xs.length - 1) return d.at(-1);
    if (d[i - 1] * d[i] <= 0) return 0;
    const w1 = 2 * h[i] + h[i - 1],
      w2 = h[i] + 2 * h[i - 1];
    return (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  });
  return (x) => {
    let lo = 0,
      hi = xs.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    const i = Math.min(xs.length - 2, lo),
      u = Math.max(0, Math.min(1, (x - xs[i]) / h[i]));
    return (
      (2 * u * u * u - 3 * u * u + 1) * ys[i] +
      (u * u * u - 2 * u * u + u) * h[i] * m[i] +
      (-2 * u * u * u + 3 * u * u) * ys[i + 1] +
      (u * u * u - u * u) * h[i] * m[i + 1]
    );
  };
}
function sourceClock(parts, landmarks, context) {
  const end = parts.reduce((s, p) => s + duration(p), 0);
  const sourceAt = (t) => {
    let start = 0;
    for (const part of parts) {
      const last = start + duration(part);
      if (t <= last + 1e-9) return sample(ual2, part, t - start);
      start = last;
    }
    return sample(ual2, parts.at(-1), duration(parts.at(-1)));
  };
  const xs = [
    ...new Set([
      0,
      end,
      ...landmarks.map(([x]) => x),
      ...Array.from(
        { length: Math.floor(end * 240) },
        (_, i) => (i + 1) / 240,
      ).filter((t) => t < end),
    ]),
  ].sort((a, b) => a - b);
  const arc = [0];
  let previous = sourceAt(0),
    priorTarget = context.foreign(previous);
  for (let i = 1; i < xs.length; i++) {
    const pose = sourceAt(xs[i]);
    const target = context.foreign(pose);
    let angular = 0;
    for (const name of names)
      angular = Math.max(
        angular,
        target
          .get(context.info.byName.get(name))
          .q.angleTo(priorTarget.get(context.info.byName.get(name)).q),
      );
    const handTravel = position(
      context.info,
      target,
      context.info.byName.get("hand_R"),
    ).distanceTo(
      position(context.info, priorTarget, context.info.byName.get("hand_R")),
    );
    // Joint and hand limits share a minimum-time metric, so neither a quiet
    // wrist nor a fast knee can be accidentally accelerated by the other.
    arc.push(
      arc.at(-1) +
        Math.max(
          0.05 * (xs[i] - xs[i - 1]),
          handTravel / 9.6,
          angular / (((18 * Math.PI) / 180) * 60),
        ),
    );
    previous = pose;
    priorTarget = target;
  }
  const outputTimes = xs.map((x, i) => {
    let j = 0;
    while (j < landmarks.length - 2 && x > landmarks[j + 1][0] + 1e-9) j++;
    const [a, av] = landmarks[j],
      [b, bv] = landmarks[j + 1];
    const ai = xs.findIndex((v) => Math.abs(v - a) < 1e-8),
      bi = xs.findIndex((v) => Math.abs(v - b) < 1e-8);
    return av + ((bv - av) * (arc[i] - arc[ai])) / (arc[bi] - arc[ai]);
  });
  const toOutput = monotoneSpline(xs, outputTimes);
  const outEnd = landmarks.at(-1)[1];
  const phaseBounds = landmarks.slice(1).map(([b, bv], j) => {
    const [a, av] = landmarks[j],
      ai = xs.findIndex((x) => Math.abs(x - a) < 1e-8),
      bi = xs.findIndex((x) => Math.abs(x - b) < 1e-8);
    return {
      sourceStart: a,
      sourceEnd: b,
      targetStart: av,
      targetEnd: bv,
      minimumTimeAt18DegreesAnd16cmPerFrame: arc[bi] - arc[ai],
    };
  });
  return {
    sourceAt,
    landmarks,
    phaseBounds,
    end,
    at(t) {
      if (t <= 0) return 0;
      if (t >= outEnd) return end;
      let a = 0,
        b = end;
      for (let i = 0; i < 35; i++) {
        const m = (a + b) / 2;
        if (toOutput(m) < t) a = m;
        else b = m;
      }
      return (a + b) / 2;
    },
  };
}

function targetContext(doc) {
  const info = structure(doc),
    idleClip = doc
      .getRoot()
      .listAnimations()
      .find((a) => a.getName() === "Idle");
  const idle = sample(info, idleClip, 0),
    refs = new Map(
      names.map((name) => [
        name,
        {
          p: position(info, idle, info.byName.get(name)),
          q: rotation(info, idle, info.byName.get(name)),
        },
      ]),
    );
  const hipRatio = refs.get("pelvis").p.y / sourceRefs.get("pelvis").p.y;
  function foreign(srcPose) {
    const pose = clone(idle);
    for (const [sn, dn] of Object.entries(boneMap)) {
      const q = rotation(ual2, srcPose, ual2.byName.get(sn))
        .multiply(sourceRefs.get(sn).q.clone().invert())
        .multiply(refs.get(dn).q);
      setWorldQ(info, pose, info.byName.get(dn), q);
    }
    const p = refs
      .get("pelvis")
      .p.clone()
      .addScaledVector(
        position(ual2, srcPose, ual2.byName.get("pelvis")).sub(
          sourceRefs.get("pelvis").p,
        ),
        hipRatio,
      );
    const pelvis = info.byName.get("pelvis"),
      parent = info.parent.get(pelvis);
    if (parent) p.applyMatrix4(world(info, pose, parent).invert());
    pose.get(pelvis).p.copy(p);
    return pose;
  }
  return { info, idle, refs, hipRatio, foreign };
}

function swordBodyAdapter(context) {
  const { info, idle } = context,
    pelvis = info.byName.get("pelvis"),
    spine = info.byName.get("spine1"),
    neck = info.byName.get("neck");
  const pelvisUpLocal = Y.clone().applyQuaternion(
    rotation(info, idle, pelvis).invert(),
  );
  const feet = new Set(["foot_L", "toe_L", "foot_R", "toe_R"]);
  const soles = weightedMeshes(info)
    .map((mesh) => ({
      ...mesh,
      used: mesh.used.filter((v) => {
        let weight = 0;
        for (let k = 0; k < 4; k++)
          if (feet.has(mesh.bones[mesh.j[v * 4 + k]].getName()))
            weight += mesh.w[v * 4 + k];
        return weight > 0.65;
      }),
    }))
    .filter((mesh) => mesh.used.length);
  assert(
    soles.length > 0,
    "Sword grounding needs actual weighted foot vertices",
  );
  const limited = (value, max, band) =>
    value <= max - band
      ? value
      : max - band * Math.exp(-(value - (max - band)) / band);
  const liftHinge = (value, band) =>
    value <= 0
      ? 0
      : value < band
        ? (value * value) / (2 * band)
        : value - band / 2;
  const lean = (v) => Math.acos(Math.max(-1, Math.min(1, v.y / v.length())));
  function worldP(pose, node, p) {
    const parent = info.parent.get(node);
    pose
      .get(node)
      .p.copy(
        parent ? p.clone().applyMatrix4(world(info, pose, parent).invert()) : p,
      );
  }
  function exactLeg(pose, side, endpoint, pole, footQ) {
    const a = info.byName.get(`thigh_${side}`),
      b = info.byName.get(`shin_${side}`),
      c = info.byName.get(`foot_${side}`);
    const hip = position(info, pose, a),
      l1 = pose.get(b).p.length(),
      l2 = pose.get(c).p.length(),
      maxReach = l1 + l2 - 0.02;
    const vertical = endpoint.y - hip.y;
    assert(
      Math.abs(vertical) < maxReach,
      "Grounded sword leg has unreachable vertical target",
    );
    const radius = Math.sqrt(maxReach * maxReach - vertical * vertical),
      dx = endpoint.x - hip.x,
      dz = endpoint.z - hip.z,
      r = Math.hypot(dx, dz),
      band = Math.min(0.055, radius * 0.2);
    if (r > radius - band) {
      const bounded = limited(r, radius, band);
      endpoint.x = hip.x + (dx * bounded) / r;
      endpoint.z = hip.z + (dz * bounded) / r;
    }
    const direction = endpoint.clone().sub(hip),
      distance = direction.length();
    direction.normalize();
    const perpendicular = pole.clone().sub(hip);
    perpendicular.addScaledVector(direction, -perpendicular.dot(direction));
    if (perpendicular.lengthSq() < 1e-10) {
      perpendicular.copy(Z).addScaledVector(direction, -direction.z);
    }
    perpendicular.normalize();
    const along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance),
      height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    const knee = hip
      .clone()
      .addScaledVector(direction, along)
      .addScaledVector(perpendicular, height);
    aim(info, pose, a, b, knee);
    aim(info, pose, b, c, endpoint);
    setWorldQ(info, pose, c, footQ);
  }
  return function adapt(pose) {
    swordPostureQA.samples++;
    const hipBefore = position(info, pose, pelvis),
      up = pelvisUpLocal.clone().applyQuaternion(rotation(info, pose, pelvis));
    const hipGround = hipBefore.y + 0.008 - minSkinY(info, pose, soles),
      lift = liftHinge(0.72 - hipGround, 0.04);
    const hipTilt = lean(up),
      hipTarget = limited(hipTilt, (20 * Math.PI) / 180, (5 * Math.PI) / 180);
    const bodyBefore = position(info, pose, neck).sub(hipBefore),
      bodyTilt = lean(bodyBefore);
    if (lift === 0 && hipTilt === hipTarget && bodyTilt <= (34 * Math.PI) / 180)
      return pose;
    swordPostureQA.modifiedSamples++;
    const contacts = ["L", "R"].map((side) => ({
      side,
      hip: position(info, pose, info.byName.get(`thigh_${side}`)),
      knee: position(info, pose, info.byName.get(`shin_${side}`)),
      foot: position(info, pose, info.byName.get(`foot_${side}`)),
      q: rotation(info, pose, info.byName.get(`foot_${side}`)),
    }));
    if (lift > 0)
      worldP(pose, pelvis, hipBefore.clone().addScaledVector(Y, lift));
    if (hipTilt > hipTarget) {
      const axis = up.clone().cross(Y).normalize();
      setWorldQ(
        info,
        pose,
        pelvis,
        new Quaternion()
          .setFromAxisAngle(axis, hipTilt - hipTarget)
          .multiply(rotation(info, pose, pelvis)),
      );
    }
    const hip = position(info, pose, pelvis),
      v = position(info, pose, neck).sub(hip),
      tilt = lean(v),
      targetTilt = limited(tilt, (40 * Math.PI) / 180, (6 * Math.PI) / 180);
    if (tilt > targetTilt) {
      const origin = position(info, pose, spine),
        fixed = origin.clone().sub(hip),
        upper = position(info, pose, neck).sub(origin),
        axis = v.clone().cross(Y).normalize();
      let low = 0,
        high = Math.min(Math.PI / 2, tilt + Math.PI / 6);
      for (let k = 0; k < 28; k++) {
        const mid = (low + high) / 2,
          newV = upper.clone().applyAxisAngle(axis, mid).add(fixed);
        if (lean(newV) > targetTilt) low = mid;
        else high = mid;
      }
      setWorldQ(
        info,
        pose,
        spine,
        new Quaternion()
          .setFromAxisAngle(axis, (low + high) / 2)
          .multiply(rotation(info, pose, spine)),
      );
    }
    for (const contact of contacts) {
      const hipShift = position(
        info,
        pose,
        info.byName.get(`thigh_${contact.side}`),
      ).sub(contact.hip);
      exactLeg(
        pose,
        contact.side,
        contact.foot.clone(),
        contact.knee.clone().addScaledVector(hipShift, 0.5),
        contact.q,
      );
      const solvedFoot = position(
        info,
        pose,
        info.byName.get(`foot_${contact.side}`),
      );
      swordPostureQA.maxFootHeightError = Math.max(
        swordPostureQA.maxFootHeightError,
        Math.abs(solvedFoot.y - contact.foot.y),
      );
      swordPostureQA.maxFootWorldAngleErrorDegrees = Math.max(
        swordPostureQA.maxFootWorldAngleErrorDegrees,
        (rotation(info, pose, info.byName.get(`foot_${contact.side}`)).angleTo(
          contact.q,
        ) *
          180) /
          Math.PI,
      );
      swordPostureQA.maxFootHorizontalShift = Math.max(
        swordPostureQA.maxFootHorizontalShift,
        Math.hypot(
          solvedFoot.x - contact.foot.x,
          solvedFoot.z - contact.foot.z,
        ),
      );
    }
    return pose;
  };
}

function swordDescriptors(context) {
  const { foreign, idle } = context;
  const adaptBody = swordBodyAdapter(context),
    clockContext = { ...context, foreign: (src) => adaptBody(foreign(src)) };
  const durations = attackContract.map((a) => a.duration),
    contacts = attackContract.map((a) => a.contact),
    links = attackContract.map((a) => a.link);
  const desc = [];
  for (let index = 0; index < 3; index++) {
    const letter = "ABC"[index],
      sourceName = `Sword_Regular_${letter}`,
      part = clips2.get(sourceName),
      partEnd = duration(part);
    const rec = index < 2 ? clips2.get(`${sourceName}_Rec`) : null,
      sourceContact = trajectory[sourceName].contact;
    const total = partEnd + (rec ? duration(rec) : 0);
    const clock = sourceClock(
      rec ? [part, rec] : [part],
      [
        [0, 0],
        [sourceContact, contacts[index]],
        ...(rec ? [[partEnd, links[index]]] : []),
        [total, durations[index]],
      ],
      clockContext,
    );
    const nextEntry =
      index < 2
        ? foreign(
            sample(ual2, clips2.get(`Sword_Regular_${"ABC"[index + 1]}`), 0),
          )
        : null;
    const entry = foreign(sample(ual2, part, 0));
    const linkPose = nextEntry ? foreign(sample(ual2, part, partEnd)) : null;
    const recoveryEnd = rec ? foreign(sample(ual2, rec, duration(rec))) : null;
    desc.push({
      name: `SwordAttack${index + 1}`,
      duration: durations[index],
      contact: contacts[index],
      link: links[index],
      cancel: attackContract[index].cancel,
      sourceName,
      clock,
      sourceContact,
      poseAt(t) {
        let pose = foreign(clock.sourceAt(clock.at(t)));
        if (index === 0 && t < 0.06) {
          // Decay the small entry offset instead of scaling the entire moving
          // pose. A blend toward a moving pose multiplies its acceleration.
          const amount = 1 - smooth(t / 0.06);
          for (const name of names) {
            const n = context.info.byName.get(name),
              correction = idle
                .get(n)
                .q.clone()
                .multiply(entry.get(n).q.clone().invert());
            pose
              .get(n)
              .q.premultiply(new Quaternion().slerp(correction, amount))
              .normalize();
            pose
              .get(n)
              .p.addScaledVector(
                idle.get(n).p.clone().sub(entry.get(n).p),
                amount,
              );
          }
        }
        if (nextEntry) {
          const link = links[index],
            width = 0.075;
          const amount =
            t <= link
              ? smooth((t - (link - width)) / width)
              : 1 - smooth((t - link) / 0.1);
          if (amount > 0)
            for (const name of names) {
              const n = context.info.byName.get(name),
                correction = nextEntry
                  .get(n)
                  .q.clone()
                  .multiply(linkPose.get(n).q.clone().invert());
              pose
                .get(n)
                .q.premultiply(new Quaternion().slerp(correction, amount))
                .normalize();
              pose
                .get(n)
                .p.addScaledVector(
                  nextEntry.get(n).p.clone().sub(linkPose.get(n).p),
                  amount,
                );
            }
          if (t === link) return adaptBody(clone(nextEntry));
        }
        if (recoveryEnd && t > links[index]) {
          // UAL2's exported standing recovery is displaced about eight
          // centimetres from UAL1 Idle. Remove this constant reference offset
          // over recovery rather than snapping the actor on the next Idle.
          const amount = smooth(
            (t - links[index]) / (durations[index] - links[index]),
          );
          for (const name of names) {
            const n = context.info.byName.get(name),
              correction = idle
                .get(n)
                .q.clone()
                .multiply(recoveryEnd.get(n).q.clone().invert());
            pose
              .get(n)
              .q.premultiply(new Quaternion().slerp(correction, amount))
              .normalize();
            pose
              .get(n)
              .p.addScaledVector(
                idle.get(n).p.clone().sub(recoveryEnd.get(n).p),
                amount,
              );
          }
        }
        // A/B source recoveries finish standing. Their constant export
        // reference offset is removed above without shortening full-body arcs.
        const finish = 0.06;
        if (index === 2 && t > durations[index] - finish)
          pose = blend(
            pose,
            idle,
            smooth((t - (durations[index] - finish)) / finish),
          );
        // B/C have a combo entry, not a fabricated return to standing between hits.
        if (t === 0 && index > 0) return adaptBody(clone(entry));
        return adaptBody(pose);
      },
    });
  }
  return desc;
}

function stepDescriptors(context) {
  const { info, idle, foreign, refs } = context;
  const gait = clips1.get("Walk_Loop"),
    gaitDuration = duration(gait);
  const descriptors = [];
  for (const [name, angle, reverse] of [
    ["WeaponStepForward", 0, false],
    ["WeaponStepBack", 0, true],
    ["WeaponStepLeft", Math.PI / 2, false],
    ["WeaponStepRight", -Math.PI / 2, false],
  ]) {
    descriptors.push({
      name,
      duration: 0.82,
      sourceName: "UAL1 Walk_Loop, original directional/low-body adaptation",
      poseAt(t) {
        const u = Math.max(0, Math.min(1, (t - 0.1) / 0.6));
        const sourceTime = (reverse ? 1 - u : u) * gaitDuration;
        const src = sample(ual2, gait, sourceTime);
        let pose = foreign(src);
        const envelope = smooth(t / 0.14) * (1 - smooth((t - 0.65) / 0.17));
        // Keep arm motion subdued for a long weapon. GearPose supplies the grip.
        for (const n of [
          "clavicle_L",
          "upperarm_L",
          "forearm_L",
          "hand_L",
          "clavicle_R",
          "upperarm_R",
          "forearm_R",
          "hand_R",
        ]) {
          const node = info.byName.get(n);
          pose.get(node).q.slerp(idle.get(node).q, 0.88);
        }
        const pelvis = info.byName.get("pelvis");
        pose.get(pelvis).p.x =
          idle.get(pelvis).p.x +
          (pose.get(pelvis).p.x - idle.get(pelvis).p.x) * 0.25;
        pose.get(pelvis).p.z = idle.get(pelvis).p.z;
        pose.get(pelvis).p.y -= 0.1 * envelope;
        rotateWorld(
          info,
          pose,
          "spine1",
          X,
          (reverse ? -0.1 : 0.14) * envelope,
        );
        if (angle)
          rotateWorld(
            info,
            pose,
            "chest",
            Z,
            Math.sign(angle) * 0.075 * envelope,
          );
        // Rotate endpoint DELTAS rather than flipping entire thigh/hip rotations.
        // Anatomical knee poles stay in front of the player, avoiding axial 180s.
        for (const side of ["L", "R"]) {
          const sn = `foot_${side.toLowerCase()}`,
            kneeSource = `calf_${side.toLowerCase()}`;
          const sourceLeg =
            sourceRefs
              .get(`thigh_${side.toLowerCase()}`)
              .p.distanceTo(sourceRefs.get(kneeSource).p) +
            sourceRefs.get(kneeSource).p.distanceTo(sourceRefs.get(sn).p);
          const targetLeg =
            refs.get(`thigh_${side}`).p.distanceTo(refs.get(`shin_${side}`).p) +
            refs.get(`shin_${side}`).p.distanceTo(refs.get(`foot_${side}`).p);
          const legRatio = targetLeg / sourceLeg;
          const delta = position(ual2, src, ual2.byName.get(sn))
            .sub(sourceRefs.get(sn).p)
            .applyAxisAngle(Y, angle);
          delta.x *= 0.65;
          delta.z *= 0.65;
          const endpoint = refs
            .get(`foot_${side}`)
            .p.clone()
            .addScaledVector(delta, legRatio);
          const knee = refs
            .get(`shin_${side}`)
            .p.clone()
            .addScaledVector(
              position(ual2, src, ual2.byName.get(kneeSource))
                .sub(sourceRefs.get(kneeSource).p)
                .applyAxisAngle(Y, angle),
              legRatio,
            );
          knee.z = Math.max(knee.z, refs.get(`shin_${side}`).p.z + 0.16);
          // Solve from the same anatomical reference at every time. Starting
          // from FK gait axial twist lets setFromUnitVectors select a different
          // swivel near a straight knee, producing an artificial IK flip.
          for (const joint of [`thigh_${side}`, `shin_${side}`]) {
            const n = info.byName.get(joint);
            pose.get(n).q.copy(idle.get(n).q);
          }
          legIK(info, pose, side, endpoint, knee);
          const foot = info.byName.get(`foot_${side}`);
          const q = rotation(info, pose, foot);
          setWorldQ(
            info,
            pose,
            foot,
            q.slerp(refs.get(`foot_${side}`).q, 0.45),
          );
        }
        pose = blend(idle, pose, envelope);
        return pose;
      },
    });
  }
  return descriptors;
}

function bake(doc, context, descriptor) {
  const root = doc.getRoot(),
    buffer = root.listBuffers()[0],
    { name } = descriptor;
  const times = [
    ...new Set([
      0,
      descriptor.duration,
      ...[descriptor.contact, descriptor.link].filter((x) => x != null),
      ...Array.from(
        { length: Math.floor(descriptor.duration * 60) },
        (_, i) => (i + 1) / 60,
      ).filter((t) => t < descriptor.duration),
    ]),
  ].sort((a, b) => a - b);
  const poses = times.map((t) => descriptor.poseAt(t));
  const animation = doc.createAnimation(name).setExtras({
    license: "CC0-1.0",
    fullBody: true,
    retargeted: true,
    source: descriptor.sourceName,
    semanticDuration: descriptor.duration,
    contact: descriptor.contact ?? null,
    link: descriptor.link ?? null,
    cancel: descriptor.cancel ?? null,
    phaseMapping: phaseMapping(descriptor),
    ...(name.startsWith("Sword") ? { postureAdaptation: swordPosture } : {}),
    provenance: name.startsWith("Sword")
      ? "Quaternius UAL2 Standard original full-body sword motion and recovery, proportion-retargeted with a grounded moderate-lunge posture adaptation and monotone phase retime for new0."
      : "Original new0 directional low-body weapon steps adapted from Quaternius UAL1 Standard Walk_Loop; not a sourced spear/dodge clip.",
  });
  const input = doc
    .createAccessor(name + "_time")
    .setType("SCALAR")
    .setArray(new Float32Array(times))
    .setBuffer(buffer);
  for (const boneName of names) {
    const node = context.info.byName.get(boneName),
      ps = [],
      qs = [];
    let prior = null;
    for (const pose of poses) {
      const state = pose.get(node),
        q = state.q.clone().normalize();
      if (prior && q.dot(prior) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      ps.push(...state.p.toArray());
      qs.push(...q.toArray());
      prior = q;
    }
    for (const [path, type, data] of [
      ["translation", "VEC3", ps],
      ["rotation", "VEC4", qs],
    ]) {
      const output = doc
        .createAccessor(name + "_" + boneName + "_" + path)
        .setType(type)
        .setArray(new Float32Array(data))
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
            .setTargetNode(node)
            .setTargetPath(path)
            .setSampler(sampler),
        );
    }
  }
  return animation;
}

function weightedMeshes(info) {
  const result = [];
  for (const node of info.nodes) {
    const mesh = node.getMesh(),
      skin = node.getSkin();
    if (!mesh || !skin) continue;
    for (const p of mesh.listPrimitives()) {
      if (!p.getAttribute("JOINTS_0") || !p.getAttribute("WEIGHTS_0")) continue;
      result.push({
        v: p.getAttribute("POSITION").getArray(),
        j: p.getAttribute("JOINTS_0").getArray(),
        w: p.getAttribute("WEIGHTS_0").getArray(),
        used: p.getIndices()
          ? [...new Set(p.getIndices().getArray())]
          : Array.from(
              { length: p.getAttribute("POSITION").getCount() },
              (_, i) => i,
            ),
        bones: skin.listJoints(),
        bind: skin.getInverseBindMatrices().getArray(),
      });
    }
  }
  return result;
}
function minSkinY(info, pose, meshes) {
  let minimum = Infinity;
  const cache = new Map();
  for (const mesh of meshes) {
    const ms = mesh.bones.map(
      (n, i) =>
        world(info, pose, n, cache).multiply(
          new Matrix4().fromArray(mesh.bind, i * 16),
        ).elements,
    );
    for (const v of mesh.used) {
      const x = mesh.v[v * 3],
        y = mesh.v[v * 3 + 1],
        z = mesh.v[v * 3 + 2];
      let py = 0;
      for (let k = 0; k < 4; k++) {
        const weight = mesh.w[v * 4 + k];
        if (!weight) continue;
        const m = ms[mesh.j[v * 4 + k]];
        py += weight * (m[1] * x + m[5] * y + m[9] * z + m[13]);
      }
      minimum = Math.min(minimum, py);
    }
  }
  return minimum;
}

const report = {
  version: 1,
  inputs: {
    ual1: sha(await readFile(ual1File)),
    ual2: sha(await readFile(ual2File)),
  },
  contracts: { attacks: attackContract, steps: 0.82 },
  sourceContacts: Object.fromEntries(
    Object.entries(trajectory).map(([name, x]) => [
      name,
      {
        sourceTime: x.contact,
        sourceHandPosition: x.contactPosition,
        criterion:
          "Maximum actual wrist forward reach relative to pelvis during the first strike; measured at 240 Hz. This measures the actual wrist, not a guessed virtual blade.",
      },
    ]),
  ),
  characters: [],
  profiles: [],
};
const produced = new Map();
const stepClipDigests = {};
for (const character of swordsOnly ? ["prisoner"] : ["prisoner", "gaoler"]) {
  const doc = await io.read(
      resolve(project, `public/assets/cast/${character}.glb`),
    ),
    context = targetContext(doc);
  const nodeBases = new Map(
    context.info.nodes.map((n) => [
      n.getName(),
      JSON.stringify([n.getTranslation(), n.getRotation(), n.getScale()]),
    ]),
  );
  for (const old of [...doc.getRoot().listAnimations()]) old.dispose();
  const descriptors = [
    ...(character === "prisoner" ? swordDescriptors(context) : []),
    ...(!swordsOnly ? stepDescriptors(context) : []),
  ];
  const animations = descriptors.map((d) => bake(doc, context, d));
  doc.getRoot().getAsset().copyright =
    "Quaternius CC0-1.0 motion, Patch CC0-1.0 target rig; original new0 adaptation";
  doc.getRoot().getAsset().extras = {
    version: "fixes1",
    character,
    source: "Quaternius official UAL1/UAL2 Standard",
    license: "CC0-1.0",
    approvedCombatFilesModified: false,
    controllerOwnsHorizontalTravel: true,
  };
  const prepared = animationOnly(doc, animations),
    path = resolve(outputDir, `${character}-fixes1.glb`);
  await io.write(path, prepared);
  const reread = await io.read(path);
  for (const animation of reread
    .getRoot()
    .listAnimations()
    .filter((a) => a.getName().startsWith("WeaponStep"))) {
    const key = character + "/" + animation.getName(),
      digest = animationDigest(animation);
    stepClipDigests[key] = digest;
    if (previousStepDigests.has(key))
      assert.equal(
        digest,
        previousStepDigests.get(key),
        "WeaponStep changed during a sword-only posture fix: " + key,
      );
  }
  for (const n of reread.getRoot().listNodes())
    assert.equal(
      JSON.stringify([n.getTranslation(), n.getRotation(), n.getScale()]),
      nodeBases.get(n.getName()),
      "Base TRS changed: " + character + "/" + n.getName(),
    );
  produced.set(character, reread);
  report.characters.push({
    character,
    file: `${character}-fixes1.glb`,
    bytes: (await readFile(path)).length,
    sha256: sha(await readFile(path)),
    baseRigTRSUnchanged: true,
    hipRatio: context.hipRatio,
    clips: descriptors.map((d) => ({
      name: d.name,
      duration: d.duration,
      source: d.sourceName,
      sourceContact: d.sourceContact ?? null,
      phaseMapping: phaseMapping(d),
      phaseBounds: d.clock?.phaseBounds ?? null,
    })),
  });
}

const floor = {
  version: 1,
  timeDomain: "semantic-seconds",
  contractFile: "fixes1-contract.json",
  sampling:
    "60 Hz offsets of weighted indexed skin surface, 240 Hz between-sample clearance verification. Negative offsets are intentional for new full-body clips.",
  sampleRate: 60,
  clearance: 0.008,
  profiles: {},
};
for (const character of swordsOnly
  ? ["prisoner", "watcher"]
  : ["prisoner", "watcher", "gaoler"]) {
  const castFile = resolve(project, `public/assets/cast/${character}.glb`),
    doc = await io.read(castFile),
    info = structure(doc),
    context = targetContext(doc),
    meshes = weightedMeshes(info);
  const motion = produced.get(character === "gaoler" ? "gaoler" : "prisoner");
  const profile = {
    geometryHash: sha(await readFile(castFile)),
    geometryHashMethod: "SHA256 of full target GLB",
    geometryFile: `${character}.glb`,
    motionFile:
      character === "gaoler" ? "gaoler-fixes1.glb" : "prisoner-fixes1.glb",
    clips: {},
  };
  const metrics = [];
  for (const clip of motion.getRoot().listAnimations()) {
    const dur = duration(clip),
      steps = Math.ceil(dur * 60),
      ts = Array.from({ length: steps + 1 }, (_, i) => Math.min(dur, i / 60));
    const offsets = ts.map(
      (t) => 0.008 - minSkinY(info, sample(info, clip, t), meshes),
    );
    // Raise only the curve where linear interpolation could undercut the skin
    // between 60 Hz samples. This is contact data, not rig scale or bone edits.
    for (let pass = 0; pass < 2; pass++)
      for (let i = 0; i < ts.length - 1; i++)
        for (const u of [0.25, 0.5, 0.75]) {
          const t = ts[i] + (ts[i + 1] - ts[i]) * u,
            needed = 0.008 - minSkinY(info, sample(info, clip, t), meshes),
            interpolated = offsets[i] * (1 - u) + offsets[i + 1] * u;
          if (needed > interpolated) {
            const up = needed - interpolated + 1e-7;
            offsets[i] += up;
            offsets[i + 1] += up;
          }
        }
    profile.clips[clip.getName()] = {
      duration: dur,
      semanticDuration: clip.getExtras().semanticDuration,
      timeDomain: "semantic-seconds",
      phaseMapping: clip.getExtras().phaseMapping,
      offsets: offsets.map((v) => Math.ceil(v * 1e6) / 1e6),
    };
    let maxJoint = 0,
      maxBodyJoint = 0,
      maxHand = 0,
      worst = "",
      worstBody = "",
      prev = null,
      minFloor = Infinity,
      maxFloor = -Infinity,
      maxLengthError = 0;
    const perJoint = Object.fromEntries(
      names.map((n) => [n, { maxDegreesPer60Hz: 0, time: 0 }]),
    );
    for (let i = 0; i <= Math.ceil(dur * 120); i++) {
      const t = Math.min(dur, i / 120),
        pose = sample(info, clip, t);
      const fi = Math.min(offsets.length - 2, Math.floor(t * 60)),
        u = (t - ts[fi]) / (ts[fi + 1] - ts[fi]);
      const corrected =
        minSkinY(info, pose, meshes) +
        offsets[fi] * (1 - u) +
        offsets[fi + 1] * u;
      minFloor = Math.min(minFloor, corrected);
      maxFloor = Math.max(maxFloor, corrected);
      for (const name of names) {
        const node = info.byName.get(name);
        if (name !== "pelvis")
          maxLengthError = Math.max(
            maxLengthError,
            Math.abs(
              pose.get(node).p.length() - context.idle.get(node).p.length(),
            ),
          );
      }
      if (prev && i % 2 === 0) {
        const prior = sample(info, clip, Math.max(0, t - 1 / 60));
        for (const name of names) {
          const n = info.byName.get(name),
            deg = (pose.get(n).q.angleTo(prior.get(n).q) * 180) / Math.PI;
          if (deg > maxJoint) {
            maxJoint = deg;
            worst = name + "@" + t.toFixed(3);
          }
          if (!controlledArms.has(name) && deg > maxBodyJoint) {
            maxBodyJoint = deg;
            worstBody = name + "@" + t.toFixed(3);
          }
          if (deg > perJoint[name].maxDegreesPer60Hz)
            perJoint[name] = { maxDegreesPer60Hz: deg, time: t };
        }
        maxHand = Math.max(
          maxHand,
          position(info, pose, info.byName.get("hand_R")).distanceTo(
            position(info, prior, info.byName.get("hand_R")),
          ),
        );
      }
      prev = pose;
    }
    const start = sample(info, clip, 0),
      end = sample(info, clip, dur);
    const endAngle = Math.max(
      ...names.map(
        (n) =>
          (end
            .get(info.byName.get(n))
            .q.angleTo(context.idle.get(info.byName.get(n)).q) *
            180) /
          Math.PI,
      ),
    );
    const startAngle = Math.max(
      ...names.map(
        (n) =>
          (start
            .get(info.byName.get(n))
            .q.angleTo(context.idle.get(info.byName.get(n)).q) *
            180) /
          Math.PI,
      ),
    );
    const endPositionError = Math.max(
      ...names.map((n) =>
        position(info, end, info.byName.get(n)).distanceTo(
          position(info, context.idle, info.byName.get(n)),
        ),
      ),
    );
    const metric = {
      name: clip.getName(),
      duration: dur,
      maxJointDegreesPer60Hz: maxJoint,
      worstJoint: worst,
      maxBodyJointDegreesPer60Hz: maxBodyJoint,
      worstBodyJoint: worstBody,
      perJoint,
      maxHandMetresPer60Hz: maxHand,
      maxBoneLengthError: maxLengthError,
      startMaxDegreesFromIdle: startAngle,
      endMaxDegreesFromIdle: endAngle,
      endMaxMetresFromIdle: endPositionError,
      minCorrectedSkinY: minFloor,
      maxCorrectedSkinY: maxFloor,
      minOffset: Math.min(...offsets),
      maxOffset: Math.max(...offsets),
    };
    assert(maxLengthError < 2e-6, "Bone lengths changed");
    assert(minFloor >= 0.00798, "Floor contact penetrated");
    assert(endAngle < 0.05, "Recovery does not finish at Idle");
    assert(
      endPositionError < 1e-5,
      "Recovery position does not finish at native Idle",
    );
    assert(
      maxJoint < 18.5,
      "Discontinuous >18.5 degree joint step at60Hz: " + JSON.stringify(metric),
    );
    metrics.push(metric);
  }
  // Exact shared link poses are measured after serialization, on each target rig.
  const seams = [];
  if (character !== "gaoler")
    for (const [from, link, to] of [
      ["SwordAttack1", 0.52, "SwordAttack2"],
      ["SwordAttack2", 0.51, "SwordAttack3"],
    ]) {
      const a = sample(
          info,
          motion
            .getRoot()
            .listAnimations()
            .find((c) => c.getName() === from),
          link,
        ),
        b = sample(
          info,
          motion
            .getRoot()
            .listAnimations()
            .find((c) => c.getName() === to),
          0,
        );
      const angle = Math.max(
        ...names.map(
          (n) =>
            (a.get(info.byName.get(n)).q.angleTo(b.get(info.byName.get(n)).q) *
              180) /
            Math.PI,
        ),
      );
      const delta = Math.max(
        ...names.map((n) =>
          position(info, a, info.byName.get(n)).distanceTo(
            position(info, b, info.byName.get(n)),
          ),
        ),
      );
      assert(angle < 0.05 && delta < 1e-5, "Combo seam");
      seams.push({ from, link, to, maxDegrees: angle, maxMetres: delta });
    }
  floor.profiles[character] = profile;
  report.profiles.push({ character, clips: metrics, seams });
}
for (const f of protectedFiles)
  assert.equal(
    sha(await readFile(resolve(outputDir, f))),
    protectedBefore[f],
    "Protected asset changed: " + f,
  );
if (!swordsOnly && previousGaolerHash)
  assert.equal(
    sha(await readFile(resolve(outputDir, "gaoler-fixes1.glb"))),
    previousGaolerHash,
    "Gaoler steps changed during sword posture work",
  );
assert(
  // Preserve original microscopic nonuniform export scale. Its decomposition
  // leaves a few micrometres of analytical-IK residual, below 0.01 millimetre.
  swordPostureQA.maxFootHeightError < 1e-5,
  "Sword IK changed source ankle contact height: " +
    JSON.stringify(swordPostureQA),
);
assert(
  swordPostureQA.maxFootWorldAngleErrorDegrees < 0.001,
  "Sword IK changed source ankle orientation",
);
await writeFile(
  resolve(outputDir, "fixes1-floor.json"),
  JSON.stringify(floor) + "\n",
);
const legacyTimes = [
  { duration: 0.74, contact: 0.3, link: 0.52 },
  { duration: 0.7, contact: 0.27, link: 0.51 },
  { duration: 1, contact: 0.42, link: 1 },
];
const contract = {
  version: "fixes1",
  timeDomain: "semantic-seconds",
  nativeBaseline: "contract.json",
  nativeBaselineUnmodified: true,
  attacks: Object.fromEntries(attackContract.map((a) => [a.name, a])),
  selectedNewClips: {
    prisoner: {
      file: "prisoner-fixes1.glb",
      sword: ["SwordAttack1", "SwordAttack2", "SwordAttack3"],
      armedDodge: [
        "WeaponStepForward",
        "WeaponStepBack",
        "WeaponStepLeft",
        "WeaponStepRight",
      ],
    },
    watcher: {
      file: "prisoner-fixes1.glb",
      sword: ["SwordAttack1", "SwordAttack2", "SwordAttack3"],
      armedDodge: [
        "WeaponStepForward",
        "WeaponStepBack",
        "WeaponStepLeft",
        "WeaponStepRight",
      ],
    },
    gaoler: {
      file: "gaoler-fixes1.glb",
      armedDodge: [
        "WeaponStepForward",
        "WeaponStepBack",
        "WeaponStepLeft",
        "WeaponStepRight",
      ],
    },
  },
  newClipTimeMapping:
    "Identity. SwordAttack and WeaponStep clip seconds are semantic runtime seconds. Never apply the legacy phase map to these clips or their new floor curves.",
  legacyBodyTimeMapping: {
    method:
      "Piecewise linear interpolation from semantic time to approved legacy clip time, clamped to each endpoint. Apply this same mapped time to the approved legacy floor table.",
    scope:
      "Legacy axe/spear/enemy Attack1/2/3 body clips only. New sword clips are already retimed.",
    attacks: Object.fromEntries(
      attackContract.map((a, i) => [
        a.name,
        {
          legacyClip: a.name,
          anchors:
            i < 2
              ? [
                  [0, 0],
                  [a.contact, legacyTimes[i].contact],
                  [a.link, legacyTimes[i].link],
                  [a.duration, legacyTimes[i].duration],
                ]
              : [
                  [0, 0],
                  [a.contact, legacyTimes[i].contact],
                  [a.duration, legacyTimes[i].duration],
                ],
        },
      ]),
    ),
  },
  dodge: {
    duration: 0.82,
    semanticTime: true,
    travelStart: 0.14,
    travelEnd: 0.65,
    controllerOwnsHorizontalTravel: true,
    horizontalTravelAdvisory:
      "Authored as short low steps. Try 1.35 metres for long weapons during visual QA. This advisory does not change the existing runtime DODGE distance.",
  },
  floor: {
    file: "fixes1-floor.json",
    timeDomain: "semantic-seconds",
    sampleRate: 60,
    signedOffsets: true,
    clearance: 0.008,
    application:
      "Interpolate indexed skin-surface offsets on the selected character profile. Add signed offset to ground root height after pose evaluation. Preserve negative offsets. GearPose remains responsible for equipped weapon/body collision.",
  },
  phaseMappings: Object.fromEntries(
    report.characters.map((c) => [
      c.character,
      Object.fromEntries(c.clips.map((d) => [d.name, d.phaseMapping])),
    ]),
  ),
  assetQA: {
    localJointDegreesPer60HzLimit: 18.5,
    fullBodySourceRetargeted: true,
    swordPostureAdapted: true,
    swordPostureConstraints: swordPosture,
    previousStepKeyframesPreserved: true,
    baseTRSPreserved: true,
    boneLengthsPreserved: true,
    sourceContactCriterion: report.sourceContacts,
    report: "work/fixes1/references/fixes1-motion-report.json",
    remainingValidation:
      "Runtime GearPose and equipped weapon continuity plus visual gameplay review belong to the parent integration.",
  },
  assets: report.characters.map((c) => ({
    file: c.file,
    sha256: c.sha256,
    bytes: c.bytes,
  })),
  provenance: {
    author: "Quaternius",
    license: "CC0-1.0",
    source1: "https://quaternius.itch.io/universal-animation-library",
    source2: "https://quaternius.itch.io/universal-animation-library-2",
    adaptation:
      "Original new0 proportion retargeting, grounded moderate sword lunge, semantic retime and directional heavy-weapon step adaptation.",
    noPaidSource: true,
  },
};
await writeFile(
  resolve(outputDir, "fixes1-contract.json"),
  JSON.stringify(contract, null, 2) + "\n",
);
report.protectedAssets = protectedBefore;
report.swordPostureAdaptation = swordPosture;
report.swordPostureQA = swordPostureQA;
report.stepClipDigests = stepClipDigests;
report.previousStepKeyframesPreserved = true;
await writeFile(
  resolve(work, "fixes1-motion-report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
await writeFile(
  resolve(work, "fixes1-motion-provenance.json"),
  JSON.stringify(
    {
      license: "CC0-1.0",
      source1: "https://quaternius.itch.io/universal-animation-library",
      source2: "https://quaternius.itch.io/universal-animation-library-2",
      sources: [
        "UAL1 Standard Idle_Loop and Walk_Loop",
        "UAL2 Standard Sword_Regular_A/B/C and A_Rec/B_Rec",
      ],
      derivation:
        "Full-body source sword motion is proportion-retargeted via world rotation deltas, with destination bone lengths/base TRS preserved. A new original moderate-lunge adaptation limits grounded pelvis height and body tilt, keeping actual ankle height/orientation through IK. Horizontal foot targets are shortened only when physical reach requires it. This replaces the source's deep crouch that folded thighs through a rigid main cuirass. Source wrists determine contact phase landmarks. Monotone arc-length phase retime follows the game contract. Directional low-body steps remain unchanged original adaptations of UAL1 Walk_Loop, not claimed source spear or dodge clips. Step horizontal endpoint amplitude is .65 and scales by actual leg length. No runtime wrist search, mesh shrinking or leg shader hiding is authored here.",
      swordPostureAdaptation: swordPosture,
      inputs: report.inputs,
      outputs: report.characters.map((c) => c.file),
      noPaidSource: true,
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  resolve(work, "fixes1-motion-notes.txt"),
  [
    "Separate fixes1 motion assets. Approved combat assets and contract.json remain unchanged.",
    "Command: node scripts/assets/retarget-ual2-fixes1.mjs",
    "Sword semantic durations .85/.77/1.15, contacts .30/.27/.62, links .52/.51/1.15, cancels .57/.56/.96.",
    "Source UAL2 actual wrist reach contacts .2375/.2458333333/.6625 seconds. No virtual blade contact claim.",
    "Sword posture regression source: UAL2 B pelvis minimum .478m and body tilt maximum57.3deg. Retargeted signed floor made grounded pelvis .50-.56m, forcing thighs through the rigid chest shell.",
    "The moderate sword lunge retains ankle height and world orientation, raises grounded pelvis to .70m, softly limits pelvis tilt to20deg and pelvis-to-neck tilt to40deg. Only unreachable horizontal ankle targets are shortened. Lengths/scales are unchanged.",
    "Geometric posture check: node --experimental-strip-types scripts/assets/validate-sword-posture-fixes1.mjs. It ignores shader masks and tests actual leg vertices against the runtime main cuirass.",
    "WeaponStep Forward/Back/Left/Right are original low-body UAL1 Walk adaptations, .82 seconds, no inversion.",
    "Step IK root cause fixed: Jog foot targets and hip-height scale could exceed a leg reach. A hard reach clamp then released a straight knee abruptly. Use Walk, real leg-length scale, shorter horizontal stride and smoothly bounded reach.",
    "Floor is signed per-character weighted indexed skin clearance, at semantic clip time. Do not clamp negative offsets.",
    "New clip seconds map to runtime semantic seconds by identity. Legacy phase maps exist separately in fixes1-contract.json.",
    ...report.profiles.flatMap((p) => [
      p.character,
      ...p.clips.map(
        (c) =>
          `${c.name}: local max ${c.maxJointDegreesPer60Hz.toFixed(3)}deg/60Hz, body max ${c.maxBodyJointDegreesPer60Hz.toFixed(3)}deg/60Hz, hand max ${c.maxHandMetresPer60Hz.toFixed(4)}m/60Hz, floor min ${c.minCorrectedSkinY.toFixed(6)}m, length error ${c.maxBoneLengthError}`,
      ),
    ]),
    "Full report includes per-bone velocities, source clocks, geometry hashes, exact combo seam residuals and protected file hashes.",
    "Parent must visually review equipped grips, attack direction and steps in actual gameplay. This asset QA does not claim runtime weapon collision or final rendering validation.",
  ].join("\n") + "\n",
);
console.log(
  JSON.stringify({
    files: report.characters.map((c) => ({ file: c.file, bytes: c.bytes })),
    profiles: report.profiles.map((p) => ({
      character: p.character,
      clips: p.clips.map((c) => ({
        name: c.name,
        maxJoint: c.maxJointDegreesPer60Hz,
        body: c.maxBodyJointDegreesPer60Hz,
        worst: c.worstJoint,
        hand: c.maxHandMetresPer60Hz,
        minFloor: c.minCorrectedSkinY,
      })),
      seams: p.seams,
    })),
    protectedUnchanged: true,
  }),
);
