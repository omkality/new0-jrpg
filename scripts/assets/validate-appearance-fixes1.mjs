import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
// scripts/assets has its own dependencies. Use the application's instances so
// instanceof Bone/SkinnedMesh gates inside the actual controllers are exercised.
import * as T from "../../node_modules/three/build/three.module.js";
import { MeshBVH } from "../../node_modules/three-mesh-bvh/build/index.module.js";
import { mergeGeometries } from "../../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js";
import { structure, sample } from "./pose-sampling.mjs";
import {
  createCharacterHead,
  applyCharacterAppearance,
  setArmourCoverage,
  armourCoverageAt,
} from "../../src/character-appearance.ts";
import {
  armourModel,
  flaskModel,
  setFlaskFill,
} from "../../src/gear-visuals.ts";
import { GearPose } from "../../src/gear-pose.ts";
import { SkeletonContinuity } from "../../src/skeleton-continuity.ts";
import { sourceAttackTime, motionName } from "../../src/motion-policy.ts";
import { ATTACKS } from "../../src/game.ts";
import { WEAPONS } from "../../src/weapon-spec.ts";
const geometryStride = process.argv.includes("--full") ? 1 : 5;
process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
const require = createRequire(resolve("scripts/assets/package.json"));
const { NodeIO } = require("@gltf-transform/core");
const { ALL_EXTENSIONS } = require("@gltf-transform/extensions");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const clipFilter = process.argv
  .find((a) => a.startsWith("--clips="))
  ?.slice(8)
  .split(",");
const weaponFilter = process.argv
  .find((a) => a.startsWith("--weapons="))
  ?.slice(10)
  .split(",");
const reportPath =
  process.argv.find((a) => a.startsWith("--report="))?.slice(9) ??
  (clipFilter
    ? "work/fixes1/appearance-validation-targeted.json"
    : "work/fixes1/appearance-validation.json");
await mkdir("work/fixes1", { recursive: true });
await mkdir(dirname(reportPath), { recursive: true });
const heads = [];
for (const kind of ["pilgrim", "watcher", "effigy"]) {
  const h = createCharacterHead(kind),
    mesh = h.getObjectByName("fixes1_sculpted_head"),
    p = mesh.geometry.getAttribute("position");
  let nose = -Infinity,
    cheek = -Infinity;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    assert.ok(
      [x, y, z].every(Number.isFinite),
      `${kind} head has a non-finite vertex`,
    );
    if (y > 1.567 && y < 1.59) {
      if (Math.abs(x) < 0.012) nose = Math.max(nose, z);
      if (Math.abs(x) > 0.04 && Math.abs(x) < 0.055) cheek = Math.max(cheek, z);
    }
  }
  assert.ok(
    nose - cheek > 0.012,
    `${kind} has no actual sculpted nose/cheek depth`,
  );
  const mouth = h.getObjectByName("fixes1_mouth");
  assert.ok(
    mouth &&
      !(mouth instanceof T.Mesh) &&
      mouth.position.z > 0.04 &&
      mouth.position.z < 0.12,
    "Mouth marker does not sit on the sculpted face",
  );
  heads.push({
    kind,
    triangles: mesh.geometry.index.count / 3,
    noseRelief: nose - cheek,
  });
  mesh.geometry.dispose();
  mesh.material.dispose();
}
const doc = await io.read("public/assets/cast/prisoner.glb"),
  motion = await io.read("public/assets/motion/prisoner-combat.glb"),
  fixes = await io.read("public/assets/motion/prisoner-fixes1.glb");
const info = structure(doc),
  root = doc.getRoot(),
  joints = root.listSkins()[0].listJoints();
const failures = [];
const rig = new T.Group(),
  objects = new Map();
