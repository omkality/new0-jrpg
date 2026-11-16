import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { MixerPose } from "../src/mixer-pose.ts";

test("static mixer channels remain authored after repeated external IK writes", () => {
  const root = new T.Group(),
    chest = new T.Bone(),
    arm = new T.Bone();
  chest.name = "chest";
  arm.name = "hand_R";
  root.add(chest);
  chest.add(arm);
  arm.position.set(0.2, 0, 0);
  const mixer = new T.AnimationMixer(root),
    q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), 0.3);
  const clip = new T.AnimationClip("held", 1, [
    new T.QuaternionKeyframeTrack(
      "hand_R.quaternion",
      [0, 1],
      [...q.toArray(), ...q.toArray()],
    ),
  ]);
  const pose = new MixerPose(root),
    action = mixer.clipAction(clip).play();
  action.paused = true;
  action.time = 0.3;
  for (let i = 0; i < 180; i++) {
    pose.restore();
    mixer.update(1 / 60);
    pose.capture();
    assert(
      arm.quaternion.angleTo(q) < 1e-6,
      `authored wrist drifted at frame ${i}`,
    );
    arm.rotateX(0.6);
    chest.rotateY(0.4);
    arm.position.z += 0.1;
  }
  pose.restore();
  assert.equal(arm.position.z, 0);
  assert(chest.quaternion.angleTo(new T.Quaternion()) < 1e-6);
  mixer.stopAllAction();
  pose.reset();
  assert(arm.quaternion.angleTo(new T.Quaternion()) < 1e-6);
});
