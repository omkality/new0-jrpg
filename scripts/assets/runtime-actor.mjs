import * as T from "../../node_modules/three/build/three.module.js";
import { NodeIO } from "../../scripts/assets/node_modules/@gltf-transform/core/dist/index.js";
import { ALL_EXTENSIONS } from "../../scripts/assets/node_modules/@gltf-transform/extensions/dist/index.js";
import { threeRig } from "../../scripts/assets/three-rig.mjs";
import { Actor } from "../../src/actor.ts";
import { GearPose } from "../../src/gear-pose.ts";
import { FootContact } from "../../src/foot-contact.ts";
import { SkeletonContinuity } from "../../src/skeleton-continuity.ts";
import { MixerPose } from "../../src/mixer-pose.ts";
import { ActionBlend } from "../../src/action-blend.ts";
import { applyCharacterAppearance } from "../../src/character-appearance.ts";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
export async function runtimeActor() {
  const docs = await Promise.all(
    [
      "public/assets/cast/prisoner.glb",
      ...["combat", "fixes1", "fixes2"].map(
        (n) => `public/assets/motion/prisoner-${n}.glb`,
      ),
    ].map((p) => io.read(p)),
  );
  const rig = threeRig(docs[0]).root;
  applyCharacterAppearance(rig, "pilgrim");
  const mixer = new T.AnimationMixer(rig),
    actions = new Map();
  for (const doc of docs)
    for (const a of doc.getRoot().listAnimations()) {
      const tracks = a.listChannels().map((c) => {
        const s = c.getSampler(),
          type = c.getTargetPath(),
          name =
            c.getTargetNode().getName() +
            "." +
            { rotation: "quaternion", translation: "position", scale: "scale" }[
              type
            ];
        return new (
          type === "rotation"
            ? T.QuaternionKeyframeTrack
            : T.VectorKeyframeTrack
        )(name, s.getInput().getArray(), s.getOutput().getArray());
      });
      const clip = new T.AnimationClip(a.getName(), -1, tracks);
      actions.set(clip.name, mixer.clipAction(clip));
    }
  const actor = new Actor(),
    hand = rig.getObjectByName("hand_R"),
    weapon = new T.Group(),
    weapons = new Map(
      ["sword", "axe", "spear", "unarmed", "relic"].map((n) => [n, weapon]),
    );
  hand.add(weapon);
  const state = {
    rig,
    mixer,
    actions,
    hand,
    weapon,
    weapons,
    current: "",
    dropped: false,
    floorOffset: 0,
    locomotionSpeed: 0,
    profile: "prisoner",
    gear: new GearPose(rig),
    continuity: new SkeletonContinuity(rig),
    feet: new FootContact(rig),
    mixerPose: new MixerPose(rig),
    blend: new ActionBlend(),
  };
  actor.root.add(rig);
  actor.states.set("pilgrim", state);
  // This adapter calls the actual Actor.update and Three AnimationMixer.
  // Grounded Evade clips use final sole vertices, with no network floor table.
  return { actor, state, rig };
}
