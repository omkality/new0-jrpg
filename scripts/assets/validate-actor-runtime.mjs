import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import * as T from "../../node_modules/three/build/three.module.js";
import { runtimeActor } from "./runtime-actor.mjs";
import { Campaign } from "../../src/campaign.ts";
import { CampaignShowcase } from "../../src/journey.ts";

const { actor, state: s, rig } = await runtimeActor();
const g = new Campaign();
g.startScenario("chapel");
const tour = new CampaignShowcase(g, "chapel");
let changes = 0,
  prior = "",
  maxWeight = 0,
  minWeight = 1;
for (let frame = 0; frame < 35 * 60; frame++) {
  for (let k = 0; k < 2; k++) {
    g.update(1 / 120, tour.update(1 / 120));
    g.events.length = 0;
  }
  actor.update(1 / 60, g.player);
  const sum = [...s.actions.values()]
    .filter((a) => a.isScheduled() && a.enabled)
    .reduce((n, a) => n + a.getEffectiveWeight(), 0);
  maxWeight = Math.max(sum, maxWeight);
  minWeight = Math.min(sum, minWeight);
  assert.ok(
    Math.abs(sum - 1) < 1e-6,
    `Actor action weights ${sum} at chapel ${frame / 60}s`,
  );
  if (frame > 26 * 60 && frame < 28.2 * 60) {
    if (prior && s.current !== prior) changes++;
    prior = s.current;
  }
}
assert.ok(changes <= 5, `Chapel locomotion restarts ${changes} times in 2s`);
const vertices = [];
rig.traverse((o) => {
  if (!(o instanceof T.SkinnedMesh) || !o.visible) return;
  vertices.push({
    mesh: o,
    indices: [
      ...new Set(
        o.geometry.index?.array ??
          Array.from(
            { length: o.geometry.attributes.position.count },
            (_, i) => i,
          ),
      ),
    ],
  });
});
const p = new T.Vector3(),
  results = [];
for (const side of ["Back", "Forward", "Left", "Right"]) {
  actor.reset();
  const f = {
    ...g.player,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    kind: "pilgrim",
    weapon: "unarmed",
    armour: 0,
    hp: 100,
    mode: "idle",
    speed: 0,
    time: 0,
  };
  for (let i = 0; i < 30; i++) actor.update(1 / 60, f);
  let min = Infinity,
    max = -Infinity,
    minHip = Infinity;
  for (let frame = 0; frame < 50; frame++) {
    Object.assign(f, { mode: "dodge", dodgeSide: side, time: frame / 60 });
    actor.update(1 / 60, f);
    actor.root.updateMatrixWorld(true);
    assert.equal(s.current, "Evade" + side);
    let floor = Infinity;
    for (const { mesh, indices } of vertices)
      for (const i of indices) {
        mesh.getVertexPosition(i, p);
        mesh.localToWorld(p);
        floor = Math.min(floor, p.y);
      }
    min = Math.min(min, floor);
    max = Math.max(max, floor);
    minHip = Math.min(
      minHip,
      rig.getObjectByName("pelvis").getWorldPosition(p).y,
    );
  }
  assert.ok(
    min >= -0.025 && max <= 0.035,
    `${side}: final body floor ${min}..${max}`,
  );
  assert.ok(minHip > 0.6, `${side}: humanoid unexpectedly folds to ${minHip}m`);
  results.push({
    side,
    minimumFloorY: min,
    maximumFloorY: max,
    minimumHipY: minHip,
  });
}
await mkdir("work/fixes3", { recursive: true });
const report = {
  passed: true,
  chapelClipChangesOverTwoSeconds: changes,
  actionWeightRange: [minWeight, maxWeight],
  groundedEmptyHandEvades: results,
  usesActualActorAndMixer: true,
};
await writeFile(
  "work/fixes3/actor-runtime.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
