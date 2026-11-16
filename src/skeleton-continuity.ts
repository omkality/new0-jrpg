import * as THREE from "three";

// Bound the pose in actor space, including all spine ancestors. Bounding each
// local joint alone adds their angular velocities at the hands.
export class SkeletonContinuity {
  private bones: {
    bone: THREE.Bone;
    q: THREE.Quaternion;
    goal: THREE.Quaternion;
    p: THREE.Vector3;
    speed: number;
  }[] = [];
  private ready = false;
  private rig: THREE.Object3D;
  private frame = new THREE.Quaternion();
  private inverse = new THREE.Quaternion();
  private work = new THREE.Quaternion();
  private parent = new THREE.Quaternion();
  constructor(rig: THREE.Object3D, gaoler = false) {
    this.rig = rig;
    rig.traverse((b) => {
      if (
        b instanceof THREE.Bone &&
        !/^(upperarm|forearm|hand|finger)/.test(b.name)
      )
        this.bones.push({
          bone: b,
          q: new THREE.Quaternion(),
          goal: new THREE.Quaternion(),
          p: b.position.clone(),
          speed: /thigh|shin|calf|foot|toe/.test(b.name)
            ? gaoler
              ? 10
              : 14
            : gaoler
              ? 3.2
              : 6,
        });
    });
  }
  reset() {
    this.ready = false;
  }
  apply(dt: number) {
    this.rig.updateWorldMatrix(true, true);
    this.rig.getWorldQuaternion(this.frame);
    this.inverse.copy(this.frame).invert();
    for (const state of this.bones)
      state.bone.getWorldQuaternion(state.goal).premultiply(this.inverse);
    for (const state of this.bones) {
      const b = state.bone;
      if (this.ready) {
        this.work.copy(state.q).slerp(state.goal, 1 - Math.exp(-dt * 44));
        state.q.rotateTowards(this.work, dt * state.speed);
        b.parent!.getWorldQuaternion(this.parent).invert();
        b.quaternion.copy(this.parent).multiply(this.frame).multiply(state.q);
        if (b.name === "pelvis") {
          const distance = state.p.distanceTo(b.position);
          state.p.lerp(b.position, Math.min(1, (dt * 3) / (distance || 1)));
          b.position.copy(state.p);
        }
        b.updateWorldMatrix(false, true);
      } else {
        state.q.copy(state.goal);
        state.p.copy(b.position);
      }
    }
    this.ready = true;
  }
}