function geometry(p, targetNames = []) {
  const g = new T.BufferGeometry();
  for (const [name, alias] of [
    ["POSITION", "position"],
    ["NORMAL", "normal"],
    ["TEXCOORD_0", "uv"],
    ["JOINTS_0", "skinIndex"],
    ["WEIGHTS_0", "skinWeight"],
  ]) {
    const a = p.getAttribute(name);
    if (a)
      g.setAttribute(
        alias,
        new T.BufferAttribute(a.getArray(), a.getElementSize()),
      );
  }
  if (p.getIndices())
    g.setIndex(new T.BufferAttribute(p.getIndices().getArray(), 1));
  for (const [name, alias] of [
    ["POSITION", "position"],
    ["NORMAL", "normal"],
  ]) {
    const targets = p.listTargets().map((target, i) => {
      const a = target.getAttribute(name);
      if (!a) return null;
      const attribute = new T.BufferAttribute(a.getArray(), a.getElementSize());
      attribute.name = targetNames[i] ?? String(i);
      return attribute;
    });
    if (targets.length && targets.every(Boolean))
      g.morphAttributes[alias] = targets;
  }
  g.morphTargetsRelative = true;
  return g;
}
for (const n of info.nodes) {
  let o;
  if (n.getMesh())
    assert.equal(
      n.getMesh().listPrimitives().length,
      1,
      "Fixture loader must include every source primitive",
    );
  if (n.getMesh()) {
    const g = geometry(
      n.getMesh().listPrimitives()[0],
      n.getMesh().getExtras().targetNames ?? [],
    );
    o = n.getSkin()
      ? new T.SkinnedMesh(g, new T.MeshStandardMaterial())
      : new T.Mesh(g, new T.MeshStandardMaterial());
  } else o = joints.includes(n) ? new T.Bone() : new T.Object3D();
  o.name = n.getName();
  const b = info.base.get(n);
  o.position.copy(b.p);
  o.quaternion.copy(b.q);
  o.scale.copy(b.s);
  objects.set(n, o);
}
for (const [n, o] of objects)
  (info.parent.has(n) ? objects.get(info.parent.get(n)) : rig).add(o);
rig.updateMatrixWorld(true);
const skeleton = new T.Skeleton(
  joints.map((j) => objects.get(j)),
  joints.map((_, i) =>
    new T.Matrix4().fromArray(
      root.listSkins()[0].getInverseBindMatrices().getArray(),
      i * 16,
    ),
  ),
);
for (const [n, o] of objects)
  if (o.isSkinnedMesh) o.bind(skeleton, new T.Matrix4());
const originalBody = rig.getObjectByName("body"),
  protectedGeometry = originalBody.geometry,
  protectedAttributes = Object.fromEntries(
    ["position", "skinIndex", "skinWeight"].map((k) => [
      k,
      protectedGeometry.getAttribute(k),
    ]),
  );
const shirtMaterial = rig.getObjectByName("new0_v8_fitted_linen").material;
shirtMaterial.onBeforeCompile = (shader) => {
  shader.fragmentShader =
    "/* expected_cloth_remap */\n" + shader.fragmentShader;
};
shirtMaterial.customProgramCacheKey = () => "expected_cloth_remap";
assert.equal(
  originalBody.morphTargetDictionary?.new0GripR,
  0,
  "Actual right-finger grip target not loaded",
);
assert.equal(
  originalBody.morphTargetDictionary?.new0GripL,
  1,
  "Actual left-finger grip target not loaded",
);
applyCharacterAppearance(rig, "pilgrim");
// Independent source-face probes cover the neck-weighted jaw and nose that the
// old head-only cutoff left visible. Check retained indices, not mesh visibility.
const retained = new Set();
for (let i = 0; i < originalBody.geometry.index.count; i += 3)
  retained.add(
    [0, 1, 2].map((k) => originalBody.geometry.index.getX(i + k)).join(","),
  );
const probe = new T.Vector3();
let faceTriangles = 0,
  remainingFaceTriangles = 0;
for (let i = 0; i < protectedGeometry.index.count; i += 3) {
  const vertices = [0, 1, 2].map((k) => protectedGeometry.index.getX(i + k));
  probe.set(0, 0, 0);
  for (const v of vertices)
    probe.add(
      new T.Vector3()
        .fromBufferAttribute(protectedAttributes.position, v)
        .multiplyScalar(1 / 3),
    );
  const skull = Math.abs(probe.x) < 0.1 && probe.y > 1.5 && probe.z > -0.14;
  const jaw =
    Math.abs(probe.x) < 0.1 &&
    probe.y > 1.395 &&
    probe.y <= 1.5 &&
    probe.z > 0.015;
  if (skull || jaw) {
    faceTriangles++;
    if (retained.has(vertices.join(","))) remainingFaceTriangles++;
  }
}
assert.ok(faceTriangles > 1000, "Source face landmark coverage too small");
if (remainingFaceTriangles)
  failures.push(
    `${remainingFaceTriangles} original face triangles still visible`,
  );
