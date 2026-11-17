// CC0 full-body spear, fists and short evasive steps. New assets only.
// node scripts/assets/retarget-combat-fixes2.mjs
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { Matrix4, Quaternion, Vector3 } from "three";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
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

const root = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(root);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const out = resolve(root, "public/assets/motion"),
  work = resolve(root, "work/fixes2");
await mkdir(work, { recursive: true });
const sha = (b) => createHash("sha256").update(b).digest("hex");
const protectedFiles = (await readdir(out)).filter(
  (f) => /\.(glb|json)$/.test(f) && !f.includes("fixes2"),
);
const protectedHashes = Object.fromEntries(
  await Promise.all(
    protectedFiles.map(async (f) => [f, sha(await readFile(resolve(out, f)))]),
  ),
);
const sources = {
  mage: {
    file: "work/roll-research/Mage.glb",
    licenseFile: "work/roll-research/LICENSE.txt",
    author: "Kay Lousberg / KayKit",
    source: "https://kaylousberg.itch.io/kaykit-adventurers",
  },
  ual1: {
    file: "work/roll-research/quaternius/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb",
    licenseFile:
      "work/roll-research/quaternius/Universal Animation Library[Standard]/README.txt",
    author: "Quaternius",
    source: "https://quaternius.com/packs/universalanimationlibrary.html",
  },
  ual2: {
    file: "work/fixes1/references/UAL2_Standard.glb",
    licenseFile: "work/fixes1/references/README.txt",
    author: "Quaternius",
    source: "https://quaternius.com/packs/universalanimationlibrary2.html",
  },
};
for (const s of Object.values(sources)) {
  s.doc = await io.read(s.file);
  s.info = structure(s.doc);
  s.clips = new Map(
    s.doc
      .getRoot()
      .listAnimations()
      .map((a) => [a.getName(), a]),
  );
  s.sha256 = sha(await readFile(s.file));
  s.license = await readFile(s.licenseFile, "utf8");
}
const Y = new Vector3(0, 1, 0),
  Z = new Vector3(0, 0, 1),
  X = new Vector3(1, 0, 0);
const duration = (a) =>
  Math.max(...a.listSamplers().map((s) => s.getInput().getArray().at(-1)));
