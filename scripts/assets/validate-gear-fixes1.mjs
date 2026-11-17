import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import * as T from "../../node_modules/three/build/three.module.js";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { threeRig, setPose, weaponGroup } from "./three-rig.mjs";
import { sample, blend } from "./pose-sampling.mjs";
import { GearPose } from "../../src/gear-pose.ts";
import { SkeletonContinuity } from "../../src/skeleton-continuity.ts";
import { FootContact } from "../../src/foot-contact.ts";
import { GearCollision } from "../../src/gear-collision.ts";
import { applyCharacterAppearance } from "../../src/character-appearance.ts";
import { sourceAttackTime } from "../../src/motion-policy.ts";
import { ATTACKS } from "../../src/game.ts";
import {
  WEAPONS,
  WEAPON_MOUNTS,
  WEAPON_GRIP_SHIFT,
  HAND_GRIP,
} from "../../src/weapon-spec.ts";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS),
  report = [];
const sequence = [
  ["Idle", 0.6],
  ["Walk", 0.8],
  ["Run", 0.7],
  ["Attack1", 0.85],
  ["Guard", 0.4],
  ["DodgeBack", 0.82],
  ["Attack1", 0.52],
  ["Attack2", 0.51],
  ["Attack3", 1.15],
  ["DodgeLeft", 0.82],
  ["DodgeRight", 0.82],
  ["DodgeForward", 0.82],
  ["HitFront", 0.4],
  ["Idle", 0.4],
];
for (const character of ["prisoner", "watcher", "gaoler"].filter(
  (c) =>
    !process.argv.includes("--character") ||
    c === process.argv[process.argv.indexOf("--character") + 1],
)) {
  const d = await io.read(`public/assets/cast/${character}.glb`),
    legacy = await io.read(
      `public/assets/motion/${character === "gaoler" ? "gaoler" : "prisoner"}-combat.glb`,
    ),
    fixes = await io.read(
      `public/assets/motion/${character === "gaoler" ? "gaoler" : "prisoner"}-fixes1.glb`,
    ),
    fixes2 = await io.read(
      `public/assets/motion/${character === "gaoler" ? "gaoler" : "prisoner"}-fixes2.glb`,
    );
  const clips = new Map(
    [
      ...d.getRoot().listAnimations(),
      ...legacy.getRoot().listAnimations(),
      ...fixes.getRoot().listAnimations(),
      ...fixes2.getRoot().listAnimations(),
    ].map((c) => [c.getName(), c]),
  );
  for (const id of (character === "prisoner"
    ? ["sword", "axe", "spear"]
    : character === "gaoler"
      ? ["axe"]
      : ["sword"]
  ).filter(
    (w) =>
      !process.argv.includes("--weapon") ||
      w === process.argv[process.argv.indexOf("--weapon") + 1],
  )) {
    const rig = threeRig(d);
    applyCharacterAppearance(
      rig.root,
      character === "prisoner" ? "pilgrim" : character,
    );
    const hand = rig.root.getObjectByName("hand_R"),
      left = rig.root.getObjectByName("hand_L");
    const w = weaponGroup(
      await io.read(`public/assets/props-v7/weapon-${id}.glb`),
      WEAPON_MOUNTS[id],
      WEAPON_GRIP_SHIFT[id],
      HAND_GRIP[character === "gaoler" ? "gaoler" : "human"],
    );
    hand.add(w);
    rig.root.updateMatrixWorld(true);
    rig.root.traverse((o) => {
      if (o.isMesh && o.morphTargetDictionary?.new0GripR !== undefined)
        assert(
          o.geometry.morphTargetsRelative,
          "GLTF morph targets must be relative",
        );
    });
    const collision = new GearCollision(
        rig.root,
        hand,
        new Map([[id, w]]),
        true,
      ),
      gear = new GearPose(rig.root, character === "gaoler"),
      continuity = new SkeletonContinuity(rig.root, character === "gaoler"),
      feet = new FootContact(rig.root);
    assert(collision.surface.getAttribute("position").count > 1000);
    assert(collision.weapons.has(id));
    let previous = null,
      frames = 0,
      minFloor = Infinity,
      maxActorRadius = 0,
      maxWrist = 0,
      maxSupportGap = 0,
      worstSupport = {};
    const contacts = [];
    for (const [semantic, duration] of sequence) {
      const name = semantic.startsWith("Dodge")
          ? semantic.replace("Dodge", "Evade")
          : semantic.startsWith("Attack")
            ? (id === "sword" ? "Sword" : id === "spear" ? "Spear" : "") +
              semantic
            : semantic,
        c = clips.get(name);
      assert(c, name);
      let native;
      const tempo = /Attack/.test(name) ? WEAPONS[id].tempo : 1;
      for (let frame = 0; frame < Math.ceil((duration * 60) / tempo); frame++) {
        const worldTime = frame / 60,
          time = worldTime * tempo,
          source = /Attack/.test(name)
            ? sourceAttackTime(name, time, Number(name.at(-1)) - 1)
            : time;
        native = sample(rig.info, c, source);
        const pose =
          previous && worldTime < 0.09
            ? blend(previous, native, worldTime / 0.09)
            : native;
        rig.root.position.y = 0;
        setPose(rig, pose);
        continuity.apply(1 / 60);
        rig.root.position.y = feet.offset(0);
        rig.root.updateMatrixWorld(true);
        gear.apply(id, name, 0, undefined, time, 1 / 60);
        const hp = hand.getWorldPosition(new T.Vector3()),
          elbow = rig.root
            .getObjectByName("forearm_R")
            .getWorldPosition(new T.Vector3());
        maxWrist = Math.max(
          maxWrist,
          (new T.Vector3(0, 1, 0)
            .transformDirection(hand.matrixWorld)
            .angleTo(hp.clone().sub(elbow)) *
            180) /
            Math.PI,
        );
        if (
          id === "spear" ||
          (id === "axe" &&
            character !== "gaoler" &&
            /Attack|Guard|Step|Evade/.test(name))
        ) {
          const grip = HAND_GRIP[character === "gaoler" ? "gaoler" : "human"],
            a = new T.Vector3().fromArray(grip).applyMatrix4(hand.matrixWorld),
            shaft = new T.Vector3(0, 0, -1).transformDirection(
              hand.matrixWorld,
            ),
            b = new T.Vector3(-grip[0], grip[1], grip[2]).applyMatrix4(
              left.matrixWorld,
            ),
            along = b.clone().sub(a).dot(shaft);
          const gap = b.distanceTo(
            a.addScaledVector(shaft, Math.max(0.05, Math.min(0.52, along))),
          );
          if (gap > maxSupportGap) {
            maxSupportGap = gap;
            worstSupport = {
              clip: name,
              time,
              grip: new T.Vector3()
                .fromArray(grip)
                .applyMatrix4(hand.matrixWorld)
                .toArray(),
              leftPalm: b.toArray(),
              shaft: shaft.toArray(),
              shoulder: rig.root
                .getObjectByName("upperarm_L")
                .getWorldPosition(new T.Vector3())
                .toArray(),
              elbow: rig.root
                .getObjectByName("forearm_L")
                .getWorldPosition(new T.Vector3())
                .toArray(),
              wrist: left.getWorldPosition(new T.Vector3()).toArray(),
            };
          }
        }
        if (frame % (process.argv.includes("--fast") ? 6 : 1) === 0) {
          collision.update();
          const centre = new T.Vector3(
            0,
            character === "gaoler" ? 1.6 : 1.1,
            0,
          );
          const point = new T.Vector3();
          for (const geometry of [
            collision.surface,
            collision.weapons.get(id).geometry,
          ]) {
            const positions = geometry.getAttribute("position");
            for (let i = 0; i < positions.count; i++) {
              point.fromBufferAttribute(positions, i);
              if (geometry !== collision.surface)
                point.applyMatrix4(hand.matrixWorld);
              maxActorRadius = Math.max(
                maxActorRadius,
                point.distanceTo(centre),
              );
            }
          }
          const penalty = collision.penalty(id, hand.matrixWorld, 0),
            bounds = collision.weapons
              .get(id)
              .bounds.clone()
              .applyMatrix4(hand.matrixWorld);
          minFloor = Math.min(minFloor, bounds.min.y);
          if (penalty >= 1000) {
            const details = [];
            collision.tree.bvhcast(
              collision.weapons.get(id).tree,
              hand.matrixWorld,
              {
                intersectsTriangles(a, b, ia) {
                  const segment = new T.Line3();
                  if (!a.intersectsTriangle(b, segment)) return false;
                  const vi = collision.surface.index.getX(ia * 3),
                    entry = collision.cloth.findLast((m) => m.start <= vi);
                  const at = segment.getCenter(new T.Vector3());
                  if (details.length < 2)
                    details.push({
                      mesh: entry?.mesh.name,
                      at: at.toArray(),
                      segment: segment.distance(),
                    });
                  return details.length >= 2;
                },
              },
            );
            contacts.push({ clip: name, time, penalty, details });
          }
          frames++;
        }
      }
      previous = native;
    }
    report.push({
      character,
      weapon: id,
      surfaceVertices: collision.surface.getAttribute("position").count,
      checkedFrames: frames,
      minFloor,
      maxActorRadius,
      maxWrist,
      maxSupportGap,
      worstSupport,
      contacts,
    });
    collision.dispose();
  }
}
await mkdir("work/fixes2", { recursive: true });
await writeFile(
  `work/fixes2/gear-geometry${process.argv.includes("--weapon") ? "-" + process.argv[process.argv.indexOf("--weapon") + 1] : ""}.json`,
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    report.map(({ contacts, ...r }) => ({
      ...r,
      contacts: contacts.length,
      first: contacts.slice(0, 3),
    })),
  ),
);
if (!process.argv.includes("--report"))
  for (const r of report) {
    assert(
      r.contacts.length === 0,
      `${r.character}/${r.weapon}: weapon intersects body or clothing`,
    );
    assert(
      r.minFloor >= -0.002,
      `${r.character}/${r.weapon}: weapon enters floor`,
    );
    assert(r.maxWrist < 32.01, `${r.character}/${r.weapon}: wrist bend`);
    if (r.character === "watcher" || r.character === "gaoler")
      assert(
        r.maxActorRadius < (r.character === "gaoler" ? 3.2 : 2.2),
        `${r.character}: actor frustum bound crops posed geometry`,
      );
    assert(
      r.maxSupportGap < 0.035,
      `${r.character}/${r.weapon}: support hand misses shaft`,
    );
  }