for (const [k, a] of Object.entries(protectedAttributes))
  assert.equal(
    originalBody.geometry.getAttribute(k),
    a,
    `Protected ${k} must be shared unchanged`,
  );
for (const name of [
  "original_porcelain_mask",
  "original_eye_cavity_-1",
  "original_eye_cavity_1",
  "original_mask_mouth",
  "new0_v7_rounded_cloth_hood",
  "new0_v7_soft_collar",
])
  assert.equal(
    rig.getObjectByName(name)?.visible,
    false,
    `${name} overlay not hidden`,
  );
assert.ok(
  rig.getObjectByName("fixes1_sculpted_head") instanceof T.Mesh,
  "Sculpted head missing",
);
assert.ok(
  rig.getObjectByName("fixes1_neck_skin") instanceof T.SkinnedMesh,
  "Replacement neck missing",
);
assert.ok(
  rig.getObjectByName("fixes1_fitted_collar") instanceof T.SkinnedMesh,
  "Fitted collar missing",
);
const seam = rig.getObjectByName("fixes1_fitted_collar"),
  shirt = rig.getObjectByName("new0_v8_fitted_linen"),
  seamSources = seam.userData.fixes1SeamSourceIndices;
assert.ok(
  seamSources.length > 12,
  "Fitted seam did not follow the shirt opening",
);
const seamDegree = new Map();
for (const [a, b] of seam.userData.fixes1SeamBoundaryEdges)
  for (const v of [a, b]) seamDegree.set(v, (seamDegree.get(v) || 0) + 1);
assert.ok(
  [...seamDegree.values()].every((n) => n === 2),
  "Fitted collar opening is not one closed physical boundary",
);
const collarShader = {
  uniforms: {},
  vertexShader: "#include <begin_vertex>\n#include <skinning_vertex>",
  fragmentShader:
    "#include <map_fragment>\n#include <clipping_planes_fragment>",
};
seam.material.onBeforeCompile(collarShader, {});
assert.equal(
  collarShader.fragmentShader.split("expected_cloth_remap").length - 1,
  1,
  "Fitted collar did not inherit the garment colour shader exactly once",
);
assert.equal(
  collarShader.fragmentShader.split("uniform float new0ArmourEnabled").length -
    1,
  1,
  "Fitted collar applied duplicate armour shader wrappers",
);
for (let i = 0; i < seamSources.length; i++)
  for (const c of [0, 1])
    assert.ok(
      Math.abs(
        seam.geometry.getAttribute("uv").getComponent(i, c) -
          shirt.geometry.getAttribute("uv").getComponent(seamSources[i], c),
      ) < 1e-6,
      "Collar texture does not meet the shirt UV seam",
    );
