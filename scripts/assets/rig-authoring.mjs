import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { Matrix4, Vector3, Quaternion } from "three";
import { resolve } from "node:path";

export async function loadAuthorRig(projectRoot) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(
    resolve(projectRoot, "public/assets/knight/knight.glb"),
  );
  const root = doc.getRoot();
  const nodes = root.listNodes();
  const byName = new Map(nodes.map((n) => [n.getName(), n]));
  const joints = root.listSkins()[0].listJoints();
  const parent = new Map();
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
  for (const channel of root
    .listAnimations()
    .find((a) => a.getName() === "Idle")
    .listChannels()) {
    const values = channel.getSampler().getOutput().getArray();
    const t = base.get(channel.getTargetNode());
    if (channel.getTargetPath() === "translation") t.p.fromArray(values);
    if (channel.getTargetPath() === "rotation")
      t.q.fromArray(values).normalize();
    // Original microscopic export scale noise is not used in the authored clips.
  }
  const X = new Vector3(1, 0, 0),
    Y = new Vector3(0, 1, 0),
    Z = new Vector3(0, 0, 1);
  const clonePose = () =>
    new Map(
      [...base].map(([n, t]) => [
        n,
        { p: t.p.clone(), q: t.q.clone(), s: t.s.clone() },
      ]),
    );
  function world(pose, n) {
    const t = pose.get(n);
    const local = new Matrix4().compose(t.p, t.q, t.s);
    return parent.has(n) ? world(pose, parent.get(n)).multiply(local) : local;
  }
  function worldQ(pose, n) {
    const p = new Vector3(),
      q = new Quaternion(),
      s = new Vector3();
    world(pose, n).decompose(p, q, s);
    return q.normalize();
  }
  const position = (pose, n) =>
    new Vector3().setFromMatrixPosition(world(pose, n));
  function setWorldQ(pose, n, q) {
    const pq = parent.has(n) ? worldQ(pose, parent.get(n)) : new Quaternion();
    pose.get(n).q.copy(pq.invert().multiply(q)).normalize();
  }
  function rotateWorld(pose, name, axis, angle) {
    const n = byName.get(name);
    setWorldQ(
      pose,
      n,
      new Quaternion().setFromAxisAngle(axis, angle).multiply(worldQ(pose, n)),
    );
  }
  function aim(pose, n, child, target) {
    const origin = position(pose, n);
    const from = position(pose, child).sub(origin).normalize();
    const to = target.clone().sub(origin).normalize();
    const delta = new Quaternion().setFromUnitVectors(from, to);
    setWorldQ(pose, n, delta.multiply(worldQ(pose, n)));
  }
  function twoBone(
    pose,
    upperName,
    lowerName,
    endName,
    targetArray,
    poleArray,
  ) {
    const a = byName.get(upperName),
      b = byName.get(lowerName),
      c = byName.get(endName);
    const start = position(pose, a),
      target = new Vector3(...targetArray),
      pole = new Vector3(...poleArray);
    const l1 = pose.get(b).p.length(),
      l2 = pose.get(c).p.length();
    const direction = target.clone().sub(start);
    const distance = Math.min(
      l1 + l2 - 0.004,
      Math.max(Math.abs(l1 - l2) + 0.004, direction.length()),
    );
    direction.normalize();
    target.copy(start).addScaledVector(direction, distance);
    const perpendicular = pole
      .sub(start)
      .addScaledVector(direction, -pole.dot(direction))
      .normalize();
    const along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance);
    const height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    const elbow = start
      .clone()
      .addScaledVector(direction, along)
      .addScaledVector(perpendicular, height);
    aim(pose, a, b, elbow);
    aim(pose, b, c, target);
  }
  const ankleR = position(base, byName.get("foot_R"));
  const ankleL = position(base, byName.get("foot_L"));
  const footQR = worldQ(base, byName.get("foot_R"));
  const footQL = worldQ(base, byName.get("foot_L"));
  function plantedLegs(pose, shiftL = [0, 0, 0], shiftR = [0, 0, 0]) {
    const l = ankleL.clone().add(new Vector3(...shiftL));
    const r = ankleR.clone().add(new Vector3(...shiftR));
    twoBone(pose, "thigh_L", "shin_L", "foot_L", l.toArray(), [0.28, 0.55, 1]);
    twoBone(pose, "thigh_R", "shin_R", "foot_R", r.toArray(), [-0.28, 0.55, 1]);
    setWorldQ(pose, byName.get("foot_L"), footQL);
    setWorldQ(pose, byName.get("foot_R"), footQR);
  }
  function swordHand(pose, directionArray) {
    const hand = byName.get("hand_R"),
      elbow = byName.get("forearm_R");
    const fingerAxis = position(pose, hand)
      .sub(position(pose, elbow))
      .normalize();
    const blade = new Vector3(...directionArray);
    blade.addScaledVector(fingerAxis, -blade.dot(fingerAxis)).normalize();
    const z = blade.negate(),
      x = fingerAxis.clone().cross(z).normalize();
    z.crossVectors(x, fingerAxis).normalize();
    setWorldQ(
      pose,
      hand,
      new Quaternion().setFromRotationMatrix(
        new Matrix4().makeBasis(x, fingerAxis, z),
      ),
    );
  }
  function arms(
    pose,
    right,
    left,
    blade = [0, 0.1, 1],
    rightPole = [-0.85, 1.35, 0.2],
    leftPole = [0.85, 1.25, 0.2],
  ) {
    twoBone(pose, "upperarm_R", "forearm_R", "hand_R", right, rightPole);
    twoBone(pose, "upperarm_L", "forearm_L", "hand_L", left, leftPole);
    swordHand(pose, blade);
  }
  function body(
    pose,
    { down = 0, x = 0, z = 0, yaw = 0, lean = 0, twist = 0, side = 0 } = {},
  ) {
    const p = pose.get(byName.get("pelvis")).p;
    p.y -= down;
    p.x += x;
    p.z += z;
    rotateWorld(pose, "pelvis", Y, yaw);
    rotateWorld(pose, "pelvis", X, lean * 0.24);
    rotateWorld(pose, "pelvis", Z, side);
    rotateWorld(pose, "spine1", X, lean * 0.34);
    rotateWorld(pose, "spine2", X, lean * 0.27);
    rotateWorld(pose, "chest", X, lean * 0.15);
    rotateWorld(pose, "spine1", Y, twist * 0.4);
    rotateWorld(pose, "chest", Y, twist * 0.6);
    rotateWorld(pose, "neck", X, -lean * 0.25);
  }
  const skin = root.listSkins()[0],
    jointList = skin.listJoints();
  const inverseBinds = skin.getInverseBindMatrices().getArray();
  const primitive = root.listMeshes()[0].listPrimitives()[0];
  const posData = primitive.getAttribute("POSITION").getArray();
  const jointData = primitive.getAttribute("JOINTS_0").getArray();
  const weightData = primitive.getAttribute("WEIGHTS_0").getArray();
  function minimumSkinY(pose) {
    const matrices = jointList.map(
      (n, i) =>
        world(pose, n).multiply(new Matrix4().fromArray(inverseBinds, i * 16))
          .elements,
    );
    let min = Infinity;
    for (let i = 0; i < posData.length / 3; i++) {
      const x = posData[i * 3],
        y = posData[i * 3 + 1],
        z = posData[i * 3 + 2];
      let sy = 0;
      for (let k = 0; k < 4; k++) {
        const w = weightData[i * 4 + k];
        if (!w) continue;
        const m = matrices[jointData[i * 4 + k]];
        sy += w * (m[1] * x + m[5] * y + m[9] * z + m[13]);
      }
      min = Math.min(min, sy);
    }
    return min;
  }

  return {
    io,
    doc,
    root,
    nodes,
    byName,
    joints,
    parent,
    base,
    clonePose,
    world,
    worldQ,
    position,
    setWorldQ,
    rotateWorld,
    plantedLegs,
    arms,
    body,
    minimumSkinY,
    axes: { X, Y, Z },
  };
}
