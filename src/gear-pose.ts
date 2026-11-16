import * as THREE from "three";
import { HAND_GRIP } from "./weapon-spec.ts";
import type { WeaponId } from "./world-layout.ts";
import { ATTACKS } from "./game.ts";

type Arm = {
  upper: THREE.Object3D;
  fore: THREE.Object3D;
  hand: THREE.Object3D;
  axes: THREE.Quaternion[];
  previous: THREE.Quaternion[];
  angle: number;
  ready: boolean;
};
const smooth = (a: number, b: number, t: number) => {
  if (b <= a) return t >= b ? 1 : 0;
  const u = THREE.MathUtils.clamp((t - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
};

// Authored continuous goals and analytic two-bone arm solves. No mesh
// skinning, BVH rebuild, candidate search or frame-dependent pose selection.
export class GearPose {
  private v = Array.from({ length: 40 }, () => new THREE.Vector3());
  private q = Array.from({ length: 12 }, () => new THREE.Quaternion());
  private matrix = new THREE.Matrix4();
  private inverse = new THREE.Matrix4();
  private right?: Arm;
  private left?: Arm;
  private pelvis?: THREE.Object3D;
  private chest?: THREE.Object3D;
  private head?: THREE.Object3D;
  private mouth?: THREE.Object3D;
  private armour?: THREE.Object3D;
  private chestUp = new THREE.Vector3(0, 1, 0);
  private chestRight = new THREE.Vector3(-1, 0, 0);
  private chestFront = new THREE.Vector3(0, 0, 1);
  private grips: THREE.Mesh[] = [];
  private target = new THREE.Vector3();
  private shaft = new THREE.Vector3();
  private ready = false;
  private lastClip = "";
  private leftSupport = false;
  private gripR = 0;
  private gripL = 0;
  private rig: THREE.Object3D;
  private gaoler: boolean;
  private verify: boolean;
  diagnostics = { selectedPenalty: 0, finalPenalty: 0, candidates: 0 };
  constructor(rig: THREE.Object3D, gaoler = false, verify = false) {
    this.rig = rig;
    this.gaoler = gaoler;
    this.verify = verify;
    this.pelvis = rig.getObjectByName("pelvis");
    this.chest = rig.getObjectByName("chest");
    this.head = rig.getObjectByName("head");
    this.mouth = rig.getObjectByName("fixes1_mouth");
    this.armour = rig.getObjectByName("ArmourGuardianCuirass");
    if (this.chest) {
      rig.updateWorldMatrix(true, true);
      rig.getWorldQuaternion(this.q[0]);
      this.chest.getWorldQuaternion(this.q[1]).invert().multiply(this.q[0]);
      for (const axis of [this.chestUp, this.chestRight, this.chestFront])
        axis.applyQuaternion(this.q[1]);
    }
    this.right = this.arm("R");
    this.left = this.arm("L");
    rig.traverse((o) => {
      if (
        o instanceof THREE.Mesh &&
        o.morphTargetDictionary?.new0GripR !== undefined
      )
        this.grips.push(o);
    });
  }
  private arm(side: string): Arm | undefined {
    const upper = this.rig.getObjectByName(`upperarm_${side}`),
      fore = this.rig.getObjectByName(`forearm_${side}`),
      hand = this.rig.getObjectByName(`hand_${side}`);
    if (!upper || !fore || !hand) return;
    const axes = [fore.position, hand.position, new THREE.Vector3(0, 1, 0)].map(
      (direction) => {
        const y = direction.clone().normalize(),
          z = new THREE.Vector3(0, 0, 1);
        z.addScaledVector(y, -z.dot(y));
        if (z.lengthSq() < 1e-6) z.set(1, 0, 0).addScaledVector(y, -y.x);
        z.normalize();
        return new THREE.Quaternion()
          .setFromRotationMatrix(
            new THREE.Matrix4().makeBasis(
              new THREE.Vector3().crossVectors(y, z),
              y,
              z,
            ),
          )
          .invert();
      },
    );
    return {
      upper,
      fore,
      hand,
      axes,
      previous: [upper, fore, hand].map((b) => b.quaternion.clone()),
      angle: 0,
      ready: false,
    };
  }
  reset() {
    this.ready = false;
    this.lastClip = "";
    if (this.right) this.right.ready = false;
    if (this.left) this.left.ready = false;
  }
  setGrip(right: number, left: number) {
    this.gripR = right;
    this.gripL = left;
    for (const m of this.grips) {
      m.morphTargetInfluences![m.morphTargetDictionary!.new0GripR] = right;
      m.morphTargetInfluences![m.morphTargetDictionary!.new0GripL] = left;
    }
  }
  private orient(
    bone: THREE.Object3D,
    axis: THREE.Quaternion,
    direction: THREE.Vector3,
    normal: THREE.Vector3,
    previous?: THREE.Quaternion,
    dt = 1 / 60,
  ) {
    const y = this.v[21].copy(direction).normalize(),
      z = this.v[22].copy(normal);
    z.addScaledVector(y, -z.dot(y));
    if (z.lengthSq() < 1e-7) z.set(0, 1, 0).addScaledVector(y, -y.y);
    if (z.lengthSq() < 1e-7) z.set(1, 0, 0).addScaledVector(y, -y.x);
    z.normalize();
    if (previous) {
      bone.parent!.getWorldQuaternion(this.q[10]);
      this.q[10].multiply(previous);
      this.q[11].copy(axis).invert().premultiply(this.q[10]);
      const prior = this.v[20].set(0, 0, 1).applyQuaternion(this.q[11]);
      prior.addScaledVector(y, -prior.dot(y));
      if (prior.lengthSq() > 1e-6) {
        prior.normalize();
        const angle = Math.atan2(
          this.v[23].crossVectors(prior, z).dot(y),
          prior.dot(z),
        );
        z.copy(prior).applyAxisAngle(
          y,
          THREE.MathUtils.clamp(angle, -dt * 10, dt * 10),
        );
      }
    }
    const x = this.v[23].crossVectors(y, z).normalize();
    this.q[2]
      .setFromRotationMatrix(this.matrix.makeBasis(x, y, z))
      .multiply(axis);
    bone.parent!.getWorldQuaternion(this.q[3]);
    bone.quaternion.copy(this.q[3].invert().multiply(this.q[2]));
    bone.updateWorldMatrix(false, true);
  }
  private solve(
    arm: Arm,
    requested: THREE.Vector3,
    shaft: THREE.Vector3,
    pole: THREE.Vector3,
    dt: number,
    commit = true,
  ) {
    const a = arm.upper.getWorldPosition(this.v[10]),
      b = arm.fore.getWorldPosition(this.v[11]),
      c = arm.hand.getWorldPosition(this.v[12]);
    const l1 = a.distanceTo(b),
      l2 = b.distanceTo(c);
    const axis = this.v[13].copy(requested).sub(a),
      d = THREE.MathUtils.clamp(
        axis.length(),
        Math.abs(l1 - l2) + 0.005,
        (l1 + l2) * 0.985,
      );
    axis.normalize();
    const goal = this.v[14].copy(a).addScaledVector(axis, d);
    const u = this.v[15].copy(pole).addScaledVector(axis, -pole.dot(axis));
    if (u.lengthSq() < 1e-6) u.set(0, 0, 1).addScaledVector(axis, -axis.z);
    u.normalize();
    const v = this.v[16].crossVectors(axis, u).normalize();
    const along = (l1 * l1 + d * d - l2 * l2) / (2 * d),
      height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    const centre = this.v[17].copy(a).addScaledVector(axis, along);
    // Anatomical elbow pole. Wrist alignment must never choose the opposite
    // side of the arm plane or pull the sleeve through the cuirass.
    const angle = 0;
    const elbow = this.v[19]
      .copy(centre)
      .addScaledVector(u, height * Math.cos(angle))
      .addScaledVector(v, height * Math.sin(angle));
    const upperDirection = this.v[24].copy(elbow).sub(a),
      foreDirection = this.v[25].copy(goal).sub(elbow);
    // A weapon shaft determines the palm orientation, not the twist of the
    // upper arm and sleeve. Aiming every arm bone with the shaft as its normal
    // rolled the elbow surface inward even when the joint centres were clear.
    // Transport the previous bend frame before aiming. The source forearm's
    // independent roll can switch its IK branch during a two-hand transition.
    // Carrying the frame keeps both palms on one shaft without a snap.
    if (arm.ready && this.leftSupport) {
      arm.upper.quaternion.copy(arm.previous[0]);
      arm.fore.quaternion.copy(arm.previous[1]);
      arm.upper.updateWorldMatrix(false, true);
    }
    this.aim(arm.upper, arm.fore, upperDirection);
    this.aim(arm.fore, arm.hand, foreDirection);
    // Limit wrist extension. The shaft may bank a little instead of bending
    // the wrist backwards to force a mathematically exact world orientation.
    const distal = this.v[27].copy(foreDirection).normalize();
    const handZ = this.v[28].copy(shaft).negate().normalize();
    const dot = distal.dot(handZ),
      maximum = Math.sin(THREE.MathUtils.degToRad(32));
    if (Math.abs(dot) > maximum) {
      handZ
        .addScaledVector(distal, -dot)
        .normalize()
        .multiplyScalar(Math.sqrt(1 - maximum * maximum))
        .addScaledVector(distal, Math.sign(dot) * maximum)
        .normalize();
    }
    const handY = this.v[29]
      .copy(distal)
      .addScaledVector(handZ, -distal.dot(handZ))
      .normalize();
    this.orient(arm.hand, arm.axes[2], handY, handZ);
    const bones = [arm.upper, arm.fore, arm.hand];
    for (let i = 0; i < 3; i++) {
      const supporting = arm === this.left && this.leftSupport;
      // The support goal follows the filtered rear grip. Preserve a bounded
      // return from actions such as drinking before committing the closed chain.
      if (arm.ready && (commit || (supporting && i === 2))) {
        this.q[4]
          .copy(arm.previous[i])
          .rotateTowards(
            bones[i].quaternion,
            Math.max(0, dt) *
              (arm === this.left && this.leftSupport
                ? 18.5
                : this.gaoler
                  ? 4
                  : this.lastClip.startsWith("SpearAttack")
                    ? 17.5
                    : this.lastClip.startsWith("FistAttack")
                      ? 18
                      : this.lastClip.startsWith("Attack")
                        ? 10
                        : 6),
          );
        bones[i].quaternion.copy(this.q[4]);
      }
      if (commit) arm.previous[i].copy(bones[i].quaternion);
      bones[i].updateWorldMatrix(false, true);
    }
    {
      // Project the final temporally blended wrist onto its anatomical cone.
      // The forearm may have moved since the desired hand frame was solved.
      const distalNow = this.v[24]
        .copy(arm.hand.getWorldPosition(this.v[25]))
        .sub(arm.fore.getWorldPosition(this.v[26]))
        .normalize();
      const palmNow = this.v[27]
        .set(0, 1, 0)
        .transformDirection(arm.hand.matrixWorld);
      const bend = palmNow.angleTo(distalNow),
        limit = THREE.MathUtils.degToRad(32);
      if (bend > limit) {
        this.q[5].setFromUnitVectors(palmNow, distalNow);
        this.q[6].identity().slerp(this.q[5], (bend - limit) / bend);
        arm.hand.getWorldQuaternion(this.q[7]).premultiply(this.q[6]);
        arm.hand.parent!.getWorldQuaternion(this.q[8]).invert();
        arm.hand.quaternion.copy(this.q[8]).multiply(this.q[7]);
        if (commit) arm.previous[2].copy(arm.hand.quaternion);
        arm.hand.updateWorldMatrix(false, true);
      }
      if (commit) arm.ready = true;
    }
  }
  private aim(
    bone: THREE.Object3D,
    child: THREE.Object3D,
    direction: THREE.Vector3,
  ) {
    const from = this.v[21]
        .copy(child.position)
        .transformDirection(bone.matrixWorld),
      to = this.v[22].copy(direction).normalize();
    bone.getWorldQuaternion(this.q[2]);
    this.q[3].setFromUnitVectors(from, to).multiply(this.q[2]);
    bone.parent!.getWorldQuaternion(this.q[4]).invert();
    bone.quaternion.copy(this.q[4]).multiply(this.q[3]);
    bone.updateWorldMatrix(false, true);
  }
  private native(arm: Arm, dt: number, rate = 6) {
    if (
      this.armour?.visible &&
      this.chest &&
      this.pelvis &&
      arm === this.left &&
      /^FistAttack[23]$/.test(this.lastClip) &&
      this.right
    ) {
      const up = this.v[31]
          .copy(this.chest.getWorldPosition(this.v[32]))
          .sub(this.pelvis.getWorldPosition(this.v[33]))
          .normalize(),
        shoulder = arm.upper.getWorldPosition(this.v[32]),
        other = this.right.upper.getWorldPosition(this.v[33]),
        elbow = arm.fore.getWorldPosition(this.v[34]),
        out = this.v[35].copy(shoulder).sub(other);
      out.addScaledVector(up, -out.dot(up)).normalize();
      const front = this.v[36].crossVectors(out, up).normalize(),
        target = arm.hand.getWorldPosition(this.v[37]),
        amount = 1 - smooth(0.18, 0.34, target.distanceTo(shoulder)),
        shaft = this.v[38]
          .set(0, 0, -1)
          .transformDirection(arm.hand.matrixWorld),
        pole = this.v[39].copy(elbow).sub(shoulder).normalize();
      if (amount > 1e-4) {
        target
          .addScaledVector(front, 0.16 * amount)
          .addScaledVector(out, 0.04 * amount);
        pole
          .lerp(
            this.v[34]
              .copy(out)
              .multiplyScalar(0.5)
              .addScaledVector(up, -0.9)
              .addScaledVector(front, 0.2)
              .normalize(),
            amount,
          )
          .normalize();
        this.solve(arm, target, shaft, pole, dt);
        return;
      }
    }

    if (this.armour?.visible && this.chest && this.pelvis) {
      const up = this.v[31]
          .copy(this.chest.getWorldPosition(this.v[32]))
          .sub(this.pelvis.getWorldPosition(this.v[33]))
          .normalize(),
        shoulder = arm.upper.getWorldPosition(this.v[34]),
        direction = this.v[35]
          .copy(arm.fore.getWorldPosition(this.v[36]))
          .sub(shoulder)
          .normalize(),
        other = arm === this.left ? this.right : this.left;
      if (other && direction.dot(up) < -0.5) {
        const out = this.v[37]
          .copy(shoulder)
          .sub(other.upper.getWorldPosition(this.v[38]));
        out.addScaledVector(up, -out.dot(up)).normalize();
        // A fitted metal side requires a few degrees of free-arm clearance,
        // while preserving the authored swing and elbow flexion.
        direction.addScaledVector(out, 0.2).normalize();
        const handHeight = arm.hand.getWorldPosition(this.v[39]).y;
        const chestHeight = this.chest.getWorldPosition(this.v[32]).y;
        const front = this.v[39]
          .crossVectors(up, out)
          .multiplyScalar(arm === this.left ? -1 : 1)
          .normalize();
        direction
          .addScaledVector(
            front,
            0.06 +
              0.12 * smooth(chestHeight - 0.35, chestHeight - 0.22, handHeight),
          )
          .normalize();
        this.aim(arm.upper, arm.fore, direction);
      }
    }
    const bones = [arm.upper, arm.fore, arm.hand];
    for (let i = 0; i < 3; i++) {
      if (arm.ready) {
        this.q[4]
          .copy(arm.previous[i])
          .rotateTowards(bones[i].quaternion, dt * (this.gaoler ? 4 : rate));
        bones[i].quaternion.copy(this.q[4]);
      }
      arm.previous[i].copy(bones[i].quaternion);
    }
    arm.ready = true;
  }
  apply(
    id: WeaponId,
    clip: string,
    floor: number,
    exact?: (matrix: THREE.Matrix4, correction?: THREE.Vector3) => number,
    time = 0,
    dt = 1 / 60,
  ) {
    if (!this.right || !this.left || !this.pelvis || !this.chest || !this.head)
      return;
    this.lastClip = clip;
    const r = this.right,
      l = this.left;
    const attack = /^(?:Sword|Spear|Fist)?Attack([123])$/.exec(clip),
      guard = /^(Guard|Block)/.test(clip),
      step = /Step|Evade/.test(clip),
      roll = /^Dodge/.test(clip),
      dead = /^Death/.test(clip);
    const two =
      (id === "spear" && !dead && clip !== "Drink") ||
      (id === "axe" && !this.gaoler && !dead && clip !== "Drink");
    this.leftSupport = two;
    const gain = 1 - Math.exp(-Math.max(0, dt) * 22);
    this.setGrip(
      THREE.MathUtils.lerp(
        this.gripR,
        id === "unarmed" ? (attack || guard ? 1 : 0.3) : 1,
        gain,
      ),
      THREE.MathUtils.lerp(
        this.gripL,
        two || clip === "Drink" || (id === "unarmed" && (attack || guard))
          ? 1
          : 0.3,
        gain,
      ),
    );
    // Preserve authored arm swing and punch mechanics. Holding empty hands at
    // an artificial lateral target produced the old permanent chicken-wing pose.
    if (id === "unarmed" && clip !== "Drink") {
      this.native(r, dt, attack ? 18 : 8);
      this.native(l, dt, attack ? 18 : 8);
      this.rig.updateWorldMatrix(true, true);
      this.ready = false;
      return;
    }
    this.rig.updateWorldMatrix(true, true);
    const pelvis = this.pelvis.getWorldPosition(this.v[0]),
      chest = this.chest.getWorldPosition(this.v[1]);
    const up = this.v[2].copy(chest).sub(pelvis).normalize();
    const right = this.v[3]
      .copy(r.upper.getWorldPosition(this.v[4]))
      .sub(l.upper.getWorldPosition(this.v[5]))
      .normalize();
    const shoulders = this.v[37]
      .copy(this.v[4])
      .add(this.v[5])
      .multiplyScalar(0.5);
    right.addScaledVector(up, -right.dot(up)).normalize();
    const front = this.v[6].crossVectors(up, right).normalize();
    const scale = chest.distanceTo(pelvis) / 0.37;
    const target = this.v[7]
      .copy(pelvis)
      .addScaledVector(
        right,
        (id === "spear" ? 0.12 : id === "axe" ? 0.33 : 0.3) * scale,
      )
      .addScaledVector(up, (guard ? 0.27 : 0.19) * scale)
      .addScaledVector(front, (guard ? 0.38 : 0.28) * scale);
    const shaft = this.v[8]
      .copy(up)
      .multiplyScalar(0.9)
      .addScaledVector(front, 0.3)
      .addScaledVector(right, 0.25)
      .normalize();
    if (id === "unarmed") {
      target
        .copy(pelvis)
        .addScaledVector(right, 0.38 * scale)
        .addScaledVector(up, 0.035 * scale)
        .addScaledVector(front, 0.14 * scale);
      shaft.copy(front);
    }
    if (id === "axe") {
      shaft
        .copy(up)
        .multiplyScalar(0.72)
        .addScaledVector(front, 0.45)
        .addScaledVector(right, -0.45)
        .normalize();
      if (!this.gaoler)
        target
          .copy(shoulders)
          .addScaledVector(right, 0.24 * scale)
          .addScaledVector(up, -0.2 * scale)
          .addScaledVector(front, 0.38 * scale);
    }
    if (id === "spear") {
      target
        .copy(shoulders)
        .addScaledVector(up, -0.2 * scale)
        .addScaledVector(right, 0.24 * scale)
        .addScaledVector(front, 0.32 * scale);
      shaft
        .copy(up)
        .multiplyScalar(0.72)
        .addScaledVector(front, 0.28)
        .addScaledVector(right, -0.52)
        .normalize();
    }
    // Keep a two-hand axe grip above the lower ribs even while the torso
    // pitches during an evade. A chest-relative forward offset alone can
    // otherwise put the support goal beyond the left arm's reach.
    if (id === "axe" && !this.gaoler)
      target.y = Math.max(target.y, shoulders.y - 0.15 * scale);
    const carryTarget = this.v[38].copy(target),
      carryShaft = this.v[39].copy(shaft);
    if (attack) {
      const a = ATTACKS[Number(attack[1]) - 1],
        wind = smooth(0, a.contact * 0.6, time),
        recover = smooth(
          a.link === a.duration ? a.contact + 0.14 : a.link,
          a.duration,
          time,
        ),
        active = wind * (1 - recover);
      if (id === "unarmed") {
        const punch =
          smooth(a.contact - 0.18, a.contact, time) *
          (1 - smooth(a.contact + 0.04, a.duration, time));
        target
          .copy(chest)
          .addScaledVector(right, 0.28 * scale)
          .addScaledVector(up, -0.12 * scale)
          .addScaledVector(front, (0.3 + 0.2 * punch) * scale);
        shaft.copy(front);
      } else if (id === "spear") {
        // Full-body dedicated stab supplies the actual reach, hip turn and
        // recovery. Keep the point on the attack line while the torso rotates.
        target.copy(r.hand.getWorldPosition(this.v[9]));
        const rigRight = this.v[35]
            .set(-1, 0, 0)
            .transformDirection(this.rig.matrixWorld),
          rigFront = this.v[36]
            .set(0, 0, 1)
            .transformDirection(this.rig.matrixWorld),
          lateral = this.v[34].copy(target).sub(pelvis).dot(rigRight),
          prepare = attack[1] === "1" ? wind : 1;
        // Keep the rear grip near the centreline. The cartoon source has a
        // much wider rear hand, beyond a human support arm's physical reach.
        target
          .addScaledVector(rigRight, 0.2 * scale - lateral)
          .addScaledVector(rigFront, -0.04 * scale);
        target.y = chest.y + 0.12 * scale;
        target.lerp(carryTarget, 1 - prepare);
        shaft
          .set(0.2, 0.02, 1)
          .transformDirection(this.rig.matrixWorld)
          .lerp(carryShaft, 1 - prepare)
          .normalize();
        target.lerp(carryTarget, recover);
        shaft.lerp(carryShaft, recover).normalize();
      } else if (id === "axe") {
        const cut = smooth(a.contact - 0.22, a.contact + 0.04, time),
          chop = attack[1] === "2" ? 1 - cut : cut,
          angle = 0.16 + chop * 2.12;
        target
          .copy(this.gaoler ? chest : shoulders)
          .addScaledVector(right, (this.gaoler ? 0.36 : 0.13) * scale)
          .addScaledVector(
            up,
            (this.gaoler ? 0.16 - 0.2 * chop : -0.08 - 0.14 * chop) * scale,
          )
          .addScaledVector(front, (0.38 + 0.035 * chop) * scale);
        shaft
          .copy(up)
          .multiplyScalar(Math.cos(angle))
          .addScaledVector(front, Math.sin(angle))
          .addScaledVector(right, -0.18)
          .normalize();
        if (attack[1] === "1") {
          target.lerp(carryTarget, 1 - wind);
          shaft.lerp(carryShaft, 1 - wind).normalize();
        }
      } else {
        const sweep = smooth(a.contact - 0.18, a.contact + 0.1, time),
          sign = attack[1] === "2" ? -1 : 1;
        target
          .copy(chest)
          .addScaledVector(right, (0.3 - 0.1 * sweep * sign) * scale)
          .addScaledVector(up, (0.15 - 0.24 * sweep) * scale)
          .addScaledVector(
            front,
            (0.46 + 0.04 * Math.sin(sweep * Math.PI)) * scale,
          );
        shaft
          .copy(up)
          .multiplyScalar(0.95 - 0.9 * sweep)
          .addScaledVector(front, 0.25 + 0.45 * sweep)
          .addScaledVector(right, sign * (0.4 - 0.8 * sweep))
          .normalize();
      }
      if (id !== "spear") {
        target.lerp(carryTarget, recover);
        shaft.lerp(carryShaft, recover).normalize();
      }
    }
    if (roll) {
      const amount = smooth(0, 0.16, time) * (1 - smooth(0.6, 0.82, time));
      const out = this.v[9]
        .set(-1, 0, 0)
        .transformDirection(this.rig.matrixWorld);
      target.lerp(
        this.v[30]
          .copy(chest)
          .addScaledVector(out, 0.4 * scale)
          .addScaledVector(front, 0.22 * scale),
        amount,
      );
      shaft.lerp(front, amount).normalize();
    }
    if (step)
      target.addScaledVector(
        up,
        -0.035 * scale * Math.sin(Math.min(1, time / 0.82) * Math.PI),
      );
    if (id === "spear" && attack) {
      // A human rear grip stays in front of the torso during preparation.
      // The stylised source's long shoulder turn otherwise pulls its wrist
      // through the chest before the real forward stab begins.
      const facing = this.v[35]
        .set(0, 0, 1)
        .transformDirection(this.rig.matrixWorld);
      const depth = this.v[36].copy(target).sub(pelvis).dot(facing);
      if (depth < 0.3 * scale)
        target.addScaledVector(facing, 0.3 * scale - depth);
    }
    if (id === "axe" && !this.gaoler)
      target.y = Math.max(target.y, shoulders.y - 0.15 * scale);
    target.y = Math.max(floor + 0.28 * scale, target.y);
    const reach = id === "spear" ? 1.65 : id === "axe" ? 0.96 : 0.94;
    const lower = -(target.y - floor - 0.06) / reach;
    if (shaft.y < lower) {
      const y = THREE.MathUtils.clamp(lower, -0.9, 0.9),
        horizontal = Math.hypot(shaft.x, shaft.z);
      if (horizontal < 1e-5) shaft.copy(front);
      else {
        shaft.x /= horizontal;
        shaft.z /= horizontal;
      }
      shaft.x *= Math.sqrt(1 - y * y);
      shaft.z *= Math.sqrt(1 - y * y);
      shaft.y = y;
    }
    // Filter the authored goals in rig space, so movement of the whole actor
    // never drags a hand behind the body. This also blends weapon changes.
    this.inverse.copy(this.rig.matrixWorld).invert();
    target.applyMatrix4(this.inverse);
    shaft.transformDirection(this.inverse);
    if (!this.ready) {
      this.target.copy(target);
      this.shaft.copy(shaft);
      this.ready = true;
    } else {
      this.target.lerp(target, 1 - Math.exp(-dt * 30));
      this.shaft.lerp(shaft, 1 - Math.exp(-dt * 26)).normalize();
    }
    target.copy(this.target).applyMatrix4(this.rig.matrixWorld);
    shaft.copy(this.shaft).transformDirection(this.rig.matrixWorld);
    const pole = this.v[31]
      .copy(right)
      .multiplyScalar(0.5)
      .addScaledVector(up, -1)
      .addScaledVector(front, -0.22)
      .normalize();
    if (id === "spear" && attack)
      pole
        .copy(right)
        .multiplyScalar(0.6)
        .addScaledVector(up, -0.8)
        .addScaledVector(front, 0.1)
        .normalize();
    if (id === "axe" && attack && !this.gaoler)
      pole
        .copy(right)
        .multiplyScalar(0.65)
        .addScaledVector(up, -0.8)
        .addScaledVector(front, 0.05)
        .normalize();
    this.solve(r, target, shaft, pole, dt);
    if (two) {
      const grip = this.v[32]
        .fromArray(HAND_GRIP[this.gaoler ? "gaoler" : "human"])
        .applyMatrix4(r.hand.matrixWorld);
      const actualShaft = this.v[33]
        .set(0, 0, -1)
        .transformDirection(r.hand.matrixWorld);
      const carrySpacing = id === "spear" ? 0.25 : 0.18;
      const attackSpacing = id === "spear" ? 0.2 : 0.1;
      let spacing = carrySpacing;
      if (attack) {
        const a = ATTACKS[Number(attack[1]) - 1];
        const prepare =
          attack[1] === "1" ? smooth(0, a.contact * 0.6, time) : 1;
        const recovery = smooth(
          a.link === a.duration ? a.contact + 0.14 : a.link,
          a.duration,
          time,
        );
        spacing = THREE.MathUtils.lerp(
          carrySpacing,
          attackSpacing,
          prepare * (1 - recovery),
        );
      }
      const shoulder = l.upper.getWorldPosition(this.v[38]);
      const toShoulder = this.v[39].copy(shoulder).sub(grip),
        along = toShoulder.dot(actualShaft);
      const armReach = l.fore.position.length() + l.hand.position.length();
      const reach = armReach * 0.94 + 0.04,
        radial = toShoulder.lengthSq() - along * along;
      if (radial < reach * reach) {
        const range = Math.sqrt(reach * reach - radial),
          maximum = along + range;
        spacing = THREE.MathUtils.clamp(
          spacing,
          0.09,
          Math.max(0.09, Math.min(0.38, maximum)),
        );
      }
      const support = this.v[34]
        .copy(grip)
        .addScaledVector(actualShaft, spacing * scale);
      const handOffset = this.v[35].fromArray(
        HAND_GRIP[this.gaoler ? "gaoler" : "human"],
      );
      handOffset.x *= -1;
      // Relax the palm-offset fixed point. Full error steps can alternate
      // between two wrist-cone branches and leave the palm off the shaft.
      const goal = this.v[36].copy(support);
      pole
        .copy(right)
        .multiplyScalar(id === "axe" ? -1 : -0.9)
        .addScaledVector(up, id === "axe" ? -0.5 : -0.4)
        .addScaledVector(front, id === "axe" ? 0.55 : 0.7)
        .normalize();
      for (let i = 0; i < 12; i++) {
        this.solve(l, goal, actualShaft, pole, dt, false);
        const at = this.v[30].copy(handOffset).applyMatrix4(l.hand.matrixWorld);
        const error = this.v[9].copy(support).sub(at);
        if (error.lengthSq() < 1e-6) break;
        goal.addScaledVector(error, 0.4);
      }
      this.solve(l, goal, actualShaft, pole, dt);
    } else if (clip !== "Drink") this.native(l, dt);
    this.rig.updateWorldMatrix(true, true);
    this.diagnostics.candidates = 1;
    if (this.verify && exact) {
      r.hand.getWorldPosition(this.v[10]);
      r.hand.getWorldQuaternion(this.q[0]);
      r.hand.getWorldScale(this.v[11]);
      this.diagnostics.finalPenalty = this.diagnostics.selectedPenalty = exact(
        this.matrix.compose(this.v[10], this.q[0], this.v[11]),
      );
    }
  }
  release(dt = 1 / 60, floor = 0, side = this.lastClip === "DeathSide") {
    if (!this.right || !this.left || !this.chest || !this.pelvis) return;
    this.leftSupport = false;
    this.rig.updateWorldMatrix(true, true);
    const chest = this.chest.getWorldPosition(this.v[0]),
      pelvis = this.pelvis.getWorldPosition(this.v[1]);
    const up = this.v[2]
      .copy(this.chestUp)
      .transformDirection(this.chest.matrixWorld);
    const right = this.v[3]
      .copy(this.chestRight)
      .transformDirection(this.chest.matrixWorld);
    const front = this.v[6]
        .copy(this.chestFront)
        .transformDirection(this.chest.matrixWorld),
      scale = chest.distanceTo(pelvis) / 0.37;
    const targets = [
      this.right.hand.getWorldPosition(this.v[7]),
      this.left.hand.getWorldPosition(this.v[8]),
    ];
    for (let i = 0; i < 2; i++) {
      const arm = i === 0 ? this.right : this.left,
        sign = i === 0 ? 1 : -1,
        target = targets[i],
        relative = this.v[9].copy(target).sub(chest);
      const lateral = relative.dot(right),
        depth = relative.dot(front);
      const sideFall = side;
      let depthSide = 1;
      if (sideFall) {
        const shoulder = arm.upper.getWorldPosition(this.v[39]);
        depthSide = i === 1 ? 1 : -1;
        target
          .copy(shoulder)
          .addScaledVector(up, -0.22 * scale)
          .addScaledVector(front, depthSide * 0.34 * scale)
          .addScaledVector(right, (i === 1 ? 0.25 : 0.06) * scale);
        target.y = Math.max(floor + 0.035 * scale, target.y);
      } else if (depth < 0.4 * scale && lateral * sign < 0.5 * scale)
        target.addScaledVector(right, sign * 0.5 * scale - lateral);
      target.y = Math.max(floor + 0.035 * scale, target.y);
      const pole = this.v[31]
        .copy(right)
        .multiplyScalar(sign * 0.95)
        .addScaledVector(up, -0.5)
        .addScaledVector(front, 0.9)
        .normalize();
      if (sideFall)
        pole
          .copy(front)
          .multiplyScalar(depthSide * 1.3)
          .addScaledVector(up, -0.1)
          .add(this.v[38].set(0, -0.25, 0))
          .normalize();
      this.solve(arm, target, front, pole, this.gaoler ? dt * 0.8 : dt);
    }
    this.setGrip(
      this.gripR * Math.exp(-dt * 22),
      this.gripL * Math.exp(-dt * 22),
    );
    this.rig.updateWorldMatrix(true, true);
  }
  drink(time: number, dt = 1 / 60) {
    if (!this.left || !this.right || !this.head || !this.pelvis || !this.chest)
      return;
    this.leftSupport = false;
    this.rig.updateWorldMatrix(true, true);
    const mouth = this.mouth
      ? this.mouth.getWorldPosition(this.v[0])
      : this.head.localToWorld(this.v[0].set(0, 0.02, 0.16));
    const pelvis = this.pelvis.getWorldPosition(this.v[1]),
      chest = this.chest.getWorldPosition(this.v[2]);
    const up = this.v[3].copy(chest).sub(pelvis).normalize(),
      right = this.v[4]
        .copy(this.right.upper.getWorldPosition(this.v[5]))
        .sub(this.left.upper.getWorldPosition(this.v[6]))
        .normalize();
    right.addScaledVector(up, -right.dot(up)).normalize();
    const front = this.v[7].crossVectors(up, right).normalize(),
      scale = chest.distanceTo(pelvis) / 0.37;
    const lift = smooth(0, 0.5, time) * (1 - smooth(1.03, 1.3, time)),
      tilt = smooth(0.5, 0.82, time);
    const axis = this.v[8]
      .copy(up)
      .multiplyScalar(1 - 1.3 * tilt)
      .addScaledVector(front, -0.95 * tilt)
      .normalize();
    axis.lerp(front, 1 - lift).normalize();
    const start = this.v[30]
      .copy(pelvis)
      .addScaledVector(right, -0.4 * scale)
      .addScaledVector(up, 0.1 * scale)
      .addScaledVector(front, 0.18 * scale);
    const control = this.v[32]
      .copy(chest)
      .addScaledVector(right, -0.3 * scale)
      .addScaledVector(up, 0.05 * scale)
      .addScaledVector(front, 0.4 * scale);
    const endpoint = this.v[33].copy(mouth).addScaledVector(front, 0.006);
    const neck = this.v[34]
      .copy(start)
      .multiplyScalar((1 - lift) * (1 - lift))
      .addScaledVector(control, 2 * (1 - lift) * lift)
      .addScaledVector(endpoint, lift * lift);
    const goal = this.v[36].copy(neck),
      offset = this.v[35].set(-0.024, 0.078, -0.024);
    const pole = this.v[31]
      .copy(right)
      .multiplyScalar(-0.9)
      .addScaledVector(up, -0.5)
      .addScaledVector(front, 0.8)
      .normalize();
    for (let i = 0; i < 3; i++) {
      this.solve(this.left, goal, axis, pole, dt, false);
      const at = this.v[37]
        .copy(offset)
        .applyMatrix4(this.left.hand.matrixWorld);
      goal.add(this.v[38].copy(neck).sub(at));
    }
    this.solve(this.left, goal, axis, pole, dt);
  }
}