let maxSeamGap = 0;
const armour = armourModel(rig);
armour.position.set(0, 1.16, 0.01);
rig.add(armour);
rig.updateMatrixWorld(true);
rig.getObjectByName("chest").attach(armour);
setArmourCoverage(rig, true);
assert.equal(armour.parent.name, "chest", "Cuirass must follow the chest");
assert.equal(
  rig.getObjectByName("ArmourFauld").parent.name,
  "pelvis",
  "Waist lames must articulate with the pelvis",
);
const compiled = {
  uniforms: {},
  vertexShader: "#include <begin_vertex>\n#include <skinning_vertex>",
  fragmentShader:
    "#include <map_fragment>\n#include <clipping_planes_fragment>",
};
originalBody.material.onBeforeCompile(compiled, {});
assert.ok(
  compiled.fragmentShader.includes("new0SkinColor"),
  "Skin palette override shader missing",
);
assert.ok(
  compiled.fragmentShader.includes("discard"),
  "Armour underlayer shader missing",
);
assert.ok(
  compiled.vertexShader.includes("new0ArmourMatrices[0]*coveredWorld"),
  "Posed armour coordinates missing",
);
assert.ok(
  compiled.vertexShader.includes("new0ArmourMatrices[3]*coveredWorld"),
  "Articulated waist coverage coordinates missing",
);
assert.equal(
  compiled.uniforms.new0ArmourEnabled.value,
  1,
  "Equipped torso coverage disabled",
);
assert.ok(
  compiled.uniforms.new0SkinColor.value.equals(new T.Color(0xc5ab9a)),
  "Hand skin and face skin palette differ",
);
setArmourCoverage(rig, false);
assert.equal(
  compiled.uniforms.new0ArmourEnabled.value,
  0,
  "Unequipped torso remains cut out",
);
assert.equal(
  rig.getObjectByName("ArmourFauld").visible,
  false,
  "Unequipped fauld still visible",
);
setArmourCoverage(rig, true);
for (const meshName of ["body", "new0_v8_fitted_linen"]) {
  const m = rig.getObjectByName(meshName),
    mask = m.geometry.getAttribute("fixes1Coverage"),
    si = m.geometry.getAttribute("skinIndex"),
    sw = m.geometry.getAttribute("skinWeight");
  let distalCount = 0,
    torsoCount = 0;
  for (let i = 0; i < mask.count; i++) {
    let distal = 0;
    for (let k = 0; k < 4; k++)
      if (
        /^(forearm|hand)_/.test(
          skeleton.bones[si.getComponent(i, k)]?.name ?? "",
        )
      )
        distal += sw.getComponent(i, k);
    if (distal > 0.8) {
      distalCount++;
      assert.equal(
        mask.getX(i),
        0,
        "Armour mask must never erase distal arms to hide clipping",
      );
    }
    const p = m.geometry.getAttribute("position");
    if (p.getY(i) < 0.7)
      assert.equal(
        mask.getX(i),
        0,
        "Armour coverage must never erase knees or shins",
      );
    if (p.getY(i) > 1.05 && p.getY(i) < 1.3 && Math.abs(p.getX(i)) < 0.1) {
      torsoCount++;
      assert.equal(mask.getX(i), 1, "Covered torso underlayer missing");
    }
  }
  assert.ok(
    distalCount > 40 && torsoCount > 40,
    "Insufficient sleeve/torso coverage probes",
  );
}
const controller = new GearPose(rig, false, false);
const continuity = new SkeletonContinuity(rig, false);
let context = "bind";
function posedGeometry(mesh) {
  const source = mesh.geometry,
    g = new T.BufferGeometry(),
    p = new Float32Array(source.getAttribute("position").count * 3),
    v = new T.Vector3();
  if (mesh.isSkinnedMesh) mesh.skeleton.update();
  for (let i = 0; i < p.length / 3; i++) {
    mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
    assert.ok(
      [v.x, v.y, v.z].every(Number.isFinite),
      `${context}: non-finite ${mesh.name} vertex ${i}`,
    );
    v.toArray(p, i * 3);
  }
  g.setAttribute("position", new T.BufferAttribute(p, 3));
  g.setIndex(source.index);
  if (source.getAttribute("fixes1Coverage"))
    g.setAttribute("fixes1Coverage", source.getAttribute("fixes1Coverage"));
  return g;
}
const results = [],
  uncovered = [],
  recorded = new Map();