const nativeNames = [
  "pelvis",
  "spine1",
  "spine2",
  "chest",
  "neck",
  "head",
  "clavicle_L",
  "upperarm_L",
  "forearm_L",
  "hand_L",
  "clavicle_R",
  "upperarm_R",
  "forearm_R",
  "hand_R",
  "thigh_L",
  "shin_L",
  "foot_L",
  "toe_L",
  "thigh_R",
  "shin_R",
  "foot_R",
  "toe_R",
];
const ualMap = {
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
const attacks = [
  { duration: 0.85, contact: 0.3, link: 0.52 },
  { duration: 0.77, contact: 0.27, link: 0.51 },
  { duration: 1.15, contact: 0.62, link: 1.15 },
];
const report = {
  version: 2,
  protectedBefore: protectedHashes,
  inputs: Object.fromEntries(
    Object.entries(sources).map(([k, s]) => [
      k,
      { file: s.file, sha256: s.sha256, license: "CC0-1.0" },
    ]),
  ),
  contacts: {},
  characters: [],
  profiles: [],
};
function setQ(info, pose, node, q) {
  const parent = info.parent.get(node);
  const pq = parent ? rotation(info, pose, parent) : new Quaternion();
  pose.get(node).q.copy(pq.invert().multiply(q)).normalize();
}
function setP(info, pose, node, p) {
  const parent = info.parent.get(node);
  pose
    .get(node)
    .p.copy(
      parent ? p.clone().applyMatrix4(world(info, pose, parent).invert()) : p,
    );
}
function aim(info, pose, node, child, end) {
  const p = position(info, pose, node),
    a = position(info, pose, child).sub(p).normalize(),
    b = end.clone().sub(p).normalize();
  setQ(
    info,
    pose,
    node,
    new Quaternion()
      .setFromUnitVectors(a, b)
      .multiply(rotation(info, pose, node)),
  );
}
function leg(info, pose, side, endpoint, footQ) {
  const a = info.byName.get(`thigh_${side}`),
    b = info.byName.get(`shin_${side}`),
    c = info.byName.get(`foot_${side}`),
    p = position(info, pose, a),
    l1 = pose.get(b).p.length(),
    l2 = pose.get(c).p.length();
  const max = l1 + l2 - 0.008,
    vertical = endpoint.y - p.y;
  assert(
    Math.abs(vertical) < max,
    "Unreachable ankle vertical target " +
      JSON.stringify({
        side,
        hip: p.toArray(),
        endpoint: endpoint.toArray(),
        max,
      }),
  );
  const radius = Math.sqrt(max * max - vertical * vertical),
    dx = endpoint.x - p.x,
    dz = endpoint.z - p.z,
    r = Math.hypot(dx, dz),
    band = Math.min(0.035, radius * 0.15);
  if (r > radius - band) {
    const bounded = radius - band * Math.exp(-(r - (radius - band)) / band);
    endpoint.x = p.x + (dx * bounded) / r;
    endpoint.z = p.z + (dz * bounded) / r;
  }
  const v = endpoint.clone().sub(p),
    d = Math.max(0.005, v.length());
  v.normalize();
  const front = Z.clone().applyQuaternion(
    rotation(info, pose, info.byName.get("pelvis")),
  );
  front.y = 0;
  front.normalize();
  const pole = front.addScaledVector(X, side === "R" ? -0.04 : 0.04);
  pole.addScaledVector(v, -pole.dot(v));
  pole.normalize();
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d),
    h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const knee = p.clone().addScaledVector(v, along).addScaledVector(pole, h);
  aim(info, pose, a, b, knee);
  aim(info, pose, b, c, endpoint);
  setQ(info, pose, c, footQ);
}
function context(doc) {
  const info = structure(doc),
    idle = sample(
      info,
      doc
        .getRoot()
        .listAnimations()
        .find((a) => a.getName() === "Idle"),
      0,
    ),
    tpose = clone(info.base),
    refs = new Map();
  // The target GLB is A/rest posed. Construct a true anatomical T reference before
  // comparing to Mage's T-Pose. Preserve every local translation and scale.
  for (const side of ["L", "R"]) {
    const upper = info.byName.get(`upperarm_${side}`),
      fore = info.byName.get(`forearm_${side}`),
      hand = info.byName.get(`hand_${side}`),
      sign = side === "R" ? -1 : 1;
    const handRelative = tpose.get(hand).q.clone();
    aim(
      info,
      tpose,
      upper,
      fore,
      position(info, tpose, upper).add(new Vector3(sign, 0, 0)),
    );
    aim(
      info,
      tpose,
      fore,
      hand,
      position(info, tpose, fore).add(new Vector3(sign, 0, 0.015)),
    );
    setQ(info, tpose, hand, rotation(info, tpose, fore).multiply(handRelative));
  }
  for (const name of nativeNames)
    refs.set(name, {
      idleP: position(info, idle, info.byName.get(name)),
      idleQ: rotation(info, idle, info.byName.get(name)),
      tQ: rotation(info, tpose, info.byName.get(name)),
    });
  const targetHeight = refs.get("head").idleP.y - refs.get("foot_R").idleP.y;
  const mage = sources.mage,
    mageT = sample(mage.info, mage.clips.get("T-Pose"), 0);
  const mageHeight =
    position(mage.info, mageT, mage.info.byName.get("head")).y -
    position(mage.info, mageT, mage.info.byName.get("foot.r")).y;
  const mageScale = targetHeight / mageHeight,
    meshes = weightedMeshes(info),
    soles = {};
  for (const side of ["L", "R"])
    soles[side] = meshes
      .map((m) => ({
        ...m,
        used: m.used.filter((i) => {
          let weight = 0;
          for (let k = 0; k < 4; k++)
            if (
              new RegExp(`^(foot|toe)_${side}$`).test(
                m.bones[m.j[i * 4 + k]].getName(),
              )
            )
              weight += m.w[i * 4 + k];
          return weight > 0.65;
        }),
      }))
      .filter((m) => m.used.length);
  const idleFootMin = {
    L: skinY(info, idle, soles.L),
    R: skinY(info, idle, soles.R),
  };
  return {
    info,
    idle,
    tpose,
    refs,
    targetHeight,
    mageT,
    mageScale,
    soles,
    idleFootMin,
  };
}
function groundFeet(ctx, pose, contacts) {
  function lowerForReach() {
    let lower = 0;
    for (const { side, endpoint } of contacts) {
      const hip = position(
          ctx.info,
          pose,
          ctx.info.byName.get(`thigh_${side}`),
        ),
        a = pose.get(ctx.info.byName.get(`shin_${side}`)).p.length(),
        b = pose.get(ctx.info.byName.get(`foot_${side}`)).p.length(),
        r = Math.hypot(endpoint.x - hip.x, endpoint.z - hip.z),
        max = a + b - 0.022,
        vertical = Math.sqrt(
          Math.max(0.03, max * max - Math.min(r * r, max * max - 0.03)),
        );
      lower = Math.max(lower, hip.y - endpoint.y - vertical);
    }
    if (lower > 0) {
      const pelvis = ctx.info.byName.get("pelvis"),
        p = position(ctx.info, pose, pelvis);
      p.y -= lower;
      setP(ctx.info, pose, pelvis, p);
    }
  }
  lowerForReach();
  for (const c of contacts)
    leg(ctx.info, pose, c.side, c.endpoint.clone(), c.q);
  // The source ankle is not its sole. Compensate the actual human foot/toe skin
  // after copying its world orientation, so retargeting a short Mage foot does
  // not make the longer human boot pierce the floor or lift the whole actor.
  for (const c of contacts)
    c.endpoint.y +=
      ctx.idleFootMin[c.side] +
      c.height -
      skinY(ctx.info, pose, ctx.soles[c.side]);
  lowerForReach();
  for (const c of contacts) leg(ctx.info, pose, c.side, c.endpoint, c.q);
}
function humanStrikePosture(ctx, pose, hook = false) {
  const info = ctx.info,
    pelvis = info.byName.get("pelvis"),
    spine = info.byName.get("spine1"),
    neck = info.byName.get("neck");
  const contacts = ["L", "R"].map((side) => ({
    side,
    p: position(info, pose, info.byName.get(`foot_${side}`)),
    q: rotation(info, pose, info.byName.get(`foot_${side}`)),
  }));
  if (hook) {
    const q = rotation(info, pose, pelvis),
      front = Z.clone().applyQuaternion(q),
      yaw = Math.atan2(front.x, front.z),
      bounded = Math.max(-0.55, Math.min(0.55, yaw));
    setQ(
      info,
      pose,
      pelvis,
      new Quaternion().setFromAxisAngle(Y, bounded - yaw).multiply(q),
    );
  }
  const hip = position(info, pose, pelvis),
    minimum = ctx.refs.get("pelvis").idleP.y * 0.86;
  if (hip.y < minimum) {
    hip.y = minimum;
    setP(info, pose, pelvis, hip);
  }
  const lean = (v) => Math.acos(Math.max(-1, Math.min(1, v.y / v.length()))),
    limited = (v, max, band) =>
      v <= max - band ? v : max - band * Math.exp(-(v - (max - band)) / band);
  const up = Y.clone().applyQuaternion(rotation(info, pose, pelvis)),
    hipTilt = lean(up),
    maxHip = limited(hipTilt, (18 * Math.PI) / 180, (5 * Math.PI) / 180);
  if (hipTilt > maxHip)
    setQ(
      info,
      pose,
      pelvis,
      new Quaternion()
        .setFromAxisAngle(up.clone().cross(Y).normalize(), hipTilt - maxHip)
        .multiply(rotation(info, pose, pelvis)),
    );
  const currentHip = position(info, pose, pelvis),
    line = position(info, pose, neck).sub(currentHip),
    tilt = lean(line),
    target = limited(tilt, (30 * Math.PI) / 180, (6 * Math.PI) / 180);
  if (tilt > target) {
    const origin = position(info, pose, spine),
      fixed = origin.clone().sub(currentHip),
      upper = position(info, pose, neck).sub(origin),
      axis = line.clone().cross(Y).normalize();
    let a = 0,
      b = Math.PI / 2;
    for (let k = 0; k < 28; k++) {
      const m = (a + b) / 2;
      if (lean(upper.clone().applyAxisAngle(axis, m).add(fixed)) > target)
        a = m;
      else b = m;
    }
    setQ(
      info,
      pose,
      spine,
      new Quaternion()
        .setFromAxisAngle(axis, (a + b) / 2)
        .multiply(rotation(info, pose, spine)),
    );
  }
  // The heavily crouched source hook is adapted to a human boxing stance.
  // Preserve ankle Y/rotation and allow a physically necessary reduction of an
  // unreachable source horizontal lunge, rather than stretching a human thigh.
  for (const c of contacts) leg(info, pose, c.side, c.p, c.q);
  return pose;
}
function hookArms(ctx, pose, time) {
  const info = ctx.info,
    chest = position(info, pose, info.byName.get("chest")),
    neck = position(info, pose, info.byName.get("neck")),
    contact = trajectories.hook.contact,
    end = trajectories.hook.duration;
  const guard = new Vector3(-0.14, neck.y - chest.y + 0.02, 0.15),
    windup = new Vector3(-0.34, neck.y - chest.y - 0.04, 0.03),
    hit = new Vector3(0.03, neck.y - chest.y - 0.02, 0.4);
  const point =
    time < contact * 0.43
      ? guard.clone().lerp(windup, smooth(time / (contact * 0.43)))
      : time <= contact
        ? windup
            .clone()
            .lerp(hit, smooth((time - contact * 0.43) / (contact * 0.57)))
        : hit.clone().lerp(guard, smooth((time - contact) / (end - contact)));
  for (const side of ["R", "L"]) {
    const upper = info.byName.get(`upperarm_${side}`),
      fore = info.byName.get(`forearm_${side}`),
      hand = info.byName.get(`hand_${side}`),
      start = position(info, pose, upper),
      target =
        side === "R"
          ? chest.clone().add(point)
          : new Vector3(chest.x + 0.14, neck.y + 0.04, chest.z + 0.14);
    const l1 = pose.get(fore).p.length(),
      l2 = pose.get(hand).p.length(),
      v = target.clone().sub(start),
      d = Math.min(
        l1 + l2 - 0.01,
        Math.max(Math.abs(l1 - l2) + 0.015, v.length()),
      );
    v.normalize();
    const strike =
      side === "R"
        ? smooth(time / (contact * 0.8)) *
          (1 - smooth((time - contact) / (end - contact)))
        : 0;
    const pole = new Vector3(
      side === "R" ? -0.3 - 0.15 * strike : 0.2,
      side === "R" ? -0.5 + 0.4 * strike : -0.6,
      0.1,
    );
    pole.addScaledVector(v, -pole.dot(v));
    pole.normalize();
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d),
      height = Math.sqrt(Math.max(0, l1 * l1 - along * along)),
      elbow = start
        .clone()
        .addScaledVector(v, along)
        .addScaledVector(pole, height),
      endpoint = start.clone().addScaledVector(v, d);
    aim(info, pose, upper, fore, elbow);
    aim(info, pose, fore, hand, endpoint);
    setQ(
      info,
      pose,
      hand,
      rotation(info, pose, fore).multiply(ctx.idle.get(hand).q),
    );
  }
  setQ(info, pose, info.byName.get("head"), ctx.refs.get("head").idleQ.clone());
  return pose;
}
function retargetUAL(ctx, key, sourcePose, time = 0) {
  const s = sources[key],
    info = s.info,
    reference = info.base,
    pose = clone(ctx.idle);
  for (const [sn, tn] of Object.entries(ualMap)) {
    const q = rotation(info, sourcePose, info.byName.get(sn))
      .multiply(rotation(info, reference, info.byName.get(sn)).invert())
      .multiply(ctx.refs.get(tn).tQ);
    setQ(ctx.info, pose, ctx.info.byName.get(tn), q);
  }
  const hip = position(info, sourcePose, info.byName.get("pelvis")),
    refHip = position(info, reference, info.byName.get("pelvis"));
  const scale =
    ctx.targetHeight /
    (position(info, reference, info.byName.get("Head")).y -
      position(info, reference, info.byName.get("foot_r")).y);
  const target = ctx.refs
    .get("pelvis")
    .idleP.clone()
    .addScaledVector(hip.clone().sub(refHip), scale);
  // The runtime owns horizontal lunge. Keep only the source's local weight shift.
  target.x =
    ctx.refs.get("pelvis").idleP.x +
    (target.x - ctx.refs.get("pelvis").idleP.x) * 0.65;
  target.z =
    ctx.refs.get("pelvis").idleP.z +
    (target.z - ctx.refs.get("pelvis").idleP.z) * 0.65;
  setP(ctx.info, pose, ctx.info.byName.get("pelvis"), target);
  const contacts = [];
  for (const side of ["L", "R"]) {
    const sn = `foot_${side.toLowerCase()}`,
      tn = `foot_${side}`,
      sourceFoot = position(info, sourcePose, info.byName.get(sn)),
      sourceStart = position(info, reference, info.byName.get(sn));
    const endpoint = ctx.refs
      .get(tn)
      .idleP.clone()
      .addScaledVector(
        sourceFoot
          .clone()
          .sub(sourceStart)
          .sub(new Vector3(hip.x - refHip.x, 0, hip.z - refHip.z))
          .multiply(new Vector3(0.8, 1, 0.8)),
        scale,
      );
    contacts.push({
      side,
      endpoint,
      q: rotation(ctx.info, pose, ctx.info.byName.get(tn)),
      height: Math.max(0, (sourceFoot.y - sourceStart.y) * scale),
    });
  }
  groundFeet(ctx, pose, contacts);
  humanStrikePosture(ctx, pose, key === "ual2");
  return key === "ual2" ? hookArms(ctx, pose, time) : pose;
}
function retargetMage(ctx, sourcePose, sourceStart, evade = false) {
  const s = sources.mage,
    si = s.info,
    tp = ctx.mageT,
    pose = clone(ctx.idle);
  const map = {
    hips: "pelvis",
    chest: "chest",
    head: "head",
    "upperarm.l": "upperarm_L",
    "lowerarm.l": "forearm_L",
    "wrist.l": "hand_L",
    "upperarm.r": "upperarm_R",
    "lowerarm.r": "forearm_R",
    "wrist.r": "hand_R",
    "upperleg.l": "thigh_L",
    "lowerleg.l": "shin_L",
    "foot.l": "foot_L",
    "toes.l": "toe_L",
    "upperleg.r": "thigh_R",
    "lowerleg.r": "shin_R",
    "foot.r": "foot_R",
    "toes.r": "toe_R",
  };
  const delta = (name) =>
    rotation(si, sourcePose, si.byName.get(name)).multiply(
      rotation(si, tp, si.byName.get(name)).invert(),
    );
  setQ(
    ctx.info,
    pose,
    ctx.info.byName.get("pelvis"),
    delta("hips").multiply(ctx.refs.get("pelvis").tQ),
  );
  const hipDelta = delta("hips"),
    chestDelta = delta("chest"),
    headDelta = delta("head");
  for (const [name, u] of [
    ["spine1", 0.3],
    ["spine2", 0.65],
    ["chest", 1],
  ])
    setQ(
      ctx.info,
      pose,
      ctx.info.byName.get(name),
      hipDelta.clone().slerp(chestDelta, u).multiply(ctx.refs.get(name).tQ),
    );
  setQ(
    ctx.info,
    pose,
    ctx.info.byName.get("neck"),
    chestDelta.clone().slerp(headDelta, 0.55).multiply(ctx.refs.get("neck").tQ),
  );
  setQ(
    ctx.info,
    pose,
    ctx.info.byName.get("head"),
    headDelta.clone().multiply(ctx.refs.get("head").tQ),
  );
  for (const side of ["L", "R"])
    setQ(
      ctx.info,
      pose,
      ctx.info.byName.get(`clavicle_${side}`),
      chestDelta.clone().multiply(ctx.refs.get(`clavicle_${side}`).tQ),
    );
  for (const [sn, tn] of Object.entries(map))
    if (!["pelvis", "chest", "head"].includes(tn))
      setQ(
        ctx.info,
        pose,
        ctx.info.byName.get(tn),
        delta(sn).multiply(ctx.refs.get(tn).tQ),
      );
  const hip = position(si, sourcePose, si.byName.get("hips")),
    startHip = position(si, sourceStart, si.byName.get("hips"));
  const target = ctx.refs.get("pelvis").idleP.clone();
  target.y += (hip.y - 0.392) * ctx.mageScale;
  if (!evade) {
    target.x += (hip.x - startHip.x) * ctx.mageScale * 0.65;
    target.z += (hip.z - startHip.z) * ctx.mageScale * 0.65;
  }
  setP(ctx.info, pose, ctx.info.byName.get("pelvis"), target);
  const sourceFootY = ["l", "r"].map(
      (side) => position(si, sourcePose, si.byName.get(`foot.${side}`)).y,
    ),
    commonLift = evade ? Math.max(0, Math.min(...sourceFootY) - 0.145) : 0;
  const contacts = [];
  for (const side of ["L", "R"]) {
    const sn = `foot.${side.toLowerCase()}`,
      tn = `foot_${side}`,
      f = position(si, sourcePose, si.byName.get(sn)),
      f0 = position(si, sourceStart, si.byName.get(sn));
    const endpoint = ctx.refs.get(tn).idleP.clone();
    endpoint.x += (f.x - f0.x - (hip.x - startHip.x)) * ctx.mageScale * 0.85;
    endpoint.z += (f.z - f0.z - (hip.z - startHip.z)) * ctx.mageScale * 0.85;
    endpoint.y += (f.y - 0.145 - commonLift) * ctx.mageScale;
    contacts.push({
      side,
      endpoint,
      q: rotation(ctx.info, pose, ctx.info.byName.get(tn)),
      height: Math.max(0, (f.y - 0.145 - commonLift) * ctx.mageScale),
    });
  }
  groundFeet(ctx, pose, contacts);
  return pose;
}
function trajectory(key, name) {
  const s = sources[key],
    clip = s.clips.get(name);
  assert(clip, `Missing source ${key}/${name}`);
  const end = duration(clip),
    rows = [];
  const hips = key === "mage" ? "hips" : "pelvis",
    hands = key === "mage" ? ["wrist.l", "wrist.r"] : ["hand_l", "hand_r"];
  const start = sample(s.info, clip, 0),
    base = hands.map(
      (h) =>
        position(s.info, start, s.info.byName.get(h)).z -
        position(s.info, start, s.info.byName.get(hips)).z,
    );
  for (let i = 0; i <= Math.ceil(end * 240); i++) {
    const t = Math.min(end, i / 240),
      p = sample(s.info, clip, t),
      hip = position(s.info, p, s.info.byName.get(hips));
    rows.push({
      time: t,
      hands: hands.map((h) =>
        position(s.info, p, s.info.byName.get(h)).toArray(),
      ),
      reach: hands.map(
        (h) => position(s.info, p, s.info.byName.get(h)).z - hip.z,
      ),
    });
  }
  const candidates = rows.filter((r) => r.time > 0.04 && r.time < end * 0.86),
    extension = [0, 1].map(
      (i) => Math.max(...candidates.map((r) => r.reach[i])) - base[i],
    );
  const hand = key === "mage" ? 1 : extension[0] > extension[1] ? 0 : 1;
  const peak = candidates.reduce((a, b) =>
    a.reach[hand] > b.reach[hand] ? a : b,
  );
  const result = {
    source: key,
    clip: name,
    duration: end,
    contact: peak.time,
    hand: hands[hand],
    initialReach: base[hand],
    peakReach: peak.reach[hand],
    extension: extension[hand],
    criterion:
      "Maximum actual wrist forward reach relative to pelvis in the first active burst, sampled at 240 Hz",
    rows,
  };
  report.contacts[key + "/" + name] = { ...result, rows: undefined };
  return result;
}
const trajectories = {
  stab: trajectory("mage", "2H_Melee_Attack_Stab"),
  jab: trajectory("ual1", "Punch_Jab"),
  cross: trajectory("ual1", "Punch_Cross"),
  hook: trajectory("ual2", "Melee_Hook"),
};
function spline(xs, ys) {
  const h = xs.slice(1).map((x, i) => x - xs[i]),
    d = h.map((v, i) => (ys[i + 1] - ys[i]) / v),
    m = xs.map((_, i) =>
      i === 0
        ? d[0]
        : i === xs.length - 1
          ? d.at(-1)
          : d[i - 1] * d[i] <= 0
            ? 0
            : (2 * h[i] + h[i - 1] + h[i] + 2 * h[i - 1]) /
              ((2 * h[i] + h[i - 1]) / d[i - 1] + (h[i] + 2 * h[i - 1]) / d[i]),
    );
  return (x) => {
    let i = 0;
    while (i < xs.length - 2 && x > xs[i + 1]) i++;
    const u = Math.max(0, Math.min(1, (x - xs[i]) / h[i]));
    return (
      (2 * u * u * u - 3 * u * u + 1) * ys[i] +
      (u * u * u - 2 * u * u + u) * h[i] * m[i] +
      (-2 * u * u * u + 3 * u * u) * ys[i + 1] +
      (u * u * u - u * u) * h[i] * m[i + 1]
    );
  };
}
function arcClock(ctx, raw, source, targetEnd, targetContact) {
  const xs = [
      ...new Set([
        0,
        source.contact,
        source.duration,
        ...Array.from(
          { length: Math.ceil(source.duration * 240) },
          (_, i) => (i + 1) / 240,
        ).filter((t) => t < source.duration),
      ]),
    ].sort((a, b) => a - b),
    arc = [0];
  let previous = raw(0);
  for (let i = 1; i < xs.length; i++) {
    const p = raw(xs[i]);
    let angular = 0,
      travel = 0;
    for (const name of nativeNames) {
      const n = ctx.info.byName.get(name);
      angular = Math.max(angular, p.get(n).q.angleTo(previous.get(n).q));
    }
    for (const side of ["L", "R"])
      travel = Math.max(
        travel,
        position(ctx.info, p, ctx.info.byName.get(`hand_${side}`)).distanceTo(
          position(ctx.info, previous, ctx.info.byName.get(`hand_${side}`)),
        ),
      );
    arc.push(
      arc.at(-1) +
        Math.max(
          0.02 * (xs[i] - xs[i - 1]),
          angular / (((18 * Math.PI) / 180) * 60),
          travel / 9.6,
        ),
    );
    previous = p;
  }
  const ci = xs.findIndex((x) => Math.abs(x - source.contact) < 1e-7),
    ys = xs.map((x, i) =>
      i <= ci
        ? (targetContact * arc[i]) / arc[ci]
        : targetContact +
          ((targetEnd - targetContact) * (arc[i] - arc[ci])) /
            (arc.at(-1) - arc[ci]),
    );
  const sourceToTarget = spline(xs, ys);
  return {
    phaseMinimumTimes: [arc[ci], arc.at(-1) - arc[ci]],
    at(t) {
      if (t <= 0) return 0;
      if (t >= targetEnd) return source.duration;
      let a = 0,
        b = source.duration;
      for (let i = 0; i < 30; i++) {
        const m = (a + b) / 2;
        if (sourceToTarget(m) < t) a = m;
        else b = m;
      }
      return (a + b) / 2;
    },
  };
}
function attackDescriptors(ctx, family) {
  const definitions =
    family === "Spear"
      ? [trajectories.stab, trajectories.stab, trajectories.stab]
      : [trajectories.jab, trajectories.cross, trajectories.hook];
  const raw = definitions.map((d) => {
    const s = sources[d.source],
      c = s.clips.get(d.clip),
      start = sample(s.info, c, 0);
    return (t) =>
      d.source === "mage"
        ? retargetMage(ctx, sample(s.info, c, t), start)
        : retargetUAL(ctx, d.source, sample(s.info, c, t), t);
  });
  const entries = raw.map((fn) => fn(0));
  return definitions.map((source, index) => {
    const contract = attacks[index],
      endAt = index < 2 ? contract.link : contract.duration;
    const clock = arcClock(ctx, raw[index], source, endAt, contract.contact);
    return {
      name: `${family}Attack${index + 1}`,
      duration: contract.duration,
      contact: contract.contact,
      link: contract.link,
      source,
      rootCurve: null,
      poseAt(t) {
        if (t >= contract.duration - 1e-8) return clone(ctx.idle);
        let pose = raw[index](clock.at(Math.min(t, endAt)));
        // Start the first blow from native Idle. Later blows share exact link poses.
        if (index === 0 && t < 0.16)
          pose = blend(ctx.idle, pose, smooth(t / 0.16));
        if (index < 2) {
          const recovery = contract.contact + 0.025;
          if (t >= recovery && t <= contract.link)
            pose = blend(
              pose,
              entries[index + 1],
              smooth((t - recovery) / (contract.link - recovery)),
            );
          if (t > contract.link)
            pose = blend(
              entries[index + 1],
              ctx.idle,
              smooth((t - contract.link) / (contract.duration - contract.link)),
            );
        } else if (t > contract.contact + 0.11)
          pose = blend(
            pose,
            ctx.idle,
            smooth(
              (t - contract.contact - 0.11) /
                (contract.duration - contract.contact - 0.11),
            ),
          );
        return pose;
      },
      phaseMapping: {
        method:
          "Joint/hand arc-length monotone cubic source-to-semantic clock, inverted at baking, aligned to measured source wrist peak",
        landmarks: [
          [0, 0],
          [contract.contact, source.contact],
          [endAt, source.duration],
        ],
        phaseMinimumTimesAt18DegreesAnd16cmPer60Hz: clock.phaseMinimumTimes,
        nativeIdleRecovery: true,
        sharedComboLinkPose: true,
        ...(family === "Fist"
          ? {
              posture:
                "Minimum pelvis86% native Idle height, pelvis tilt18deg, torso tilt30deg, planted ankleY and rotation preserved with bounded horizontal reach",
              ...(index === 2
                ? {
                    hookAdaptation:
                      "Source body windup and weight transfer adapted to a compact human boxing stance, pelvis yaw bounded31.5deg, original anatomically solved hook hand arc and opposite face guard, closed fist shape owned by runtime",
                  }
                : {}),
            }
          : {}),
      },
    };
  });
}
function evadeDescriptors(ctx) {
  return ["Back", "Forward", "Left", "Right"].map((side) => {
    const name =
        "Dodge_" +
        { Back: "Backward", Forward: "Forward", Left: "Left", Right: "Right" }[
          side
        ],
      s = sources.mage,
      c = s.clips.get(name);
    assert(c, `Missing ${name}`);
    const end = duration(c),
      start = sample(s.info, c, 0),
      hip0 = position(s.info, start, s.info.byName.get("hips"));
    const hipEnd = position(
        s.info,
        sample(s.info, c, end),
        s.info.byName.get("hips"),
      ).sub(hip0),
      direction = hipEnd.clone();
    direction.y = 0;
    const sourceDistance = direction.length();
    direction.normalize();
    const distance = { Back: 1.05, Forward: 0.85, Left: 0.9, Right: 0.9 }[side];
    const sourceAt = (t) => end * smooth((t - 0.075) / 0.53);
    const curve = [];
    let prior = 0;
    for (let i = 0; i <= 82; i++) {
      const t = i / 100,
        p = sample(s.info, c, sourceAt(t)),
        d =
          position(s.info, p, s.info.byName.get("hips"))
            .sub(hip0)
            .dot(direction) / sourceDistance;
      prior = Math.max(prior, Math.min(1, Math.max(0, d)));
      curve.push([t, prior]);
    }
    curve[0][1] = 0;
    curve.at(-1)[1] = 1;
    return {
      name: `Evade${side}`,
      duration: 0.82,
      source: { source: "mage", clip: name, duration: end },
      rootCurve: {
        duration: 0.82,
        distance,
        sourceDistance,
        sourceDirection: direction.toArray(),
        samples: curve,
      },
      poseAt(t) {
        if (t >= 0.82 - 1e-8) return clone(ctx.idle);
        const pose = retargetMage(
            ctx,
            sample(s.info, c, sourceAt(t)),
            start,
            true,
          ),
          envelope = smooth(t / 0.105) * (1 - smooth((t - 0.59) / 0.23));
        for (const name of nativeNames.filter((n) =>
          /^(upperarm|forearm|hand)/.test(n),
        )) {
          const n = ctx.info.byName.get(name);
          pose.get(n).q.slerp(ctx.idle.get(n).q, 0.45);
        }
        return blend(ctx.idle, pose, envelope);
      },
      phaseMapping: {
        method:
          "Source directional dodge, compression and travel over .075-.605s, planted settling recovery to native Idle by .82s. Arm amplitudes damped55% for compact weapon-safe balancing.",
        sourceClip: name,
        sourceDuration: end,
        sourceMotionRemovedFromPelvis: true,
        totalHeightScale: ctx.mageScale,
        ankleWorldHeightPreserved: true,
        forwardAnatomicalKneePole: true,
      },
    };
  });
}
function bake(doc, ctx, d) {
  const times = [
      ...new Set(
        [
          0,
          d.duration,
          d.contact,
          d.link,
          ...Array.from(
            { length: Math.floor(d.duration * 60) },
            (_, i) => (i + 1) / 60,
          ),
        ].filter((x) => x != null && x <= d.duration),
      ),
    ].sort((a, b) => a - b),
    poses = times.map((t) => d.poseAt(t));
  const a = doc.createAnimation(d.name).setExtras({
    license: "CC0-1.0",
    fullBody: true,
    retargeted: true,
    source: d.source.clip,
    sourceLibrary: d.source.source,
    semanticDuration: d.duration,
    contact: d.contact ?? null,
    link: d.link ?? null,
    phaseMapping: d.phaseMapping,
    controllerOwnsHorizontalTravel: true,
  });
  const buffer = doc.getRoot().listBuffers()[0],
    input = doc
      .createAccessor(d.name + "_time")
      .setType("SCALAR")
      .setArray(new Float32Array(times))
      .setBuffer(buffer);
  for (const name of nativeNames) {
    const node = ctx.info.byName.get(name),
      ps = [],
      qs = [];
    let previous = null;
    for (const p of poses) {
      const state = p.get(node),
        q = state.q.clone().normalize();
      if (previous && q.dot(previous) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      ps.push(...state.p.toArray());
      qs.push(...q.toArray());
      previous = q;
    }
    for (const [path, type, values] of [
      ["translation", "VEC3", ps],
      ["rotation", "VEC4", qs],
    ]) {
      const accessor = doc
          .createAccessor(`${d.name}_${name}_${path}`)
          .setType(type)
          .setArray(new Float32Array(values))
          .setBuffer(buffer),
        sampler = doc
          .createAnimationSampler()
          .setInput(input)
          .setOutput(accessor)
          .setInterpolation("LINEAR");
      a.addSampler(sampler).addChannel(
        doc
          .createAnimationChannel()
          .setTargetNode(node)
          .setTargetPath(path)
          .setSampler(sampler),
      );
    }
  }
  return a;
}
function weightedMeshes(info) {
  const result = [];
  for (const n of info.nodes) {
    const skin = n.getSkin(),
      mesh = n.getMesh();
    if (!skin || !mesh) continue;
    for (const p of mesh.listPrimitives()) {
      if (!p.getAttribute("JOINTS_0")) continue;
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
function skinY(info, pose, meshes) {
  let min = Infinity;
  const cache = new Map();
  for (const mesh of meshes) {
    const ms = mesh.bones.map(
      (n, i) =>
        world(info, pose, n, cache).multiply(
          new Matrix4().fromArray(mesh.bind, i * 16),
        ).elements,
    );
    for (const i of mesh.used) {
      const x = mesh.v[i * 3],
        y = mesh.v[i * 3 + 1],
        z = mesh.v[i * 3 + 2];
      let py = 0;
      for (let k = 0; k < 4; k++) {
        const w = mesh.w[i * 4 + k];
        if (!w) continue;
        const m = ms[mesh.j[i * 4 + k]];
        py += w * (m[1] * x + m[5] * y + m[9] * z + m[13]);
      }
      min = Math.min(min, py);
    }
  }
  return min;
}
const produced = new Map(),
  descriptorsByCharacter = new Map();
for (const character of ["prisoner", "gaoler"]) {
  const doc = await io.read(`public/assets/cast/${character}.glb`),
    ctx = context(doc),
    before = ctx.info.nodes.map((n) =>
      JSON.stringify([n.getTranslation(), n.getRotation(), n.getScale()]),
    );
  const descriptors = [
    ...(character === "prisoner"
      ? [...attackDescriptors(ctx, "Spear"), ...attackDescriptors(ctx, "Fist")]
      : []),
    ...evadeDescriptors(ctx),
  ];
  for (const a of [...doc.getRoot().listAnimations()]) a.dispose();
  const baked = descriptors.map((d) => bake(doc, ctx, d));
  for (let i = 0; i < ctx.info.nodes.length; i++)
    assert.equal(
      JSON.stringify([
        ctx.info.nodes[i].getTranslation(),
        ctx.info.nodes[i].getRotation(),
        ctx.info.nodes[i].getScale(),
      ]),
      before[i],
      "Retarget altered rest rig",
    );
  Object.assign(doc.getRoot().getAsset(), {
    copyright:
      "KayKit and Quaternius CC0-1.0 source motion, Patch CC0 target, original new0 proportional retarget",
    extras: {
      version: "fixes2",
      license: "CC0-1.0",
      approvedCombatAndFixes1FilesModified: false,
    },
  });
  const file = resolve(out, `${character}-fixes2.glb`);
  await io.write(file, animationOnly(doc, baked));
  produced.set(character, await io.read(file));
  descriptorsByCharacter.set(character, descriptors);
  report.characters.push({
    character,
    totalHeightScale: ctx.mageScale,
    baseRigTRSUnchanged: true,
    targetReference:
      "Anatomical T reference constructed from native A/rest pose with fixed local translations and scales",
    clips: baked.map((a) => ({
      name: a.getName(),
      digest: animationDigest(a),
      ...a.getExtras(),
    })),
  });
  console.log(
    `Wrote ${character}-fixes2.glb (${baked.length} full-body clips)`,
  );
}
const floor = {
  version: 2,
  timeDomain: "semantic-seconds",
  contractFile: "fixes2-contract.json",
  sampleRate: 60,
  clearance: 0.008,
  sampling:
    "Weighted indexed skin minimum at60Hz, conservative240Hz intersample clearance verification",
  profiles: {},
};
for (const character of ["prisoner", "watcher", "gaoler"]) {
  const file = `public/assets/cast/${character}.glb`,
    doc = await io.read(file),
    ctx = context(doc),
    info = ctx.info,
    meshes = weightedMeshes(info),
    motion = produced.get(character === "gaoler" ? "gaoler" : "prisoner"),
    profile = {
      geometryHash: sha(await readFile(file)),
      geometryHashMethod: "SHA256 of full target GLB",
      geometryFile: `${character}.glb`,
      motionFile:
        character === "gaoler" ? "gaoler-fixes2.glb" : "prisoner-fixes2.glb",
      clips: {},
    },
    metrics = [];
  for (const c of motion.getRoot().listAnimations()) {
    const end = duration(c),
      times = Array.from({ length: Math.ceil(end * 60) + 1 }, (_, i) =>
        Math.min(end, i / 60),
      ),
      offsets = times.map(
        (t) => 0.008 - skinY(info, sample(info, c, t), meshes),
      );
    for (let pass = 0; pass < 2; pass++)
      for (let i = 0; i < times.length - 1; i++)
        for (const u of [0.25, 0.5, 0.75]) {
          const t = times[i] + (times[i + 1] - times[i]) * u,
            needed = 0.008 - skinY(info, sample(info, c, t), meshes),
            inter = offsets[i] * (1 - u) + offsets[i + 1] * u;
          if (needed > inter) {
            const lift = needed - inter + 1e-7;
            offsets[i] += lift;
            offsets[i + 1] += lift;
          }
        }
    profile.clips[c.getName()] = {
      duration: end,
      semanticDuration: c.getExtras().semanticDuration,
      timeDomain: "semantic-seconds",
      phaseMapping: c.getExtras().phaseMapping,
      offsets: offsets.map((x) => Math.ceil(x * 1e6) / 1e6),
    };
    let maxJoint = 0,
      maxBodyJoint = 0,
      maxHand = 0,
      worst = "",
      maxLengthError = 0,
      minFloor = Infinity,
      endError = 0;
    for (let i = 0; i <= Math.ceil(end * 120); i++) {
      const t = Math.min(end, i / 120),
        p = sample(info, c, t),
        index = Math.min(offsets.length - 2, Math.floor(t * 60)),
        u = (t - times[index]) / (times[index + 1] - times[index]);
      minFloor = Math.min(
        minFloor,
        skinY(info, p, meshes) +
          offsets[index] * (1 - u) +
          offsets[index + 1] * u,
      );
      for (const name of nativeNames) {
        const n = info.byName.get(name);
        if (name !== "pelvis")
          maxLengthError = Math.max(
            maxLengthError,
            Math.abs(p.get(n).p.length() - ctx.idle.get(n).p.length()),
          );
      }
      if (i > 0 && i % 2 === 0) {
        const prior = sample(info, c, Math.max(0, t - 1 / 60));
        for (const name of nativeNames) {
          const n = info.byName.get(name),
            angle = (p.get(n).q.angleTo(prior.get(n).q) * 180) / Math.PI;
          if (angle > maxJoint) {
            maxJoint = angle;
            worst = name + "@" + t.toFixed(3);
          }
          if (!/^(upperarm|forearm|hand)/.test(name))
            maxBodyJoint = Math.max(maxBodyJoint, angle);
        }
        maxHand = Math.max(
          maxHand,
          position(info, p, info.byName.get("hand_R")).distanceTo(
            position(info, prior, info.byName.get("hand_R")),
          ),
        );
      }
    }
    const endpoint = sample(info, c, end);
    for (const name of nativeNames)
      endError = Math.max(
        endError,
        (endpoint
          .get(info.byName.get(name))
          .q.angleTo(ctx.idle.get(info.byName.get(name)).q) *
          180) /
          Math.PI,
      );
    const metric = {
      clip: c.getName(),
      maxJointDegreesPer60Hz: maxJoint,
      maxBodyJointDegreesPer60Hz: maxBodyJoint,
      worst,
      maxHandMetresPer60Hz: maxHand,
      maxBoneLengthError: maxLengthError,
      minCorrectedSkinY: minFloor,
      endMaxDegreesFromIdle: endError,
      minOffset: Math.min(...offsets),
      maxOffset: Math.max(...offsets),
    };
    assert(maxLengthError < 2e-6, "Bone lengths changed");
    assert(minFloor > 0.00798, "Floor curve penetrated");
    assert(endError < 0.05, "Endpoint differs from nativeIdle");
    assert(
      maxJoint < 18.5,
      "Discontinuous joint step: " + JSON.stringify(metric),
    );
    assert(
      maxHand < 0.16,
      "Discontinuous human hand path: " + JSON.stringify(metric),
    );
    if (c.getName().includes("Attack")) {
      const hand = c.getName() === "FistAttack1" ? "hand_L" : "hand_R",
        contact = c.getExtras().contact,
        link = c.getExtras().link,
        rows = [];
      const reach = (t) => {
        const p = sample(info, c, t);
        return (
          position(info, p, info.byName.get(hand)).z -
          position(info, p, info.byName.get("pelvis")).z
        );
      };
      for (const t of [
        ...new Set([
          contact,
          ...Array.from({ length: Math.ceil(link * 240) + 1 }, (_, i) =>
            Math.min(link, i / 240),
          ),
        ]),
      ])
        rows.push({ time: t, reach: reach(t) });
      const peak = rows.reduce((a, b) => (a.reach > b.reach ? a : b));
      metric.actualWrist = {
        hand,
        contactTime: contact,
        reachAtContact: reach(contact),
        peakTime: peak.time,
        peakReach: peak.reach,
      };
      assert(
        peak.reach - reach(contact) < 0.01,
        "Damage contact is far from actual target wrist extension: " +
          JSON.stringify(metric.actualWrist),
      );
    }
    metrics.push(metric);
  }
  const seams = [];
  if (character !== "gaoler")
    for (const family of ["Spear", "Fist"])
      for (const [index, t] of [
        [1, 0.52],
        [2, 0.51],
      ]) {
        const a = motion
            .getRoot()
            .listAnimations()
            .find((a) => a.getName() === `${family}Attack${index}`),
          b = motion
            .getRoot()
            .listAnimations()
            .find((a) => a.getName() === `${family}Attack${index + 1}`),
          p = sample(info, a, t),
          q = sample(info, b, 0);
        let degrees = 0,
          metres = 0;
        for (const n of info.nodes) {
          degrees = Math.max(
            degrees,
            (p.get(n).q.angleTo(q.get(n).q) * 180) / Math.PI,
          );
          metres = Math.max(
            metres,
            position(info, p, n).distanceTo(position(info, q, n)),
          );
        }
        assert(
          degrees < 0.05 && metres < 1e-5,
          "Serialized combo seam changed",
        );
        seams.push({
          from: a.getName(),
          time: t,
          to: b.getName(),
          maxLocalDegrees: degrees,
          maxWorldMetres: metres,
        });
      }
  floor.profiles[character] = profile;
  report.profiles.push({ character, clips: metrics, seams });
  console.log(`Checked floor and motion for ${character}`);
}
const rootTravel = Object.fromEntries(
  descriptorsByCharacter
    .get("prisoner")
    .filter((d) => d.rootCurve)
    .map((d) => [d.name, d.rootCurve]),
);
await writeFile(
  resolve(root, "src/evade-motion-data.json"),
  JSON.stringify(rootTravel) + "\n",
);
const contract = {
  version: 2,
  timeDomain: "semantic-seconds",
  files: {
    human: "prisoner-fixes2.glb",
    gaoler: "gaoler-fixes2.glb",
    floor: "fixes2-floor.json",
  },
  attacks: attacks.map((a, i) => ({
    ...a,
    spearClip: `SpearAttack${i + 1}`,
    fistClip: `FistAttack${i + 1}`,
  })),
  evades: {
    duration: 0.82,
    rootMotionExtracted: true,
    curveInterpolation:
      "Linear between samples of normalized traveled distance. Multiply by the selected directional distance exactly once. Root travel belongs to Campaign, never also to clip pelvis.",
    rootTravel,
  },
  retarget: {
    restTRSUnchanged: true,
    pelvisDisplacementScale:
      "Total head-to-ankle height, never hips-height ratio",
    targetMageReference:
      "Anatomically aligned T-reference, source wrist instead of auxiliary hand-slot roll",
    plantedFootPolicy:
      "Foot endpoints and world rotations preserved with analytic leg IK and forward knee poles. Floor curves use actual weighted skin.",
    fullBody: true,
  },
  protectedAssets: protectedHashes,
  sourceContacts: report.contacts,
};
await writeFile(
  resolve(out, "fixes2-floor.json"),
  JSON.stringify(floor) + "\n",
);
await writeFile(
  resolve(out, "fixes2-contract.json"),
  JSON.stringify(contract, null, 2) + "\n",
);
const provenance = {
  version: 2,
  license: "CC0-1.0",
  sources: Object.fromEntries(
    Object.entries(sources).map(([k, s]) => [
      k,
      {
        file: s.file,
        sha256: s.sha256,
        author: s.author,
        source: s.source,
        licenseFile: s.licenseFile,
        licenseText: s.license,
      },
    ]),
  ),
  adaptations: [
    "Dedicated KayKit two-handed stab retargeted to full human body in three semantic timing variants",
    "Quaternius Jab and Cross retain sourced full-body actions with native recovery and shared combo seams",
    "Quaternius Melee_Hook body windup and weight transfer adapted to an upright human boxing stance with an original analytic right hook arm arc and opposite face guard. This is a proportion and motion adaptation, not an unchanged imported boxing clip.",
    "KayKit actual directional evades converted to in-place pose and separate normalized short travel curves. Source balancing-arm amplitude reduced to55% for compact weapon-safe movement.",
  ],
  noLegacyAssetsModified: true,
};
await writeFile(
  resolve(out, "fixes2-provenance.json"),
  JSON.stringify(provenance, null, 2) + "\n",
);
for (const f of protectedFiles)
  assert.equal(
    sha(await readFile(resolve(out, f))),
    protectedHashes[f],
    `Protected asset changed: ${f}`,
  );
await writeFile(
  resolve(work, "combat-asset-report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      protectedFiles: protectedFiles.length,
      sourceContacts: report.contacts,
      profiles: report.profiles.map((p) => ({
        character: p.character,
        maxJointDegrees: Math.max(
          ...p.clips.map((c) => c.maxJointDegreesPer60Hz),
        ),
        maxHandStep: Math.max(...p.clips.map((c) => c.maxHandMetresPer60Hz)),
      })),
    },
    null,
    2,
  ),
);
