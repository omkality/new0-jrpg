import * as THREE from "three";

// AnimationMixer skips writing unchanged property buffers. Restore its last
// authored result before evaluating another frame, so post-animation IK and
// continuity never become the input pose for a static animation channel.
export class MixerPose {
  private bones: {
    bone: THREE.Bone;
    p: THREE.Vector3;
    q: THREE.Quaternion;
    s: THREE.Vector3;
    bindP: THREE.Vector3;
    bindQ: THREE.Quaternion;
    bindS: THREE.Vector3;
  }[] = [];
  constructor(rig: THREE.Object3D) {
    rig.traverse((b) => {
      if (b instanceof THREE.Bone)
        this.bones.push({
          bone: b,
          p: b.position.clone(),
          q: b.quaternion.clone(),
          s: b.scale.clone(),
          bindP: b.position.clone(),
          bindQ: b.quaternion.clone(),
          bindS: b.scale.clone(),
        });
    });
  }
  restore() {
    for (const b of this.bones) {
      b.bone.position.copy(b.p);
      b.bone.quaternion.copy(b.q);
      b.bone.scale.copy(b.s);
    }
  }
  capture() {
    for (const b of this.bones) {
      b.p.copy(b.bone.position);
      b.q.copy(b.bone.quaternion);
      b.s.copy(b.bone.scale);
    }
  }
  reset() {
    for (const b of this.bones) {
      b.p.copy(b.bindP);
      b.q.copy(b.bindQ);
      b.s.copy(b.bindS);
    }
    this.restore();
  }
}
