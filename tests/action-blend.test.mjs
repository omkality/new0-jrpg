import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { ActionBlend, locomotionName } from "../src/action-blend.ts";

test("interrupted fades retain one total weight without reviving outgoing clips", () => {
  const root = new T.Object3D(),
    mixer = new T.AnimationMixer(root),
    blend = new ActionBlend();
  const actions = [0, 1, 2].map((i) =>
    mixer.clipAction(
      new T.AnimationClip("pose" + i, 1, [
        new T.NumberKeyframeTrack(".position[x]", [0, 1], [i, i]),
      ]),
    ),
  );
  actions[0].play();
  blend.select(actions[0], 0.18);
  for (let frame = 0; frame < 180; frame++) {
    if (frame % 4 === 0) {
      const next = actions[(frame / 4) % 3];
      next.enabled = true;
      next.play();
      blend.select(next, 0.18);
    }
    blend.update(1 / 60);
    mixer.update(1 / 60);
    const sum = actions
      .filter((a) => a.isScheduled())
      .reduce((s, a) => s + a.getEffectiveWeight(), 0);
    assert.ok(Math.abs(sum - 1) < 1e-6, `frame ${frame}: ${sum}`);
  }
});

test("near-rest speed noise cannot restart the locomotion clip every frame", () => {
  let name = "Idle",
    changes = 0;
  for (let i = 0; i < 120; i++) {
    const next = locomotionName(i % 2 ? 0.12 : 0.08, name);
    changes += next !== name;
    name = next;
  }
  assert.equal(changes, 0);
  assert.equal(locomotionName(0.5, name), "Walk");
  assert.equal(locomotionName(1.7, "Walk"), "Walk");
  assert.equal(locomotionName(1.7, "Run"), "Run");
});
