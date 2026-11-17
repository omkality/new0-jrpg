// Fitted cloth shares the source surface and exact skin weights. Grip morphs
// close the source's unrigged fingers, preserving every base vertex and clip.
import { NodeIO, PropertyType } from "@gltf-transform/core";
import { prune } from "@gltf-transform/functions";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Matrix4,
  Vector3,
} from "three";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import {
  invariants,
  fingerprints,
  PROTECTED,
  floorProfile,
} from "./fix-garment-v7.mjs";
const project = fileURLToPath(new URL("../../", import.meta.url));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const apply = process.argv.includes("--apply");
await mkdir(resolve(project, "work/gear-v8/cast"), { recursive: true });
function bodyOf(doc) {
  return doc
    .getRoot()
    .listMeshes()
    .find((m) => m.getName().startsWith("tripo_mesh_"))
    .listPrimitives()[0];
}
function author(doc, id) {
  const root = doc.getRoot(),
    body = bodyOf(doc),
    skin = root.listSkins()[0],
    buffer = root.listBuffers()[0];
  const attr = (name, type, array) =>
    doc.createAccessor(name).setType(type).setArray(array).setBuffer(buffer);
  const ps = body.getAttribute("POSITION").getArray(),
    ns = body.getAttribute("NORMAL").getArray(),
    js = body.getAttribute("JOINTS_0").getArray(),
    ws = body.getAttribute("WEIGHTS_0").getArray();
  const joints = skin.listJoints().map((n) => n.getName());
  // The 22-joint licensed sources have no finger joints. Two additive targets
  // curl the original fingers around the handle. Open hands remain available.
  for (const target of [...body.listTargets()]) {
    body.removeTarget(target);
    target.dispose();
  }
  for (const side of ["R", "L"]) {
    const handIndex = joints.indexOf("hand_" + side),
      rightIndex = joints.indexOf("hand_R");
    const inverse = new Matrix4().fromArray(
        skin.getInverseBindMatrices().getArray(),
        rightIndex * 16,
      ),
      bind = inverse.clone().invert();
    const delta = new Float32Array(ps.length),
      closed = new Float32Array(ps),
      ogre = id === "gaoler";
    const knuckle = ogre ? 0.157 : 0.078,
      radius = ogre ? 0.033 : 0.018,
      centerX = ogre ? -0.026 : 0;
    for (let i = 0; i < ps.length / 3; i++) {
      let weight = 0;
      for (let k = 0; k < 4; k++)
        if (js[i * 4 + k] === handIndex) weight += ws[i * 4 + k];
      if (weight < 0.25) continue;
      const original = new Vector3().fromArray(ps, i * 3),
        canonical = original.clone();
      if (side === "L") canonical.x *= -1;
      canonical.applyMatrix4(inverse);
      const p = canonical.clone();
      if (p.y > knuckle) {
        const angle = Math.min(3.05, (p.y - knuckle) / radius),
          thickness = p.x - centerX;
        p.x =
          centerX +
          radius * (1 - Math.cos(angle)) +
          thickness * Math.cos(angle);
        p.y = knuckle + radius * Math.sin(angle) - thickness * Math.sin(angle);
        p.z = (p.z + (ogre ? 0.045 : 0)) * 0.86 - (ogre ? 0.045 : 0);
      } else if (!ogre && p.x > 0.016 && p.y > 0.035) {
        // Fold the thumb across the side of the wrapped index finger.
        const t = Math.min(1, (p.x - 0.016) / 0.025);
        p.y += 0.027 * t;
        p.x -= 0.008 * t;
      }
      p.applyMatrix4(bind);
      if (side === "L") p.x *= -1;
      p.sub(original).multiplyScalar(Math.min(1, weight / 0.8));
      for (let k = 0; k < 3; k++) {
        delta[i * 3 + k] = p.getComponent(k);
        closed[i * 3 + k] += p.getComponent(k);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(closed, 3));
    geometry.setIndex([...body.getIndices().getArray()]);
    geometry.computeVertexNormals();
    const normals = geometry.getAttribute("normal").array,
      normalDelta = new Float32Array(ns.length);
    for (let i = 0; i < ns.length; i++) {
      const v = Math.floor(i / 3) * 3;
      if (
        Math.abs(delta[v]) + Math.abs(delta[v + 1]) + Math.abs(delta[v + 2]) >
        1e-8
      )
        normalDelta[i] = normals[i] - ns[i];
    }
    geometry.dispose();
    body.addTarget(
      doc
        .createPrimitiveTarget("new0Grip" + side)
        .setAttribute("POSITION", attr("grip_" + side, "VEC3", delta))
        .setAttribute(
          "NORMAL",
          attr("grip_normal_" + side, "VEC3", normalDelta),
        ),
    );
  }
  const bodyMesh = root
    .listMeshes()
    .find((m) => m.listPrimitives().includes(body));
  bodyMesh.setWeights([0, 0]);
  bodyMesh.setExtras({
    ...bodyMesh.getExtras(),
    targetNames: ["new0GripR", "new0GripL"],
  });
  if (id !== "gaoler") {
    for (const node of [...root.listNodes()])
      if (
        /new0_v[78]_(linen_tunic|observer_robe|fitted_)/.test(
          node.getMesh()?.getName() ?? "",
        )
      ) {
        const mesh = node.getMesh();
        node.dispose();
        for (const p of mesh.listPrimitives()) p.dispose();
        mesh.dispose();
      }
    const clothMaterial = root
      .listMaterials()
      .find(
        (m) =>
          m.getName() ===
          (id === "prisoner"
            ? "original_tattered_linen"
            : "original_dark_headwrap"),
      );
    function cloth(name, select, offset, minimum = 3) {
      const originalIx = body.getIndices().getArray(),
        ix = [];
      for (let i = 0; i < originalIx.length; i += 3)
        if (
          [originalIx[i], originalIx[i + 1], originalIx[i + 2]].filter(select)
            .length >= minimum
        )
          ix.push(originalIx[i], originalIx[i + 1], originalIx[i + 2]);
      const used = [...new Set(ix)],
        remap = new Map(used.map((n, i) => [n, i])),
        p = [],
        n = [],
        j = [],
        w = [],
        uv = [];
      for (const index of used) {
        for (let k = 0; k < 3; k++) {
          p.push(ps[index * 3 + k] + ns[index * 3 + k] * offset);
          n.push(ns[index * 3 + k]);
        }
        j.push(...js.subarray(index * 4, index * 4 + 4));
        w.push(...ws.subarray(index * 4, index * 4 + 4));
        uv.push(ps[index * 3] * 7, ps[index * 3 + 1] * 7);
      }
      const primitive = doc
        .createPrimitive()
        .setAttribute(
          "POSITION",
          attr(name + "_position", "VEC3", new Float32Array(p)),
        )
        .setAttribute(
          "NORMAL",
          attr(name + "_normal", "VEC3", new Float32Array(n)),
        )
        .setAttribute(
          "TEXCOORD_0",
          attr(name + "_uv", "VEC2", new Float32Array(uv)),
        )
        .setAttribute(
          "JOINTS_0",
          attr(name + "_joints", "VEC4", new Uint16Array(j)),
        )
        .setAttribute(
          "WEIGHTS_0",
          attr(name + "_weights", "VEC4", new Float32Array(w)),
        )
        .setIndices(
          attr(
            name + "_indices",
            "SCALAR",
            new Uint16Array(ix.map((v) => remap.get(v))),
          ),
        )
        .setMaterial(clothMaterial);
      const node = doc
        .createNode(name)
        .setMesh(doc.createMesh(name).addPrimitive(primitive))
        .setSkin(skin);
      root.listScenes()[0].addChild(node);
      return { vertices: used.length, triangles: ix.length / 3, offset };
    }
    const weight = (i, rx) => {
      let t = 0;
      for (let k = 0; k < 4; k++)
        if (rx.test(joints[js[i * 4 + k]])) t += ws[i * 4 + k];
      return t;
    };
    const shirt = cloth(
      "new0_v8_fitted_" + (id === "prisoner" ? "linen" : "observer"),
      (i) => {
        if (weight(i, /^(head|hand_)/) > 0.22) return false;
        const arm = weight(i, /^(upperarm_|forearm_|clavicle_)/) > 0.4;
        return (
          arm ||
          (ps[i * 3 + 1] > 0.88 &&
            ps[i * 3 + 1] < 1.45 &&
            weight(i, /^(pelvis|spine|chest|neck)/) > 0.5)
        );
      },
      0.011,
    );
    const trousers = cloth(
      "new0_v8_fitted_trousers",
      (i) =>
        ps[i * 3 + 1] < 1.04 &&
        ps[i * 3 + 1] > 0.17 &&
        weight(i, /^(pelvis|spine1|thigh_|shin_)/) > 0.4,
      0.007,
      2,
    );
    root.getAsset().extras.new0FittedV8 = {
      revision: 2,
      shirt,
      trousers,
      method:
        "Source surface plus 11 mm shirt / 7 mm trousers, identical source joint weights. Original base vertex records and native clips retained. No free hanging tube.",
    };
  }
  root.getAsset().extras.new0GripV8 = {
    revision: 1,
    targets: ["new0GripR", "new0GripL"],
    method:
      "Additive source-finger curl morphs, no new rigid hands or changed rig.",
  };
  return doc;
}
const reports = [];
for (const id of ["prisoner", "watcher", "gaoler"]) {
  const path = resolve(project, `public/assets/cast/${id}.glb`);
  let doc = await io.read(path);
  if (apply) {
    await writeFile(
      resolve(project, `work/gear-v8/cast/before-${id}.glb`),
      await readFile(path),
    );
    const before = invariants(doc);
    if (id !== "gaoler") {
      const raw = await readFile(
        resolve(project, "scripts/assets/seeds/woman-body-indices.u16"),
      );
      bodyOf(doc).setIndices(
        doc
          .createAccessor("restored_source_indices")
          .setType("SCALAR")
          .setArray(
            new Uint16Array(
              raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
            ),
          )
          .setBuffer(doc.getRoot().listBuffers()[0]),
      );
    }
    author(doc, id);
    assert.deepEqual(
      invariants(doc),
      before,
      "Base rig, body vertex records, native motion and images must remain identical",
    );
    await doc.transform(
      prune({
        propertyTypes: [PropertyType.ACCESSOR, PropertyType.BUFFER],
        keepAttributes: true,
        keepLeaves: true,
        keepExtras: true,
        keepSolidTextures: true,
      }),
    );
    assert.deepEqual(invariants(doc), before);
    await io.write(path, doc);
    doc = await io.read(path);
  }
  if (id !== "gaoler")
    assert.deepEqual(
      fingerprints(invariants(doc)),
      PROTECTED,
      "Protected base data drift",
    );
  assert.equal(bodyOf(doc).listTargets().length, 2);
  assert(doc.getRoot().getAsset().extras.new0GripV8);
  if (id !== "gaoler") {
    const meshes = doc.getRoot().listMeshes();
    assert(
      !meshes.some((m) =>
        /new0_v7_(linen_tunic|observer_robe)/.test(m.getName()),
      ),
    );
    assert(meshes.some((m) => m.getName().startsWith("new0_v8_fitted_")));
  }
  reports.push({
    id,
    sha256: sha(await readFile(path)),
    grips: 2,
    fitted: doc.getRoot().getAsset().extras.new0FittedV8 ?? null,
  });
}
if (process.argv.includes("--floor")) {
  const path = resolve(project, "public/assets/cast/floor-v7.json"),
    floor = JSON.parse(await readFile(path, "utf8"));
  floor.version = 2;
  floor.sampling =
    "time[i]=min(duration,i/sampleRate). Linear interpolation uses the shorter final interval. Model-space metres, nonnegative except signed Death corrections to seat the fallen body. Props and weapons excluded.";
  for (const id of ["prisoner", "watcher", "gaoler"])
    floor.profiles[id] = await floorProfile(
      await io.read(resolve(project, `public/assets/cast/${id}.glb`)),
      id,
      reports.find((r) => r.id === id).sha256,
    );
  await writeFile(path, JSON.stringify(floor) + "\n");
}
await writeFile(
  resolve(project, "work/gear-v8/cast/fitted-report.json"),
  JSON.stringify(reports, null, 2),
);
console.log(JSON.stringify(reports, null, 2));