const clips = new Map(
  [
    ...doc.getRoot().listAnimations(),
    ...motion.getRoot().listAnimations(),
    ...fixes.getRoot().listAnimations(),
  ].map((c) => [c.getName(), c]),
);
for (const weapon of ["sword", "axe", "spear", "unarmed"].filter(
  (w) => !weaponFilter || weaponFilter.includes(w),
)) {
  const dodgeNames = ["Forward", "Back", "Left", "Right"].map((d) =>
    motionName({
      mode: "dodge",
      dodgeSide: d,
      weapon,
      kind: "pilgrim",
      armour: 1,
    }),
  );
  assert.ok(
    dodgeNames.every((n) => n.startsWith("WeaponStep")),
    "Armoured policy must keep the rigid cuirass out of a full tuck roll",
  );
  const names = [
    "Idle",
    "Walk",
    "Run",
    "HitFront",
    "HitLeft",
    "HitRight",
    "Guard",
    "BlockHit",
    "DeathBack",
    "DeathFront",
    "DeathSide",
    "Drink",
    ...[1, 2, 3].map((i) => `${weapon === "sword" ? "Sword" : ""}Attack${i}`),
    ...dodgeNames,
  ];
  for (const name of names.filter(
    (n) => !clipFilter || clipFilter.includes(n),
  )) {
    const clip = clips.get(name === "Drink" ? "Idle" : name);
    if (!clip) throw Error(`Missing actual runtime clip ${name}`);
    const nativeDuration = Math.max(
        ...clip.listSamplers().map((s) => s.getInput().getArray().at(-1)),
      ),
      attack = /^(?:Sword)?Attack([123])$/.exec(name);
    const duration =
      name === "Drink"
        ? 1.3
        : attack
          ? ATTACKS[Number(attack[1]) - 1].duration
          : nativeDuration;
    let bad = 0,
      frames = 0,
      contacts = 0,
      covered = 0,
      maxVisibleSegment = 0,
      worstContact;
    controller.reset();
    continuity.reset();
    const tempo = attack ? WEAPONS[weapon].tempo : 1;
    for (let frame = 0; frame <= Math.ceil((duration * 60) / tempo); frame++) {
      const time = Math.min(duration, (frame / 60) * tempo);
      context = `${weapon}/${name}@${time.toFixed(4)}`;
      const pose = sample(
        info,
        clip,
        attack ? sourceAttackTime(name, time, Number(attack[1]) - 1) : time,
      );
      for (const [n, o] of objects) {
        const p = pose.get(n);
        o.position.copy(p.p);
        o.quaternion.copy(p.q);
        o.scale.copy(p.s);
      }
      rig.updateMatrixWorld(true);
      continuity.apply(1 / 60);
      if (/^Death/.test(name) && time > 0.25)
        controller.release(1 / 60, 0, name === "DeathSide");
      else controller.apply(weapon, name, 0, undefined, time, 1 / 60);
      if (name === "Drink") controller.drink(time, 1 / 60);
      if (frame % geometryStride !== 0 && time !== duration) continue;
      rig.updateMatrixWorld(true);
      skeleton.update();
      for (let i = 0; i < seamSources.length; i++) {
        const a = seam
            .getVertexPosition(i, new T.Vector3())
            .applyMatrix4(seam.matrixWorld),
          b = shirt
            .getVertexPosition(seamSources[i], new T.Vector3())
            .applyMatrix4(shirt.matrixWorld);
        const gap = a.distanceTo(b);
        assert.ok(
          Number.isFinite(gap),
          `${context}: non-finite fitted seam ${i}`,
        );
        maxSeamGap = Math.max(maxSeamGap, gap);
      }
      const pieces = [],
        partRanges = [];
      let vertexOffset = 0;
      rig.traverse((o) => {
        if (
          o.isMesh &&
          o.visible &&
          (o.parent === armour ||
            o.parent?.name.startsWith("ArmourShoulder") ||
            o.parent?.name === "ArmourFauld")
        ) {
          const g = posedGeometry(o);
          pieces.push(g);
          partRanges.push({
            part: o.parent.name,
            start: vertexOffset,
            end: vertexOffset + g.getAttribute("position").count,
          });
          vertexOffset += g.getAttribute("position").count;
        }
      });
      const plate = mergeGeometries(pieces);
      const tree = new MeshBVH(plate);
      let contact = false;
      for (const n of [
        "new0_v8_fitted_linen",
        "new0_v8_fitted_trousers",
        "body",
        "fixes1_neck_skin",
        "fixes1_fitted_collar",
      ]) {
        const m = rig.getObjectByName(n),
          cloth = posedGeometry(m),
          clothTree = new MeshBVH(cloth, { indirect: true }),
          line = new T.Line3(),
          mask = cloth.getAttribute("fixes1Coverage");
        tree.bvhcast(clothTree, new T.Matrix4(), {
          intersectsTriangles: (ta, tb, ia, ib) => {
            if (!ta.intersectsTriangle(tb, line)) return false;
            contacts++;
            const index = clothTree.resolveTriangleIndex(ib) * 3;
            const values = [0, 1, 2].map((k) =>
                mask.getX(cloth.index.getX(index + k)),
              ),
              bary = new T.Vector3(),
              p = new T.Vector3();
            let visible = false,
              masked = true;
            // Match the interpolated per-fragment coverage, including mixed sleeve
            // triangles. An all-vertices rule gives false contacts at the elbow seam.
            for (const u of [0, 0.25, 0.5, 0.75, 1]) {
              p.lerpVectors(line.start, line.end, u);
              T.Triangle.getBarycoord(p, tb.a, tb.b, tb.c, bary);
              const value =
                values[0] * bary.x + values[1] * bary.y + values[2] * bary.z;
              if (value <= 0.99) masked = false;
              if (value <= 0.99 || !armourCoverageAt(rig, p)) visible = true;
            }
            if (!visible || line.distance() < 1e-6) covered++;
            else {
              contact = true;
              assert.ok(
                Number.isFinite(line.distance()),
                `${context}: non-finite triangle intersection ${n}`,
              );
              const partVertex = plate.index.getX(ia * 3),
                part = partRanges.find(
                  (r) => partVertex >= r.start && partVertex < r.end,
                )?.part;
              if (line.distance() > maxVisibleSegment) {
                maxVisibleSegment = line.distance();
                worstContact = {
                  mesh: n,
                  part,
                  time,
                  masked,
                  start: line.start.toArray(),
                  end: line.end.toArray(),
                  local: line.start
                    .clone()
                    .applyMatrix4(armour.matrixWorld.clone().invert())
                    .toArray(),
                  fauldLocal: line.start
                    .clone()
                    .applyMatrix4(
                      rig
                        .getObjectByName("ArmourFauld")
                        .matrixWorld.clone()
                        .invert(),
                    )
                    .toArray(),
                  vertices: [0, 1, 2].map((k) => {
                    const v = cloth.index.getX(index + k),
                      pos = m.geometry.getAttribute("position");
                    return {
                      v,
                      mask: mask.getX(v),
                      rest: [pos.getX(v), pos.getY(v), pos.getZ(v)],
                    };
                  }),
                };
              }
              const recordKey = weapon + masked;
              if ((recorded.get(recordKey) || 0) < 8) {
                recorded.set(recordKey, (recorded.get(recordKey) || 0) + 1);
                uncovered.push({
                  weapon,
                  mesh: n,
                  part,
                  clip: name,
                  time,
                  masked,
                  segmentLength: line.distance(),
                  start: line.start.toArray(),
                  end: line.end.toArray(),
                  local: [
                    armour,
                    rig.getObjectByName("ArmourShoulderR"),
                    rig.getObjectByName("ArmourShoulderL"),
                    rig.getObjectByName("ArmourFauld"),
                  ].map((o) => ({
                    name: o.name,
                    point: line.start
                      .clone()
                      .applyMatrix4(o.matrixWorld.clone().invert())
                      .toArray(),
                  })),
                  vertices: [0, 1, 2].map((k) => {
                    const v = cloth.index.getX(index + k),
                      pos = m.geometry.getAttribute("position");
                    return {
                      v,
                      mask: mask.getX(v),
                      rest: [pos.getX(v), pos.getY(v), pos.getZ(v)],
                    };
                  }),
                });
              }
            }
            return false;
          },
        });
        cloth.dispose();
      }
      if (worstContact?.time === time) {
        const inverse = armour.matrixWorld.clone().invert(),
          start = new T.Vector3().fromArray(worstContact.start),
          end = new T.Vector3().fromArray(worstContact.end),
          path = compiled.uniforms.new0StrapPath.value;
        worstContact.localEnd = end.clone().applyMatrix4(inverse).toArray();
        worstContact.coverageSamples = [0, 0.25, 0.5, 0.75, 1].map((u) => {
          const world = start.clone().lerp(end, u),
            p = world.clone().applyMatrix4(inverse);
          let distance = Infinity;
          for (let i = 1; i < path.length; i++) {
            const a = path[i - 1],
              b = path[i],
              dy = b.x - a.x,
              dz = b.y - a.y,
              t = T.MathUtils.clamp(
                ((p.y - a.x) * dy + (p.z - a.y) * dz) / (dy * dy + dz * dz),
                0,
                1,
              );
            distance = Math.min(
              distance,
              Math.hypot(p.y - a.x - dy * t, p.z - a.y - dz * t),
            );
          }
          return {
            local: p.toArray(),
            covered: armourCoverageAt(rig, world),
            strapDistance: distance,
          };
        });
      }
      if (contact) bad++;
      frames++;
      for (const p of pieces) p.dispose();
      plate.dispose();
    }
    results.push({
      weapon,
      clip: name,
      frames,
      visibleContactFrames: bad,
      triangleContacts: contacts,
      coveredContacts: covered,
      maxVisibleSegment,
      worstContact,
    });
  }
}
// Full tuck rolls remain available without metal armour. Exercise the actual
// cloth/neck skinning throughout these clips with every armour part switched
// off, separately from the cuirass intersection test.
const unarmouredRolls = [];
armour.visible = false;
setArmourCoverage(rig, false);
assert.equal(
  rig.getObjectByName("ArmourFauld").visible,
  false,
  "Fauld did not disappear for unarmoured roll",
);
if (!weaponFilter || weaponFilter.includes("unarmed"))
  for (const side of ["Forward", "Back", "Left", "Right"]) {
    const name = motionName({
      mode: "dodge",
      dodgeSide: side,
      weapon: "unarmed",
      kind: "pilgrim",
      armour: 0,
    });
    assert.ok(name.startsWith("Dodge"), "Unarmoured roll policy is missing");
    if (clipFilter && !clipFilter.includes(name)) continue;
    const clip = clips.get(name),
      duration = Math.max(
        ...clip.listSamplers().map((s) => s.getInput().getArray().at(-1)),
      );
    let frames = 0,
      vertices = 0;
    controller.reset();
    continuity.reset();
    for (let frame = 0; frame <= Math.ceil(duration * 60); frame++) {
      const time = Math.min(duration, frame / 60);
      context = `unarmoured/${name}@${time.toFixed(4)}`;
      const pose = sample(info, clip, time);
      for (const [n, o] of objects) {
        const p = pose.get(n);
        o.position.copy(p.p);
        o.quaternion.copy(p.q);
        o.scale.copy(p.s);
      }
      rig.updateMatrixWorld(true);
      continuity.apply(1 / 60);
      controller.apply("unarmed", name, 0, undefined, time, 1 / 60);
      rig.updateMatrixWorld(true);
      skeleton.update();
      if (frame % geometryStride !== 0 && time !== duration) continue;
      for (const meshName of [
        "body",
        "new0_v8_fitted_linen",
        "new0_v8_fitted_trousers",
        "fixes1_neck_skin",
        "fixes1_fitted_collar",
        "fixes1_sculpted_head",
      ]) {
        const g = posedGeometry(rig.getObjectByName(meshName));
        vertices += g.getAttribute("position").count;
        g.dispose();
      }
      for (let i = 0; i < seamSources.length; i++) {
        const a = seam
            .getVertexPosition(i, new T.Vector3())
            .applyMatrix4(seam.matrixWorld),
          b = shirt
            .getVertexPosition(seamSources[i], new T.Vector3())
            .applyMatrix4(shirt.matrixWorld),
          gap = a.distanceTo(b);
        assert.ok(
          Number.isFinite(gap),
          `${context}: non-finite fitted seam ${i}`,
        );
        maxSeamGap = Math.max(maxSeamGap, gap);
      }
      frames++;
    }
    unarmouredRolls.push({
      clip: name,
      frames,
      verticesChecked: vertices,
      armourVisible: false,
    });
  }
