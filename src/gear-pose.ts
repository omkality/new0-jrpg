import * as THREE from "three";
import { WEAPON_MOUNTS, HAND_GRIP, WEAPON_GRIP_SHIFT } from "./weapon-spec.ts";
import type { WeaponId } from "./world-layout.ts";
import { ATTACKS } from "./game.ts";

// A small arm/wrist constraint, applied after the skinned clip blend. The hand
// stays on the grip. No weapon is translated away from the fingers or shrunk.
export class GearPose {
  private v = Array.from({ length: 72 }, () => new THREE.Vector3());
  private q = Array.from({ length: 18 }, () => new THREE.Quaternion());
  private matrix = new THREE.Matrix4();
  private points = new Map<WeaponId, THREE.Vector3[]>();
  private hand?: THREE.Object3D;
  private upper?: THREE.Object3D;
  private forearm?: THREE.Object3D;
  private pelvis?: THREE.Object3D;
  private chest?: THREE.Object3D;
  private head?: THREE.Object3D;
  private mouth = new THREE.Vector3(0, 0, 0.16);
  private leftUpper?: THREE.Object3D;
  private rig: THREE.Object3D;
  private grips: THREE.Mesh[] = [];
  private armBones: THREE.Object3D[] = [];
  private baseArms: THREE.Quaternion[] = [];
  private bestArms: THREE.Quaternion[] = [];
  diagnostics = { selectedPenalty: 0, finalPenalty: 0, candidates: 0 };
  private gaoler: boolean;
  private verify: boolean;
  constructor(rig: THREE.Object3D, gaoler = false, verify = false) {
    this.verify = verify;
    this.gaoler = gaoler;
    this.rig = rig;
    this.hand = rig.getObjectByName("hand_R");
    this.upper = rig.getObjectByName("upperarm_R");
    this.forearm = rig.getObjectByName("forearm_R");
    this.pelvis = rig.getObjectByName("pelvis");
    this.chest = rig.getObjectByName("chest");
    this.head = rig.getObjectByName("head");
    this.leftUpper = rig.getObjectByName("upperarm_L");
    this.armBones = [
      "upperarm_R",
      "forearm_R",
      "hand_R",
      "upperarm_L",
      "forearm_L",
      "hand_L",
    ]
      .map((n) => rig.getObjectByName(n)!)
      .filter(Boolean);
    this.baseArms = this.armBones.map(() => new THREE.Quaternion());
    this.bestArms = this.armBones.map(() => new THREE.Quaternion());
    rig.updateWorldMatrix(true, true);
    const mouthMesh = rig.getObjectByName("original_mask_mouth");
    if (this.head && mouthMesh instanceof THREE.Mesh) {
      mouthMesh.geometry.computeBoundingBox();
      mouthMesh.geometry
        .boundingBox!.getCenter(this.mouth)
        .applyMatrix4(mouthMesh.matrixWorld);
      this.head.worldToLocal(this.mouth);
    }
    rig.traverse((o) => {
      if (
        o instanceof THREE.Mesh &&
        o.morphTargetDictionary?.new0GripR !== undefined
      )
        this.grips.push(o);
    });
    for (const id of ["sword", "axe", "spear", "relic"] as WeaponId[]) {
      const s = WEAPON_MOUNTS[id];
      const dimensions =
        id === "axe"
          ? [
              [-0.035, -0.22, 0],
              [0, 0.1, 0],
              [0, 0.45, 0],
              [0, 0.74, 0],
              [0.32, 0.84, 0.03],
              [0.29, 0.45, -0.03],
              [-0.045, 0.72, 0.03],
            ]
          : id === "spear"
            ? [
                [0, -0.55, 0],
                [0, -0.25, 0],
                [0, 0.25, 0],
                [0, 0.7, 0],
                [0, 1.0, 0],
                [-0.135, 1.2, 0.02],
                [0.135, 1.2, -0.02],
                [0, 1.49, 0],
              ]
            : [
                [0, -0.23, 0],
                [0, 0, 0],
                [-0.19, 0.12, 0.03],
                [0.19, 0.12, -0.03],
                [0, 0.4, 0],
                [0, 0.7, 0],
                [0, 1.1, 0],
              ];
      const mount = new THREE.Matrix4()
        .makeTranslation(
          new THREE.Vector3().fromArray(
            HAND_GRIP[this.gaoler ? "gaoler" : "human"],
          ),
        )
        .multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2))
        .multiply(
          new THREE.Matrix4().makeTranslation(0, WEAPON_GRIP_SHIFT[id], 0),
        )
        .multiply(new THREE.Matrix4().makeRotationY(s.twist))
        .scale(new THREE.Vector3(s.scale, s.scale, s.scale));
      const p = dimensions.map((a) =>
        new THREE.Vector3(...(a as [number, number, number])).applyMatrix4(
          mount,
        ),
      );
      // Interior shaft samples catch a blade passing through cloth between ends.
      for (let i = 0; i < 8; i++)
        p.push(new THREE.Vector3(0, -0.15 + i * 0.14, 0).applyMatrix4(mount));
      this.points.set(id, p);
    }
  }
  private turn(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
    const delta = this.q[6].setFromUnitVectors(
      this.v[27].copy(from).normalize(),
      this.v[28].copy(to).normalize(),
    );
    bone.getWorldQuaternion(this.q[7]);
    bone.parent!.getWorldQuaternion(this.q[8]);
    bone.quaternion.copy(
      this.q[8].invert().multiply(delta).multiply(this.q[7]),
    );
    bone.updateWorldMatrix(false, true);
  }
  private reach(
    upper: THREE.Object3D,
    forearm: THREE.Object3D,
    hand: THREE.Object3D,
    target: THREE.Vector3,
    shaft?: THREE.Vector3,
    distalHint?: THREE.Vector3,
  ) {
    const a = upper.getWorldPosition(this.v[20]),
      b = forearm.getWorldPosition(this.v[21]),
      c = hand.getWorldPosition(this.v[22]);
    const l1 = a.distanceTo(b),
      l2 = b.distanceTo(c),
      axis = this.v[23].copy(target).sub(a),
      d = THREE.MathUtils.clamp(
        axis.length(),
        Math.abs(l1 - l2) + 0.005,
        (l1 + l2) * 0.985,
      );
    axis.normalize();
    const bend = this.v[24]
      .copy(b)
      .sub(a)
      .addScaledVector(axis, -this.v[25].copy(b).sub(a).dot(axis));
    if (bend.lengthSq() < 1e-6)
      bend.set(1, 0, 0).addScaledVector(axis, -axis.x);
    bend.normalize();
    const along = (l1 * l1 + d * d - l2 * l2) / (2 * d),
      height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    if (shaft && height > 0.0001) {
      const other = this.v[47].crossVectors(axis, bend).normalize();
      const centre = this.v[48].copy(a).addScaledVector(axis, along);
      const ca = bend.dot(shaft),
        cb = other.dot(shaft),
        amplitude = Math.hypot(ca, cb);
      if (amplitude > 0.0001) {
        const value = THREE.MathUtils.clamp(
          this.v[49].copy(target).sub(centre).dot(shaft) / (height * amplitude),
          -1,
          1,
        );
        const phase = Math.atan2(cb, ca),
          swing = Math.acos(value);
        const wrap = (n: number) => Math.atan2(Math.sin(n), Math.cos(n));
        const first = wrap(phase + swing),
          second = wrap(phase - swing);
        let angle = Math.abs(first) < Math.abs(second) ? first : second;
        if (distalHint) {
          const score = (n: number) =>
            this.v[51]
              .copy(target)
              .sub(centre)
              .addScaledVector(bend, -height * Math.cos(n))
              .addScaledVector(other, -height * Math.sin(n))
              .normalize()
              .dot(distalHint);
          angle = score(first) > score(second) ? first : second;
        }
        bend
          .multiplyScalar(Math.cos(angle))
          .addScaledVector(other, Math.sin(angle));
      }
    }
    const elbow = this.v[26]
      .copy(a)
      .addScaledVector(axis, along)
      .addScaledVector(bend, height);
    this.turn(upper, this.v[29].copy(b).sub(a), this.v[30].copy(elbow).sub(a));
    forearm.getWorldPosition(b);
    hand.getWorldPosition(c);
    this.turn(
      forearm,
      this.v[29].copy(c).sub(b),
      this.v[30].copy(target).sub(b),
    );
  }
  private capsuleDistance(
    p: THREE.Vector3,
    a: THREE.Vector3,
    b: THREE.Vector3,
  ) {
    const axis = this.v[18].copy(b).sub(a),
      length = axis.lengthSq();
    const t = length
      ? THREE.MathUtils.clamp(
          this.v[19].copy(p).sub(a).dot(axis) / length,
          0,
          1,
        )
      : 0;
    return p.distanceTo(this.v[19].copy(a).addScaledVector(axis, t));
  }
  setGrip(right: number, left: number) {
    for (const mesh of this.grips) {
      mesh.morphTargetInfluences![mesh.morphTargetDictionary!.new0GripR] =
        right;
      mesh.morphTargetInfluences![mesh.morphTargetDictionary!.new0GripL] = left;
    }
  }
  private wrist(
    hand: THREE.Object3D,
    forearm: THREE.Object3D,
    shaft: THREE.Vector3,
    result: THREE.Quaternion,
    palm?: THREE.Vector3,
  ) {
    const distal = this.v[40]
      .copy(hand.getWorldPosition(this.v[41]))
      .sub(forearm.getWorldPosition(this.v[42]))
      .normalize();
    const z = this.v[43].copy(shaft).negate().normalize();
    if (palm) distal.copy(palm);
    distal.addScaledVector(z, -distal.dot(z)).normalize();
    const x = this.v[44].crossVectors(distal, z).normalize();
    result.setFromRotationMatrix(this.matrix.makeBasis(x, distal, z));
  }
  private seatWrist(
    hand: THREE.Object3D,
    forearm: THREE.Object3D,
    orientation: THREE.Quaternion,
  ) {
    // Share pronation along the forearm, keeping a straight wrist rather than
    // applying the full axial twist at the hand joint.
    const axis = this.v[40]
      .copy(hand.getWorldPosition(this.v[41]))
      .sub(forearm.getWorldPosition(this.v[42]))
      .normalize();
    const native = hand.getWorldQuaternion(this.q[10]);
    const delta = this.q[11]
      .copy(orientation)
      .multiply(this.q[12].copy(native).invert());
    const amount = delta.x * axis.x + delta.y * axis.y + delta.z * axis.z;
    const twist = this.q[12]
      .set(axis.x * amount, axis.y * amount, axis.z * amount, delta.w)
      .normalize();
    if (twist.w < 0) twist.set(-twist.x, -twist.y, -twist.z, -twist.w);
    this.q[13].identity().slerp(twist, 0.72);
    forearm.getWorldQuaternion(this.q[14]);
    forearm.parent!.getWorldQuaternion(this.q[15]);
    forearm.quaternion.copy(
      this.q[15].invert().multiply(this.q[13]).multiply(this.q[14]),
    );
    forearm.updateWorldMatrix(false, true);
    hand.parent!.getWorldQuaternion(this.q[14]);
    hand.quaternion.copy(this.q[14].invert().multiply(orientation));
    hand.updateWorldMatrix(false, true);
  }
  apply(
    id: WeaponId,
    clip: string,
    floor: number,
    exact?: (matrix: THREE.Matrix4, correction?: THREE.Vector3) => number,
    time = 0,
  ) {
    const twoHands =
      (id === "spear" && !/^(Dodge|Death|Hit|Drink)/.test(clip)) ||
      (id === "axe" && !this.gaoler && /^(Attack|Guard|Block)/.test(clip));
    this.setGrip(id === "unarmed" ? 0 : 1, twoHands ? 1 : 0);
    if (
      id === "unarmed" ||
      !this.hand ||
      !this.upper ||
      !this.forearm ||
      !this.pelvis ||
      !this.chest ||
      !this.head
    )
      return;
    this.rig.updateWorldMatrix(true, true);
    const hand = this.hand,
      upper = this.upper,
      forearm = this.forearm;
    const pelvis = this.pelvis.getWorldPosition(this.v[0]),
      chest = this.chest.getWorldPosition(this.v[1]),
      head = this.head.getWorldPosition(this.v[2]);
    const up = this.v[3].copy(chest).sub(pelvis).normalize();
    const right = this.v[4]
      .copy(upper.getWorldPosition(this.v[45]))
      .sub(this.leftUpper!.getWorldPosition(this.v[46]))
      .normalize();
    const front = this.v[5]
      .set(0, 0, 1)
      .transformDirection(this.rig.matrixWorld);
    const raw = hand.getWorldPosition(this.v[8]),
      scale = hand.getWorldScale(this.v[9]);
    const palm = this.v[53]
      .copy(raw)
      .sub(forearm.getWorldPosition(this.v[54]))
      .normalize();
    const width = upper
      .getWorldPosition(this.v[45])
      .distanceTo(this.leftUpper!.getWorldPosition(this.v[46]));
    const s = Math.max(scale.x, scale.y, scale.z),
      bodyScale = chest.distanceTo(pelvis) / 0.37;
    const a = this.v[6].copy(pelvis).addScaledVector(up, -0.16 * bodyScale),
      b = this.v[7].copy(chest).addScaledVector(up, -0.02 * bodyScale),
      radius = 0.19 * bodyScale;
    const carry = ["Idle", "Walk", "Run", "Drink"].includes(clip),
      guard = /^(Guard|Block)/.test(clip),
      attack = /^Attack([123])$/.exec(clip);
    const target = this.v[10].copy(raw),
      preferred = this.v[32];
    hand.getWorldQuaternion(this.q[9]);
    preferred.set(0, 0, -1).applyQuaternion(this.q[9]);
    if (carry || guard) {
      palm.copy(front);
      const spread = id === "spear" ? 0.2 : id === "axe" ? 0.32 : 0.29;
      target
        .copy(pelvis)
        .addScaledVector(right, spread * bodyScale)
        .addScaledVector(
          up,
          (guard ? 0.2 : id === "axe" ? 0.09 : 0.15) * bodyScale,
        )
        .addScaledVector(
          front,
          (id === "spear" ? 0.24 : guard ? 0.35 : 0.23) * bodyScale,
        );
      if (id === "spear")
        preferred
          .copy(up)
          .multiplyScalar(0.75)
          .addScaledVector(front, 0.2)
          .addScaledVector(right, clip === "Drink" ? 0.35 : -0.55)
          .normalize();
      else if (id === "axe")
        preferred
          .copy(up)
          .multiplyScalar(0.72)
          .addScaledVector(front, 0.72)
          .addScaledVector(right, 0.16)
          .normalize();
      else
        preferred
          .copy(up)
          .multiplyScalar(0.9)
          .addScaledVector(front, 0.3)
          .addScaledVector(right, 0.3)
          .normalize();
    }
    if (id === "spear" && attack) {
      palm.copy(up).negate();
      const contact = ATTACKS[Number(attack[1]) - 1].contact;
      const thrust = Math.exp(-(((time - contact) / 0.14) ** 2));
      target
        .copy(pelvis)
        .addScaledVector(right, 0.2 * bodyScale)
        .addScaledVector(up, 0.18 * bodyScale)
        .addScaledVector(front, (0.12 + 0.1 * thrust) * bodyScale);
      preferred
        .copy(front)
        .addScaledVector(up, 0.12)
        .addScaledVector(right, -0.25)
        .normalize();
    }
    const cuttingPalm = this.v[52];
    const axeStrike = id === "axe" && (attack || guard);
    if (axeStrike) {
      const contact = attack ? ATTACKS[Number(attack[1]) - 1].contact : 0.3;
      const progress = attack
        ? THREE.MathUtils.clamp((time - contact + 0.2) / 0.32, 0, 1)
        : 0;
      const angle = 0.16 + progress * 1.74;
      target
        .copy(pelvis)
        .addScaledVector(
          right,
          (this.gaoler ? 0.32 : 0.07 - 0.02 * progress) * bodyScale,
        )
        .addScaledVector(up, (0.34 - 0.23 * progress) * bodyScale)
        .addScaledVector(
          front,
          (this.gaoler ? 0.26 : 0.34 + 0.04 * progress) * bodyScale,
        );
      preferred
        .copy(up)
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(front, Math.sin(angle))
        .addScaledVector(right, -0.45 * Math.sin(angle))
        .normalize();
      cuttingPalm
        .copy(front)
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(up, -Math.sin(angle))
        .normalize();
      palm.copy(cuttingPalm);
    }
    // During a roll the free arm supports the body, while the weapon stays
    // on the outer side, parallel to the floor instead of cutting through it.
    if (/^Dodge/.test(clip)) {
      // Tucked thighs pass the waist during a full roll. Hold the weapon in
      // front of the head, outside that swept volume, with the free arm tucked.
      const bodyFront = this.v[50]
        .set(0, 0, 1)
        .transformDirection(this.chest.matrixWorld);
      target
        .copy(head)
        .addScaledVector(right, 0.2 * bodyScale)
        .addScaledVector(bodyFront, 0.3 * bodyScale);
      target.y = Math.max(floor + 0.4 * s, target.y);
      preferred.copy(right);
      preferred.y = Math.max(0.05, preferred.y);
      preferred.normalize();
      palm.copy(bodyFront);
    }
    if (/^Death/.test(clip) && target.y - floor < 0.6 * bodyScale)
      preferred.copy(front).addScaledVector(right, 0.35).normalize();
    target.y = Math.max(target.y, floor + 0.25 * s);
    const outward = this.v[31]
      .copy(target)
      .sub(chest)
      .addScaledVector(up, -this.v[55].copy(target).sub(chest).dot(up));
    if (outward.lengthSq() < 0.001) outward.copy(right);
    else outward.normalize();
    for (let i = 0; i < this.armBones.length; i++)
      this.baseArms[i].copy(this.armBones[i].quaternion);
    let bestScore = Infinity;
    this.diagnostics.candidates = 0;
    const leftHand = this.rig.getObjectByName("hand_L"),
      leftForearm = this.rig.getObjectByName("forearm_L");
    for (let attempt = 0; attempt < 6; attempt++) {
      for (let k = 0; k < 5; k++) {
        for (let i = 0; i < this.armBones.length; i++)
          this.armBones[i].quaternion.copy(this.baseArms[i]);
        this.rig.updateWorldMatrix(true, true);
        const goal = this.v[15].copy(target);
        if (attempt === 1) goal.addScaledVector(outward, 0.12 * s);
        if (attempt === 2) goal.addScaledVector(front, 0.22 * s);
        if (attempt === 3)
          goal
            .addScaledVector(right, -0.1 * s)
            .addScaledVector(front, -0.05 * s);
        if (attempt === 4)
          goal.addScaledVector(outward, 0.22 * s).y += 0.08 * s;
        if (attempt === 5) goal.addScaledVector(front, -0.12 * s).y += 0.12 * s;
        const turn = [0, 0.2, -0.2, 0.4, -0.4][k],
          shaft = this.v[35]
            .copy(preferred)
            .applyAxisAngle(palm, turn)
            .normalize();
        this.placeArm(
          upper,
          forearm,
          hand,
          goal,
          shaft,
          palm,
          axeStrike ? 0.4 : k >= 3 ? (k === 3 ? 0.3 : -0.3) : 0,
        );
        let supportGap = 0;
        if (twoHands && leftHand && leftForearm && this.leftUpper) {
          const grip = this.v[36]
            .fromArray(HAND_GRIP[this.gaoler ? "gaoler" : "human"])
            .applyMatrix4(hand.matrixWorld);
          const support = this.v[38]
            .copy(grip)
            .addScaledVector(
              shaft,
              (id === "spear" ? (attack ? 0.27 : 0.32) : 0.18) * s,
            );
          for (let step = 0; step < 3; step++) {
            this.reach(this.leftUpper, leftForearm, leftHand, support, shaft);
            this.wrist(leftHand, leftForearm, shaft, this.q[16]);
            const offset = this.v[39].fromArray(
              HAND_GRIP[this.gaoler ? "gaoler" : "human"],
            );
            offset.x *= -1;
            offset.multiply(scale).applyQuaternion(this.q[16]);
            const wrist = this.v[56].copy(support).sub(offset);
            this.reach(this.leftUpper, leftForearm, leftHand, wrist, shaft);
            this.wrist(leftHand, leftForearm, shaft, this.q[16]);
            this.seatWrist(leftHand, leftForearm, this.q[16]);
          }
          const leftGrip = this.v[39].fromArray(
            HAND_GRIP[this.gaoler ? "gaoler" : "human"],
          );
          leftGrip.x *= -1;
          leftGrip.applyMatrix4(leftHand.matrixWorld);
          supportGap = leftGrip.distanceTo(support);
        }
        if (
          !twoHands &&
          (attack || guard) &&
          leftHand &&
          leftForearm &&
          this.leftUpper
        ) {
          const rest = this.v[38]
            .copy(pelvis)
            .addScaledVector(right, -0.35 * bodyScale)
            .addScaledVector(front, 0.12 * bodyScale)
            .addScaledVector(up, -0.05 * bodyScale);
          this.placeArm(
            this.leftUpper,
            leftForearm,
            leftHand,
            rest,
            front,
            this.v[39].copy(up).negate(),
          );
        }
        const hp = hand.getWorldPosition(this.v[16]),
          orientation = hand.getWorldQuaternion(this.q[5]);
        let penalty = 0;
        this.diagnostics.candidates++;
        if (exact) penalty = exact(this.matrix.compose(hp, orientation, scale));
        else
          for (const point of this.points.get(id)!) {
            const p = this.v[17]
              .copy(point)
              .multiply(scale)
              .applyQuaternion(orientation)
              .add(hp);
            penalty +=
              Math.max(0, radius - this.capsuleDistance(p, a, b)) * 300 +
              Math.max(0, floor + 0.01 - p.y) * 1000;
          }
        const score =
          penalty +
          supportGap * 200 +
          hp.distanceTo(target) * 2 +
          Math.abs(turn) * 0.6 +
          attempt * 0.02;
        if (score < bestScore) {
          this.diagnostics.selectedPenalty = penalty;
          bestScore = score;
          this.v[14].copy(goal);
          this.v[61].copy(shaft);
          for (let i = 0; i < this.armBones.length; i++)
            this.bestArms[i].copy(this.armBones[i].quaternion);
        }
        if (attempt === 0 && k === 0 && penalty === 0 && supportGap < 0.02) {
          attempt = 6;
          break;
        }
      }
    }
    for (let i = 0; i < this.armBones.length; i++)
      this.armBones[i].quaternion.copy(this.bestArms[i]);
    this.rig.updateWorldMatrix(true, true);
    if (exact && !twoHands && this.diagnostics.selectedPenalty > 0) {
      const goal = this.v[64].copy(this.v[14]),
        shaft = this.v[65].copy(this.v[61]);
      for (let step = 0; step < 8; step++) {
        const hp = hand.getWorldPosition(this.v[16]),
          q = hand.getWorldQuaternion(this.q[5]),
          push = this.v[62].set(0, 0, 0);
        const penalty = exact(this.matrix.compose(hp, q, scale), push);
        if (penalty === 0 || push.lengthSq() < 1e-8) break;
        goal.add(push);
        const direction = this.v[63].copy(push).normalize();
        this.placeArm(upper, forearm, hand, goal, shaft, palm, 0.4, direction);
        const position = hand.getWorldPosition(this.v[16]),
          rotation = hand.getWorldQuaternion(this.q[5]);
        const next = exact(this.matrix.compose(position, rotation, scale));
        this.diagnostics.candidates++;
        if (next === 0) {
          this.diagnostics.selectedPenalty = 0;
          for (let i = 0; i < this.armBones.length; i++)
            this.bestArms[i].copy(this.armBones[i].quaternion);
          break;
        }
      }
      for (let i = 0; i < this.armBones.length; i++)
        this.armBones[i].quaternion.copy(this.bestArms[i]);
      this.rig.updateWorldMatrix(true, true);
    }
    if (this.verify && exact) {
      const p = hand.getWorldPosition(this.v[16]),
        q = hand.getWorldQuaternion(this.q[5]);
      this.diagnostics.finalPenalty = exact(this.matrix.compose(p, q, scale));
    }
  }
  private placeArm(
    upper: THREE.Object3D,
    forearm: THREE.Object3D,
    hand: THREE.Object3D,
    goal: THREE.Vector3,
    shaft: THREE.Vector3,
    palmHint: THREE.Vector3,
    flex = 0,
    flexDirection?: THREE.Vector3,
  ) {
    const a = upper.getWorldPosition(this.v[20]),
      b = forearm.getWorldPosition(this.v[21]),
      c = hand.getWorldPosition(this.v[22]);
    const l1 = a.distanceTo(b),
      l2 = b.distanceTo(c),
      palm = this.v[57]
        .copy(palmHint)
        .addScaledVector(shaft, -palmHint.dot(shaft))
        .normalize();
    const flexAxis = this.v[66]
      .copy(flexDirection ?? shaft)
      .addScaledVector(palm, -this.v[67].copy(flexDirection ?? shaft).dot(palm))
      .normalize();
    const distal = this.v[60]
      .copy(palm)
      .multiplyScalar(Math.cos(flex))
      .addScaledVector(flexAxis, Math.sin(flex))
      .normalize();
    const elbow = this.v[58]
      .copy(goal)
      .addScaledVector(distal, -l2)
      .sub(a)
      .normalize()
      .multiplyScalar(l1)
      .add(a);
    const target = this.v[59].copy(elbow).addScaledVector(distal, l2);
    this.turn(upper, this.v[29].copy(b).sub(a), this.v[30].copy(elbow).sub(a));
    forearm.getWorldPosition(b);
    hand.getWorldPosition(c);
    this.turn(
      forearm,
      this.v[29].copy(c).sub(b),
      this.v[30].copy(target).sub(b),
    );
    this.wrist(hand, forearm, shaft, this.q[5], palm);
    this.seatWrist(hand, forearm, this.q[5]);
  }
  drink(time: number) {
    const upper = this.rig.getObjectByName("upperarm_L"),
      forearm = this.rig.getObjectByName("forearm_L"),
      hand = this.rig.getObjectByName("hand_L");
    if (!upper || !forearm || !hand || !this.head) return;
    this.rig.updateWorldMatrix(true, true);
    const amount = THREE.MathUtils.clamp(
        Math.min(time / 0.22, (1.35 - time) / 0.25),
        0,
        1,
      ),
      weight = amount * amount * (3 - 2 * amount);
    for (const mesh of this.grips)
      mesh.morphTargetInfluences![mesh.morphTargetDictionary!.new0GripL] =
        weight;
    const front = this.v[5]
        .set(0, 0, 1)
        .transformDirection(this.rig.matrixWorld),
      up = this.v[3].set(0, 1, 0).transformDirection(this.rig.matrixWorld);
    const tilt = THREE.MathUtils.clamp((time - 0.25) / 0.4, 0, 1),
      axis = this.v[35]
        .copy(up)
        .multiplyScalar(1 - 1.3 * tilt)
        .addScaledVector(front, -0.95 * tilt)
        .normalize();
    const mouth = this.v[10]
      .copy(this.mouth)
      .applyMatrix4(this.head.matrixWorld);
    // The neck is held between the fingers. The opening is 24 mm beyond it.
    const support = this.v[38]
      .copy(mouth)
      .addScaledVector(axis, -0.024)
      .addScaledVector(front, 0.012);
    const start = hand.getWorldPosition(this.v[8]);
    support.lerp(start, 1 - weight);
    for (let step = 0; step < 3; step++) {
      this.reach(upper, forearm, hand, support, axis);
      this.wrist(hand, forearm, axis, this.q[16]);
      const offset = this.v[39].fromArray(HAND_GRIP.human);
      offset.x *= -1;
      offset.applyQuaternion(this.q[16]);
      const wrist = this.v[56].copy(support).sub(offset);
      this.reach(upper, forearm, hand, wrist, axis);
      this.wrist(hand, forearm, axis, this.q[16]);
      this.seatWrist(hand, forearm, this.q[16]);
    }
  }
}
