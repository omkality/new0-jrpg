import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { writeFile, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { sample } from "./pose-sampling.mjs";
import { threeRig, setPose, weaponGroup } from "./three-rig.mjs";
const { GearPose } = await import(
  process.argv.includes("--baseline-controller")
    ? "../../work/fixes1/baseline-gear-pose.ts"
    : "../../src/gear-pose.ts"
);
import { GearCollision } from "../../src/gear-collision.ts";
import {
  WEAPON_MOUNTS,
  WEAPON_GRIP_SHIFT,
  HAND_GRIP,
} from "../../src/weapon-spec.ts";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS),
  report = [];
const curves = JSON.parse(
  await readFile("public/assets/cast/floor-v7.json", "utf8"),
);
for (const [character, weapon, clip, ts] of [
  [
    "prisoner",
    "spear",
    "Attack1",
    [0, 0.0167, 0.0333, 0.05, 0.1, 0.2, 0.3, 0.4],
  ],
  ["prisoner", "sword", "DodgeBack", [0.1, 0.2, 0.3, 0.4, 0.45, 0.5, 0.6, 0.7]],
  ["gaoler", "axe", "Attack1", [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]],
]) {
  const cast = await io.read(`public/assets/cast/${character}.glb`),
    rig = threeRig(cast),
    motion = await io.read(
      `public/assets/motion/${character === "gaoler" ? "gaoler" : "prisoner"}-combat.glb`,
    );
  const hand = rig.root.getObjectByName("hand_R"),
    w = weaponGroup(
      await io.read(`public/assets/props-v7/weapon-${weapon}.glb`),
      WEAPON_MOUNTS[weapon],
      WEAPON_GRIP_SHIFT[weapon],
      HAND_GRIP[character === "gaoler" ? "gaoler" : "human"],
    );
  hand.add(w);
  rig.root.updateMatrixWorld(true);
  const controller = new GearPose(rig.root, character === "gaoler"),
    collision = new GearCollision(
      rig.root,
      hand,
      new Map([[weapon, w]]),
      character === "gaoler",
    );
  if (character !== "gaoler")
    assert(
      collision.surface.getAttribute("position").count > 1000,
      "QA adapter did not instantiate real runtime skinned surfaces",
    );
  assert(
    collision.weapons.has(weapon),
    "QA adapter did not instantiate the held weapon",
  );
  const animation = motion
      .getRoot()
      .listAnimations()
      .find((c) => c.getName() === clip),
    times = [];
  let calls = 0;
  for (const t of ts) {
    setPose(rig, sample(rig.info, animation, t));
    rig.root.position.y =
      curves.profiles[character].clips[clip].offsets[Math.round(t * 60)] ?? 0;
    rig.root.updateMatrixWorld(true);
    const begin = performance.now();
    controller.apply(
      weapon,
      clip,
      0,
      process.argv.includes("--with-collision")
        ? (m, correction) => {
            calls++;
            collision.update();
            return collision.penalty(weapon, m, 0, correction);
          }
        : undefined,
      t,
      1 / 60,
    );
    times.push(performance.now() - begin);
  }
  times.sort((a, b) => a - b);
  report.push({
    character,
    weapon,
    clip,
    frames: ts.length,
    surface_vertices: collision.surface.getAttribute("position").count,
    collision_rebuilds: calls,
    median_ms: times[Math.floor(times.length / 2)],
    p95_ms: times.at(-1),
    weapon_bounds: collision.weapons.get(weapon).bounds,
  });
  console.log(JSON.stringify(report.at(-1)));
  collision.dispose();
}
await writeFile(
  `work/fixes1/${process.argv.includes("--with-collision") ? "baseline" : "current"}-runtime-profile.json`,
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