const bottle = flaskModel();
const fills = [];
for (const fill of [1, 0.5, 0.1, 0]) {
  setFlaskFill(bottle, fill);
  const liquid = bottle.getObjectByName("FlaskLiquid"),
    g = liquid.geometry;
  g.computeBoundingBox();
  const box = g.boundingBox.clone(),
    p = g.getAttribute("position"),
    n = g.getAttribute("normal");
  let topArea = 0,
    minLevel = Infinity,
    maxLevel = -Infinity,
    surfaceRadius = 0;
  if (fill > 0)
    for (let i = 0; i < g.index.count; i += 3) {
      const vertices = [0, 1, 2].map((k) => g.index.getX(i + k));
      if (
        vertices.every((v) => n.getY(v) > 0.99 && p.getY(v) > box.max.y - 0.001)
      ) {
        const points = vertices.map((v) =>
          new T.Vector3().fromBufferAttribute(p, v),
        );
        topArea +=
          Math.abs(
            (points[1].x - points[0].x) * (points[2].z - points[0].z) -
              (points[1].z - points[0].z) * (points[2].x - points[0].x),
          ) * 0.5;
        for (const v of vertices) {
          minLevel = Math.min(minLevel, p.getY(v));
          maxLevel = Math.max(maxLevel, p.getY(v));
          surfaceRadius = Math.max(
            surfaceRadius,
            Math.hypot(p.getX(v), p.getZ(v)),
          );
        }
      }
    }
  const radius = Math.max(box.max.x, -box.min.x),
    ratio = topArea / (Math.PI * surfaceRadius * surfaceRadius);
  // The bottle narrows near the neck. Compare the level with its own radius,
  // while requiring it to span most of the actual fluid width (a ball cannot).
  if (fill > 0) {
    assert.ok(
      surfaceRadius > radius * 0.65 && ratio > 0.9,
      `Potion ${fill} has a ball/point surface instead of a liquid volume`,
    );
    assert.ok(
      maxLevel - minLevel < 0.0008,
      "Potion meniscus is not a flat level",
    );
  }
  fills.push({
    fill,
    box,
    visible: liquid.visible,
    projectedSurfaceRatio: fill > 0 ? ratio : 0,
    levelSpread: fill > 0 ? maxLevel - minLevel : 0,
  });
}
if (
  !(
    fills[0].box.max.y > fills[1].box.max.y &&
    fills[1].box.max.y > fills[2].box.max.y &&
    fills[3].visible === false
  )
)
  throw Error("Liquid fill levels are not strictly ordered");
