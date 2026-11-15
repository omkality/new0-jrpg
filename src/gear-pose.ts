import * as THREE from "three";
import { WEAPON_MOUNTS } from "./weapon-spec.ts";
import type { WeaponId } from "./world-layout.ts";
import { ATTACKS } from "./game.ts";

// A small arm/wrist constraint, applied after the skinned clip blend. The hand
// stays on the grip. No weapon is translated away from the fingers or shrunk.
export class GearPose {
  private v = Array.from({ length: 32 }, () => new THREE.Vector3());
  private q = Array.from({ length: 12 }, () => new THREE.Quaternion());
  private matrix = new THREE.Matrix4();
  private directions = Array.from({ length: 10 }, () => new THREE.Vector3());
  private points = new Map<WeaponId, THREE.Vector3[]>();
  private hand?: THREE.Object3D;
  private upper?: THREE.Object3D;
  private forearm?: THREE.Object3D;
  private pelvis?: THREE.Object3D;
  private chest?: THREE.Object3D;
  private head?: THREE.Object3D;
  private leftUpper?: THREE.Object3D;
  private rig: THREE.Object3D;
  constructor(rig: THREE.Object3D) {
    this.rig = rig;
    this.hand = rig.getObjectByName("hand_R");
    this.upper = rig.getObjectByName("upperarm_R");
    this.forearm = rig.getObjectByName("forearm_R");
    this.pelvis = rig.getObjectByName("pelvis");
    this.chest = rig.getObjectByName("chest");
    this.head = rig.getObjectByName("head");
    this.leftUpper = rig.getObjectByName("upperarm_L");
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
        .makeTranslation(0, 0.06, 0)
        .multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2))
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
  apply(
    id: WeaponId,
    clip: string,
    floor: number,
    exact?: (matrix: THREE.Matrix4) => number,
    time = 0,
  ) {
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
      .set(1, 0, 0)
      .transformDirection(this.chest.matrixWorld);
    const front = this.v[5]
      .set(0, 0, 1)
      .transformDirection(this.rig.matrixWorld);
    const raw = hand.getWorldPosition(this.v[8]),
      scale = hand.getWorldScale(this.v[9]);
    const s = Math.max(scale.x, scale.y, scale.z);
    const bodyScale = this.leftUpper
      ? Math.max(
          s,
          this.leftUpper
            .getWorldPosition(this.v[31])
            .distanceTo(upper.getWorldPosition(this.v[30])) / 0.5,
        )
      : s;
    const a = this.v[6].copy(pelvis).addScaledVector(up, -0.28 * bodyScale),
      b = this.v[7].copy(chest).addScaledVector(up, -0.04 * bodyScale);
    const radius = 0.315 * bodyScale;
    const carry = ["Idle", "Walk", "Run"].includes(clip);
    const attack = /^Attack([123])$/.exec(clip);
    const contact = attack ? ATTACKS[Number(attack[1]) - 1].contact : 0;
    const aim = attack ? Math.exp(-(((time - contact) / 0.13) ** 2)) : 0;
    const target = this.v[10].copy(raw);
    if (carry) {
      target
        .copy(pelvis)
        .addScaledVector(right, 0.43 * bodyScale)
        .addScaledVector(up, -0.02 * bodyScale)
        .addScaledVector(front, 0.16 * bodyScale);
    } else {
      const axis = this.v[11].copy(b).sub(a),
        t = THREE.MathUtils.clamp(
          this.v[12].copy(raw).sub(a).dot(axis) / axis.lengthSq(),
          0,
          1,
        );
      const nearest = this.v[12].copy(a).addScaledVector(axis, t),
        outward = this.v[13].copy(raw).sub(nearest);
      if (outward.length() < radius + 0.07 * s) {
        if (outward.length() < 0.01) outward.copy(right);
        target
          .copy(nearest)
          .addScaledVector(outward.normalize(), radius + 0.075 * s);
      }
    }
    target.y = Math.max(floor + 0.16 * s, target.y);
    target.addScaledVector(front, 0.06 * aim * s);
    const axis = this.v[11].copy(b).sub(a),
      t = THREE.MathUtils.clamp(
        this.v[12].copy(target).sub(a).dot(axis) / axis.lengthSq(),
        0,
        1,
      );
    const outward = this.v[31]
      .copy(target)
      .sub(this.v[12].copy(a).addScaledVector(axis, t))
      .normalize();
    this.q[0].copy(upper.quaternion);
    this.q[1].copy(forearm.quaternion);
    this.q[2].copy(hand.quaternion);
    let bestScore = Infinity;
    const bestTarget = this.v[14],
      bestQ = this.q[3];
    const points = this.points.get(id)!;
    for (let attempt = 0; attempt < 6; attempt++) {
      upper.quaternion.copy(this.q[0]);
      forearm.quaternion.copy(this.q[1]);
      hand.quaternion.copy(this.q[2]);
      upper.updateWorldMatrix(true, true);
      const goal = this.v[15].copy(target);
      if (attempt === 1 || attempt === 2)
        goal.addScaledVector(outward, attempt * 0.1 * s);
      if (attempt === 3) goal.addScaledVector(front, 0.2 * s);
      if (attempt === 4) goal.addScaledVector(right, 0.22 * s);
      if (attempt === 5)
        goal.addScaledVector(front, 0.32 * s).addScaledVector(right, 0.1 * s);
      if (attempt > 0) goal.y += 0.035 * s;
      this.reach(upper, forearm, hand, goal);
      const hp = hand.getWorldPosition(this.v[16]),
        native = hand.getWorldQuaternion(this.q[4]);
      this.directions[0].set(0, 0, -1).applyQuaternion(native);
      this.directions[1].copy(front);
      this.directions[2].copy(front).addScaledVector(right, 0.5).normalize();
      this.directions[3].copy(right);
      this.directions[4].copy(right).addScaledVector(front, 0.5).normalize();
      this.directions[5].set(0, 1, 0);
      this.directions[6].copy(front).addScaledVector(up, -0.35).normalize();
      this.directions[7].copy(up);
      this.directions[8]
        .copy(right)
        .add(this.v[17].set(0, 0.65, 0))
        .normalize();
      this.directions[9]
        .copy(front)
        .addScaledVector(up, id === "axe" ? -0.45 : id === "spear" ? 0 : -0.12)
        .normalize();
      for (let k = 0; k < this.directions.length; k++) {
        const orientation = this.q[5];
        if (k === 0 && !carry) orientation.copy(native);
        else {
          const z = this.v[11].copy(this.directions[k]).negate();
          const y = this.v[12]
            .copy(id === "axe" ? front : this.v[17].set(0, 1, 0))
            .addScaledVector(
              z,
              -this.v[13].copy(id === "axe" ? front : this.v[17]).dot(z),
            );
          if (y.lengthSq() < 1e-5)
            y.copy(right).addScaledVector(z, -right.dot(z));
          y.normalize();
          const x = this.v[13].crossVectors(y, z).normalize();
          orientation.setFromRotationMatrix(this.matrix.makeBasis(x, y, z));
        }
        let penalty = 0;
        for (const point of points) {
          const p = this.v[17]
            .copy(point)
            .multiply(scale)
            .applyQuaternion(orientation)
            .add(hp);
          const body = this.capsuleDistance(p, a, b) - radius,
            hood = p.distanceTo(head) - 0.28 * bodyScale;
          penalty +=
            Math.max(0, -body) * 300 +
            Math.max(0, -hood) * 300 +
            Math.max(0, floor + 0.012 - p.y) * 500;
        }
        let score =
          penalty +
          orientation.angleTo(native) * 0.15 +
          hp.distanceTo(raw) * 2 +
          (carry ? (k === 2 ? -0.4 : 0) : 0);
        score +=
          aim *
          (1 -
            this.v[11]
              .set(0, 0, -1)
              .applyQuaternion(orientation)
              .dot(this.directions[9])) *
          5;
        if (exact && score < bestScore)
          score += exact(this.matrix.compose(hp, orientation, scale));
        if (score < bestScore) {
          bestScore = score;
          bestTarget.copy(goal);
          bestQ.copy(orientation);
        }
      }
    }
    upper.quaternion.copy(this.q[0]);
    forearm.quaternion.copy(this.q[1]);
    hand.quaternion.copy(this.q[2]);
    upper.updateWorldMatrix(true, true);
    this.reach(upper, forearm, hand, bestTarget);
    hand.parent!.getWorldQuaternion(this.q[4]);
    hand.quaternion.copy(this.q[4].invert().multiply(bestQ));
    hand.updateWorldMatrix(false, true);
  }
  drink(time: number) {
    const upper = this.rig.getObjectByName("upperarm_L"),
      forearm = this.rig.getObjectByName("forearm_L"),
      hand = this.rig.getObjectByName("hand_L");
    if (!upper || !forearm || !hand) return;
    this.rig.updateWorldMatrix(true, true);
    const weight = Math.min(1, time / 0.22, (1.35 - time) / 0.25);
    const mouth = this.rig.localToWorld(this.v[10].set(-0.09, 1.32, 0.36));
    const start = hand.getWorldPosition(this.v[8]);
    mouth.lerp(start, 1 - Math.max(0, weight));
    this.reach(upper, forearm, hand, mouth);
    const q = this.q[3].setFromUnitVectors(
      this.v[11].set(0, 1, 0),
      this.v[12].set(0, 0.92, -0.4).transformDirection(this.rig.matrixWorld),
    );
    hand.parent!.getWorldQuaternion(this.q[4]);
    hand.quaternion.copy(this.q[4].invert().multiply(q));
    hand.updateWorldMatrix(false, true);
  }
}