for (const fill of fills.slice(0, 3))
  if (
    !Number.isFinite(fill.box.max.y) ||
    fill.box.max.y > 0.232 ||
    fill.box.min.y < 0.012
  )
    throw Error("Liquid outside bottle interior");
for (const result of results)
  if (result.visibleContactFrames)
    failures.push(
      `${result.weapon}/${result.clip}: visible cloth/plate contact in ${result.visibleContactFrames}/${result.frames} frames, max segment ${(result.maxVisibleSegment * 100).toFixed(2)}cm`,
    );
if (maxSeamGap > 0.0001)
  failures.push(`Fitted collar seam opened by ${maxSeamGap} metres`);
assert.ok(
  results.length + unarmouredRolls.length > 0,
  "No selected clips were tested",
);
const report = {
  requestedClips: clipFilter ?? "all",
  requestedWeapons: weaponFilter ?? "all",
  strapPath: compiled.uniforms.new0StrapPath.value.map((p) => p.toArray()),
  head: {
    sourceProbeTriangles: faceTriangles,
    remainingFaceTriangles,
    removedTriangles: originalBody.userData.fixes1HeadTrianglesRemoved,
    variants: heads,
  },
  seam: { vertices: seamSources.length, maxGap: maxSeamGap },
  cloth: results,
  unarmouredRolls,
  liquid: fills,
  uncovered,
  failures,
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      head: report.head,
      seam: report.seam,
      liquid: fills,
      clips: results.length,
      unarmouredRolls,
      visibleContactClips: failures.length,
      uncoveredExamples: uncovered.slice(0, 4),
      failures,
    },
    null,
    2,
  ),
);
assert.equal(
  failures.length,
  0,
  `${failures.length} appearance regressions, see ${reportPath}`,
);
