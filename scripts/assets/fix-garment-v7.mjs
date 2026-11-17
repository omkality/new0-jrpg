/**
 * Garment topology/skin repair for the inspected CC0 Patch woman derivatives.
 * Only prisoner/watcher geometry is writable. Rig, native motion, IBMs and
 * public motion GLBs are protected by semantic hashes. No runtime changes.
 * Run from anywhere with the dependencies pinned in scripts/assets/package.json.
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { Matrix4, Quaternion, Vector3 } from "three";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { structure, sample, world, position } from "./pose-sampling.mjs";
import { animationDigest } from "./animation-io.mjs";

const project = fileURLToPath(new URL("../../", import.meta.url));
const work = resolve(project, "work/assets-v7/garment");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const bytes = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
// Both prepared woman derivatives share these protected source-data hashes.
// Stored here so --check also works in a fresh checkout without ignored backups.
const PROTECTED = {
  nodes: "d29cf882b57ee7bad28d45e3369e60d3ef79606e3e95108455d231c89c6fe4de",
  skins: "19b2cc0f6af3953fa69a1e1fa52c31e6e5c21a4c457c077460376b16cbb3c874",
  motion: "1203b8c7f5fee92d77c0e60c85027eb51fed019eff2d6b6d745f82e06eb8e1ab",
  images: "80948417e88a3ace7ba06d50982100177b562ec2ae139d358ae0582b762a9ebf",
  bodyVertexRecords:
    "438299db72951a1b611a19ac63629fed2b282a01cc47f68492528759c9bc22f5",
};
const fingerprints = (data) =>
  Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      sha(Buffer.from(JSON.stringify(value))),
    ]),
  );

function invariants(doc) {
  const root = doc.getRoot();
  return {
    nodes: root
      .listNodes()
      .filter((n) => !n.getMesh())
      .map((n) => ({
        name: n.getName(),
        p: n.getTranslation(),
        q: n.getRotation(),
        s: n.getScale(),
        children: n
          .listChildren()
          .filter((c) => !c.getMesh())
          .map((c) => c.getName()),
      })),
    skins: root.listSkins().map((s) => ({
      joints: s.listJoints().map((n) => n.getName()),
      skeleton: s.getSkeleton()?.getName() ?? null,
      ibm: sha(bytes(s.getInverseBindMatrices().getArray())),
    })),
    motion: Object.fromEntries(
      root.listAnimations().map((a) => [a.getName(), animationDigest(a)]),
    ),
    images: root
      .listTextures()
      .map((t) => ({ name: t.getName(), hash: sha(t.getImage()) })),
    bodyVertexRecords: Object.fromEntries(
      root
        .listMeshes()
        .find((m) => m.getName().startsWith("tripo_mesh_"))
        .listPrimitives()[0]
        .listSemantics()
        .sort()
        .map((key) => {
          const accessor = root
            .listMeshes()
            .find((m) => m.getName().startsWith("tripo_mesh_"))
            .listPrimitives()[0]
            .getAttribute(key);
          return [
            key,
            {
              type: accessor.getType(),
              values: sha(bytes(accessor.getArray())),
            },
          ];
        }),
    ),
  };
}

function bounds(values) {
  const result = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  for (let i = 0; i < values.length; i += 3)
    for (let k = 0; k < 3; k++) {
      result.min[k] = Math.min(result.min[k], values[i + k]);
      result.max[k] = Math.max(result.max[k], values[i + k]);
    }
  return result;
}
function inspect(doc) {
  const root = doc.getRoot(),
    skin = root.listSkins()[0],
    jointNames = skin.listJoints().map((n) => n.getName());
  const info = structure(doc);
  return {
    joints: Object.fromEntries(
      jointNames.map((n) => [
        n,
        position(info, info.base, info.byName.get(n)).toArray(),
      ]),
    ),
    meshes: root.listMeshes().map((mesh) => ({
      name: mesh.getName(),
      primitives: mesh.listPrimitives().map((p) => {
        const pos = p.getAttribute("POSITION").getArray(),
          joints = p.getAttribute("JOINTS_0").getArray(),
          weights = p.getAttribute("WEIGHTS_0").getArray();
        const totals = new Map();
        for (let i = 0; i < weights.length; i++)
          totals.set(
            jointNames[joints[i]],
            (totals.get(jointNames[joints[i]]) ?? 0) + weights[i],
          );
        const edgeCounts = new Map(),
          welded = new Map(),
          ids = [];
        for (let i = 0; i < pos.length / 3; i++) {
          const key = [0, 1, 2]
            .map((k) => Math.round(pos[i * 3 + k] * 1e5))
            .join(",");
          if (!welded.has(key)) welded.set(key, welded.size);
          ids.push(welded.get(key));
        }
        const ix = p.getIndices().getArray();
        for (let i = 0; i < ix.length; i += 3)
          for (const [a, b] of [
            [ix[i], ix[i + 1]],
            [ix[i + 1], ix[i + 2]],
            [ix[i + 2], ix[i]],
          ]) {
            const u = ids[a],
              v = ids[b];
            if (u === v) continue;
            const key = u < v ? `${u},${v}` : `${v},${u}`;
            edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
          }
        return {
          vertices: pos.length / 3,
          triangles: p.getIndices().getCount() / 3,
          material: p.getMaterial().getName(),
          bounds: bounds(pos),
          weights: Object.fromEntries([...totals].filter(([, v]) => v > 0.001)),
          geometricBoundaryEdges: [...edgeCounts.values()].filter(
            (v) => v === 1,
          ).length,
          nonManifoldEdges: [...edgeCounts.values()].filter((v) => v > 2)
            .length,
        };
      }),
    })),
  };
}

function posedMeshes(info, pose) {
  const output = [],
    cache = new Map();
  for (const node of info.nodes) {
    const mesh = node.getMesh(),
      skin = node.getSkin();
    if (!mesh || !skin) continue;
    const inverse = skin.getInverseBindMatrices().getArray();
    const matrices = skin
      .listJoints()
      .map((n, i) =>
        world(info, pose, n, cache).multiply(
          new Matrix4().fromArray(inverse, i * 16),
        ),
      );
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute("POSITION").getArray(),
        joints = primitive.getAttribute("JOINTS_0").getArray(),
        weights = primitive.getAttribute("WEIGHTS_0").getArray(),
        vertices = [];
      for (let i = 0; i < positions.length / 3; i++) {
        const p = new Vector3().fromArray(positions, i * 3),
          result = new Vector3();
        for (let k = 0; k < 4; k++)
          if (weights[i * 4 + k])
            result.addScaledVector(
              p.clone().applyMatrix4(matrices[joints[i * 4 + k]]),
              weights[i * 4 + k],
            );
        vertices.push(...result.toArray());
      }
      output.push({
        name: mesh.getName(),
        material: primitive.getMaterial().getName(),
        vertices,
        indices: [...primitive.getIndices().getArray()],
      });
    }
  }
  return output;
}

function repair(doc, character) {
  const root = doc.getRoot(),
    skin = root.listSkins()[0],
    joints = skin.listJoints(),
    bone = new Map(joints.map((n, i) => [n.getName(), i]));
  const buffer = root.listBuffers()[0],
    info = structure(doc),
    head = position(info, info.base, info.byName.get("head"));
  const isWatcher = character === "watcher";
  const cloth = root
    .listMaterials()
    .find(
      (m) =>
        m.getName() ===
        (isWatcher ? "original_dark_headwrap" : "original_tattered_linen"),
    );
  const hood = root
    .listMaterials()
    .find((m) => m.getName() === "original_dark_headwrap");
  const changes = [];
  // Seat the existing mask on the face rim instead of leaving the source's
  // forward gap. This changes geometry only, never the shared bone transforms.
  if (!isWatcher) {
    const previous = root.getAsset().extras.new0GarmentV7?.maskSeatOffset ?? 0;
    const delta = -0.03 - previous;
    for (const mesh of root
      .listMeshes()
      .filter((m) =>
        /^(original_porcelain_mask|original_eye_cavity_|original_mask_mouth)/.test(
          m.getName(),
        ),
      ))
      for (const p of mesh.listPrimitives()) {
        const values = p.getAttribute("POSITION").getArray();
        for (let i = 2; i < values.length; i += 3) values[i] += delta;
      }
  }
  for (const node of [...root.listNodes()]) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    if (
      !/^(original_torn_tunic|original_long_observer_robe|original_prisoner_headwrap|original_watcher_hood|original_folded_face_veil|new0_v7_)/.test(
        mesh.getName(),
      )
    )
      continue;
    const accessors = mesh
      .listPrimitives()
      .flatMap((p) => [...p.listAttributes(), p.getIndices()]);
    const primitives = mesh.listPrimitives();
    node.dispose();
    mesh.dispose();
    for (const p of primitives) p.dispose();
    const used = new Set(
      root
        .listMeshes()
        .flatMap((m) =>
          m
            .listPrimitives()
            .flatMap((p) => [...p.listAttributes(), p.getIndices()]),
        ),
    );
    for (const a of accessors) if (a && !used.has(a)) a.dispose();
  }

  function packWeights(entries) {
    const values = entries
        .filter(([, w]) => w > 1e-7)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4),
      total = values.reduce((n, [, w]) => n + w, 0);
    while (values.length < 4) values.push(["pelvis", 0]);
    return {
      j: values.map(([n]) => bone.get(n)),
      w: values.map(([, w]) => w / total),
    };
  }
  const clamp = (v) => Math.max(0, Math.min(1, v));
  function garmentWeights([x, y, z]) {
    if (y > 1.36) {
      const neck = clamp((y - 1.36) / 0.1) * 0.32;
      const shoulder = clamp((Math.abs(x) - 0.09) / 0.13) * 0.18;
      return packWeights([
        ["neck", neck],
        [x > 0 ? "clavicle_L" : "clavicle_R", shoulder],
        ["chest", 0.68 - neck * 0.35 - shoulder],
        ["spine2", 0.32 - neck * 0.65],
      ]);
    }
    const levels = [
      [0.91, "pelvis"],
      [1.05, "spine1"],
      [1.18, "spine2"],
      [1.31, "chest"],
    ];
    if (y >= 0.91) {
      let i = 0;
      while (i < levels.length - 2 && y > levels[i + 1][0]) i++;
      const t = clamp((y - levels[i][0]) / (levels[i + 1][0] - levels[i][0]));
      return packWeights([
        [levels[i][1], 1 - t],
        [levels[i + 1][1], t],
      ]);
    }
    const left = clamp(0.5 + x / 0.23),
      leg = 0.75 * clamp((0.92 - y) / 0.26);
    return packWeights([
      ["pelvis", 1 - leg],
      ["thigh_L", leg * left],
      ["thigh_R", leg * (1 - left)],
    ]);
  }
  function collarWeights([x, y, z]) {
    const neck = 0.45 + 0.4 * clamp((y - 1.405) / 0.09);
    return packWeights([
      ["neck", neck],
      ["chest", 1 - neck],
    ]);
  }
  function rigidHead() {
    return { j: [bone.get("head"), 0, 0, 0], w: [1, 0, 0, 0] };
  }

  function shell(name, ps, ix, uv, material, weightsFor, thickness = 0.007) {
    // Shared periodic ring vertices avoid the former duplicated seam with
    // nonperiodic hem offsets. Every boundary receives an actual thickness rim.
    const normals = ps.map(() => new Vector3()),
      edge = new Map();
    for (let i = 0; i < ix.length; i += 3) {
      const [a, b, c] = ix.slice(i, i + 3),
        normal = new Vector3()
          .fromArray(ps[b])
          .sub(new Vector3().fromArray(ps[a]))
          .cross(
            new Vector3().fromArray(ps[c]).sub(new Vector3().fromArray(ps[a])),
          );
      for (const v of [a, b, c]) normals[v].add(normal);
      for (const [u, v] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        const key = u < v ? `${u},${v}` : `${v},${u}`;
        const item = edge.get(key);
        if (item) item.count++;
        else edge.set(key, { u, v, count: 1 });
      }
    }
    for (const n of normals)
      if (n.lengthSq() < 1e-12) n.set(0, 0, 1);
      else n.normalize();
    const count = ps.length,
      allPositions = [
        ...ps.map((p) => [...p]),
        ...ps.map((p, i) =>
          new Vector3()
            .fromArray(p)
            .addScaledVector(normals[i], -thickness)
            .toArray(),
        ),
      ];
    const indices = [...ix];
    for (let i = 0; i < ix.length; i += 3)
      indices.push(ix[i] + count, ix[i + 2] + count, ix[i + 1] + count);
    let rims = 0;
    for (const { u, v, count: n } of edge.values())
      if (n === 1) {
        indices.push(u, u + count, v, v, u + count, v + count);
        rims++;
      }
    const allUV = [...uv, ...uv],
      js = [],
      ws = [];
    for (let i = 0; i < allPositions.length; i++) {
      const w = weightsFor(ps[i % count]);
      js.push(...w.j);
      ws.push(...w.w);
    }
    // Recompute normals for both walls and the physical edge strips.
    const ns = allPositions.map(() => new Vector3());
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = indices.slice(i, i + 3);
      const n = new Vector3()
        .fromArray(allPositions[b])
        .sub(new Vector3().fromArray(allPositions[a]))
        .cross(
          new Vector3()
            .fromArray(allPositions[c])
            .sub(new Vector3().fromArray(allPositions[a])),
        );
      for (const v of [a, b, c]) ns[v].add(n);
    }
    const attr = (n, t, a) =>
      doc.createAccessor(n).setType(t).setArray(a).setBuffer(buffer);
    const p = doc
      .createPrimitive()
      .setAttribute(
        "POSITION",
        attr(name + "_position", "VEC3", new Float32Array(allPositions.flat())),
      )
      .setAttribute(
        "NORMAL",
        attr(
          name + "_normal",
          "VEC3",
          new Float32Array(ns.flatMap((n) => n.normalize().toArray())),
        ),
      )
      .setAttribute(
        "TEXCOORD_0",
        attr(name + "_uv", "VEC2", new Float32Array(allUV.flat())),
      )
      .setAttribute(
        "JOINTS_0",
        attr(name + "_joints", "VEC4", new Uint16Array(js)),
      )
      .setAttribute(
        "WEIGHTS_0",
        attr(name + "_weights", "VEC4", new Float32Array(ws)),
      )
      .setIndices(attr(name + "_indices", "SCALAR", new Uint16Array(indices)))
      .setMaterial(material);
    const node = doc
      .createNode(name)
      .setMesh(doc.createMesh(name).addPrimitive(p))
      .setSkin(skin);
    root.listScenes()[0].addChild(node);
    changes.push({
      name,
      vertices: allPositions.length,
      triangles: indices.length / 3,
      thickness,
      rimEdges: rims,
    });
    return node;
  }

  function rings(
    name,
    levels,
    material,
    weightsFor,
    { armholes = false, hem = false, thickness = 0.007 } = {},
  ) {
    const seg = 40,
      ps = [],
      uv = [],
      ix = [];
    levels.forEach((l, k) => {
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2,
          fold = 1 + 0.025 * Math.cos(a * 6 + 0.4),
          y =
            l.y +
            (hem && k === levels.length - 1
              ? 0.012 * Math.sin(a * 7) + 0.006 * Math.cos(a * 11)
              : 0);
        ps.push([
          Math.cos(a) * l.rx * fold,
          y,
          (l.cz ?? 0) + Math.sin(a) * l.rz * fold,
        ]);
        uv.push([(i / seg) * 4, (k / (levels.length - 1)) * 4]);
      }
    });
    for (let k = 0; k < levels.length - 1; k++)
      for (let i = 0; i < seg; i++) {
        const a = k * seg + i,
          b = k * seg + ((i + 1) % seg),
          c = a + seg,
          d = b + seg;
        const theta = ((i + 0.5) / seg) * Math.PI * 2,
          y = (levels[k].y + levels[k + 1].y) / 2;
        // Real sleeveless armholes, with closed thickness strips at their edges.
        const sideAngle = Math.asin(Math.abs(Math.sin(theta)));
        if (armholes && ((y - 1.315) / 0.1) ** 2 + (sideAngle / 0.96) ** 2 < 1)
          continue;
        ix.push(a, b, c, b, d, c);
      }
    return shell(name, ps, ix, uv, material, weightsFor, thickness);
  }

  rings(
    isWatcher ? "new0_v7_observer_robe" : "new0_v7_linen_tunic",
    isWatcher
      ? [
          { y: 1.45, rx: 0.086, rz: 0.086 },
          { y: 1.415, rx: 0.245, rz: 0.168 },
          { y: 1.38, rx: 0.224, rz: 0.178 },
          { y: 1.34, rx: 0.211, rz: 0.184 },
          { y: 1.3, rx: 0.2, rz: 0.184 },
          { y: 1.26, rx: 0.196, rz: 0.181 },
          { y: 1.22, rx: 0.193, rz: 0.178 },
          { y: 1.16, rx: 0.189, rz: 0.174 },
          { y: 1.07, rx: 0.19, rz: 0.17 },
          { y: 0.96, rx: 0.208, rz: 0.18 },
          { y: 0.84, rx: 0.245, rz: 0.19 },
          { y: 0.7, rx: 0.27, rz: 0.201 },
          { y: 0.54, rx: 0.285, rz: 0.208 },
          { y: 0.445, rx: 0.295, rz: 0.214 },
        ]
      : [
          { y: 1.45, rx: 0.082, rz: 0.081 },
          { y: 1.415, rx: 0.215, rz: 0.157 },
          { y: 1.38, rx: 0.21, rz: 0.176 },
          { y: 1.34, rx: 0.2, rz: 0.182 },
          { y: 1.3, rx: 0.19, rz: 0.184 },
          { y: 1.26, rx: 0.187, rz: 0.181 },
          { y: 1.22, rx: 0.185, rz: 0.178 },
          { y: 1.16, rx: 0.181, rz: 0.174 },
          { y: 1.07, rx: 0.178, rz: 0.169 },
          { y: 0.97, rx: 0.19, rz: 0.173 },
          { y: 0.88, rx: 0.216, rz: 0.182, cz: -0.005 },
          { y: 0.78, rx: 0.235, rz: 0.19, cz: -0.005 },
          { y: 0.68, rx: 0.248, rz: 0.197, cz: -0.005 },
          { y: 0.6, rx: 0.258, rz: 0.204, cz: -0.005 },
        ],
    cloth,
    garmentWeights,
    { armholes: true, hem: true, thickness: isWatcher ? 0.009 : 0.007 },
  );

  rings(
    "new0_v7_soft_collar",
    [
      { y: 1.5, rx: 0.077, rz: 0.077, cz: 0 },
      { y: 1.465, rx: 0.085, rz: 0.084, cz: -0.004 },
      { y: 1.43, rx: 0.094, rz: 0.09, cz: -0.004 },
      { y: 1.402, rx: 0.111, rz: 0.101, cz: -0.004 },
    ],
    hood,
    collarWeights,
    { thickness: 0.008 },
  );

  // A rounded, closed-backed cloth hood with one deliberate front face opening.
  // The old headwrap was an uncapped partial cylinder with a side slit.
  {
    const seg = 36,
      rows = 12,
      ps = [],
      uv = [],
      ix = [];
    const centre = new Vector3(0, head.y + 0.055, head.z - 0.015);
    const radius = new Vector3(
      isWatcher ? 0.145 : 0.112,
      isWatcher ? 0.176 : 0.134,
      isWatcher ? 0.155 : 0.102,
    );
    const opening = isWatcher ? 0.94 : 0.91;
    for (let k = 0; k < rows; k++)
      for (let i = 0; i < seg; i++) {
        const phi = opening + ((Math.PI - 0.14 - opening) * k) / (rows - 1),
          a = (i / seg) * Math.PI * 2;
        const fold = 1 + 0.012 * Math.cos(a * 8 + phi * 4);
        if (k === 0)
          ps.push([
            Math.cos(a) * (isWatcher ? 0.126 : 0.082),
            head.y +
              (isWatcher ? 0.055 : 0.06) +
              Math.sin(a) * (isWatcher ? 0.145 : 0.109),
            head.z + (isWatcher ? 0.15 : 0.112),
          ]);
        else
          ps.push([
            centre.x + radius.x * Math.sin(phi) * Math.cos(a) * fold,
            centre.y + radius.y * Math.sin(phi) * Math.sin(a) * fold,
            centre.z + radius.z * Math.cos(phi),
          ]);
        uv.push([(i / seg) * 3, (k / (rows - 1)) * 3]);
      }
    for (let k = 0; k < rows - 1; k++)
      for (let i = 0; i < seg; i++) {
        const a = k * seg + i,
          b = k * seg + ((i + 1) % seg),
          c = a + seg,
          d = b + seg;
        ix.push(a, c, b, b, c, d);
      }
    const pole = ps.length;
    ps.push([centre.x, centre.y, centre.z - radius.z]);
    uv.push([0.5, 1]);
    for (let i = 0; i < seg; i++) {
      const a = (rows - 1) * seg + i,
        b = (rows - 1) * seg + ((i + 1) % seg);
      ix.push(a, pole, b);
    }
    shell("new0_v7_rounded_cloth_hood", ps, ix, uv, hood, rigidHead, 0.008);
  }
  if (isWatcher) {
    // The entire oval boundary coincides with the hood opening, including
    // weights. Unlike the former rectangular plane it cannot float away.
    const ps = [[0, head.y + 0.055, head.z + 0.18]],
      uv = [[0.5, 0.5]],
      ix = [],
      seg = 36,
      rows = 8;
    for (let k = 1; k <= rows; k++)
      for (let i = 0; i < seg; i++) {
        const r = k / rows,
          a = (i / seg) * Math.PI * 2,
          x = Math.cos(a) * 0.126 * r;
        ps.push([
          x,
          head.y + 0.055 + Math.sin(a) * 0.145 * r,
          head.z +
            0.15 +
            0.03 * (1 - r * r) +
            0.004 * Math.cos((x / 0.126) * Math.PI * 8) * r * (1 - r),
        ]);
        uv.push([0.5 + x / 0.252, 0.5 + Math.sin(a) * r * 0.5]);
      }
    for (let i = 0; i < seg; i++) ix.push(0, 1 + i, 1 + ((i + 1) % seg));
    for (let k = 0; k < rows - 1; k++)
      for (let i = 0; i < seg; i++) {
        const a = 1 + k * seg + i,
          b = 1 + k * seg + ((i + 1) % seg),
          c = a + seg,
          d = b + seg;
        ix.push(a, c, b, b, c, d);
      }
    shell("new0_v7_compact_face_veil", ps, ix, uv, hood, rigidHead, 0.009);
  }

  // Source skin that is permanently covered must not compete with the garment.
  // Keep all existing body vertex records, weights, face and limb coordinates.
  // Only hidden triangle indices are removed, well inside the garment's edges.
  const body = root
    .listMeshes()
    .find((m) => m.getName().startsWith("tripo_mesh_"));
  const bodyPrimitive = body.listPrimitives()[0],
    positions = bodyPrimitive.getAttribute("POSITION").getArray();
  const js = bodyPrimitive.getAttribute("JOINTS_0").getArray(),
    ws = bodyPrimitive.getAttribute("WEIGHTS_0").getArray(),
    oldIndices = bodyPrimitive.getIndices(),
    ix = oldIndices.getArray();
  function covered(id) {
    const [x, y, z] = positions.subarray(id * 3, id * 3 + 3);
    const weights = new Map();
    for (let k = 0; k < 4; k++)
      weights.set(
        joints[js[id * 4 + k]].getName(),
        (weights.get(joints[js[id * 4 + k]].getName()) ?? 0) + ws[id * 4 + k],
      );
    const w = (names) =>
      names.reduce((n, key) => n + (weights.get(key) ?? 0), 0);
    if (y > 1.465 && w(["head", "neck"]) > 0.65) return true;
    if (
      y > 1.425 &&
      y < 1.482 &&
      Math.abs(x) < 0.065 &&
      z < 0.067 &&
      z > -0.067 &&
      w(["head", "neck"]) > 0.65
    )
      return true;
    if (
      y > 0.875 &&
      y < 1.205 &&
      Math.abs(x) < 0.19 &&
      w(["pelvis", "spine1", "spine2", "chest"]) > 0.7
    )
      return true;
    const minY = isWatcher ? 0.495 : 0.665;
    if (
      y > minY &&
      y < 0.955 &&
      Math.abs(x) < (isWatcher ? 0.31 : 0.235) &&
      w(["pelvis", "thigh_L", "thigh_R", "shin_L", "shin_R"]) > 0.78
    )
      return true;
    return false;
  }
  const kept = [];
  let removed = 0;
  for (let i = 0; i < ix.length; i += 3) {
    if ([ix[i], ix[i + 1], ix[i + 2]].every(covered)) removed++;
    else kept.push(ix[i], ix[i + 1], ix[i + 2]);
  }
  bodyPrimitive.setIndices(
    doc
      .createAccessor("new0_v7_covered_body_indices")
      .setType("SCALAR")
      .setArray(new Uint16Array(kept))
      .setBuffer(buffer),
  );
  oldIndices.dispose();
  const previousRemoved =
    root
      .getAsset()
      .extras.new0GarmentV7?.changes?.find(
        (c) => c.name === "covered_source_body",
      )?.removedTriangles ?? 0;
  changes.push({
    name: "covered_source_body",
    removedTriangles: previousRemoved + removed,
    preservedVertexRecords: positions.length / 3,
  });
  root.getAsset().extras.new0GarmentV7 = {
    revision: isWatcher ? 4 : 3,
    maskSeatOffset: isWatcher ? 0 : -0.03,
    method:
      "Closed cloth shells with thickness rims and armholes, continuous anatomical skin weights, compact hood with joined face edge plus separate collar, removal of permanently covered source triangles",
    changes,
  };
  root.getAsset().extras.license.changes = [
    ...root
      .getAsset()
      .extras.license.changes.filter(
        (c) => !c.startsWith("v7 garment repair:"),
      ),
    "v7 garment repair: original new0 closed cloth shell geometry, anatomical weight fields, compact hood/collar with joined face edge and hidden-source triangle removal. Rig/rest/IBMs/native animations and embedded images retained.",
  ];
  return changes;
}

async function study(doc, character, suffix) {
  const info = structure(doc),
    root = doc.getRoot();
  const motions = await io.read(
    resolve(project, "public/assets/motion/prisoner-combat.glb"),
  );
  const frames = [];
  for (const [family, names] of [
    [root.listAnimations(), ["Walk", "Run"]],
    [
      motions.getRoot().listAnimations(),
      [
        "Guard",
        "Attack1",
        "Attack2",
        "Attack3",
        "DodgeBack",
        "DodgeLeft",
        "DeathFront",
        "DeathBack",
        "DeathSide",
      ],
    ],
  ]) {
    for (const name of names) {
      const a = family.find((a) => a.getName() === name);
      const duration = a.listSamplers()[0].getInput().getArray().at(-1);
      const times =
        name === "Walk"
          ? [0, 0.4, 0.8, 1.2, 1.6, 2]
          : name === "Run"
            ? [0, 0.25, 0.5, 0.75, 1, 1.25]
            : name === "Guard"
              ? [0, 0.4]
              : name.startsWith("Attack")
                ? [0, duration * 0.3, duration * 0.55, duration * 0.8]
                : name.startsWith("Death")
                  ? [0, 0.35, 0.7, 0.95, 1.3, duration]
                  : [0, 0.14, 0.28, 0.4, 0.55, 0.7, 0.82];
      for (const time of times) {
        const pose = sample(info, a, time);
        frames.push({ name, time, meshes: posedMeshes(info, pose) });
      }
    }
  }
  await writeFile(
    resolve(work, `${character}-${suffix}-posed.json`),
    JSON.stringify(frames),
  );
  return frames.length;
}

async function validatePoses(doc, character, floorData = null) {
  const info = structure(doc),
    root = doc.getRoot(),
    motion = await io.read(
      resolve(project, "public/assets/motion/prisoner-combat.glb"),
    );
  const clips = [
    ...root
      .listAnimations()
      .filter((a) => ["Idle", "Walk", "Run"].includes(a.getName())),
    ...motion.getRoot().listAnimations(),
  ];
  const reports = [];
  for (const animation of clips) {
    const duration = animation.listSamplers()[0].getInput().getArray().at(-1),
      samples = Math.ceil(duration * 60) + 1;
    let minimumY = Infinity,
      maximumY = -Infinity,
      maximumVeilSeam = 0,
      minimumCorrectedY = Infinity;
    for (let i = 0; i < samples; i++) {
      const pose = sample(info, animation, Math.min(duration, i / 60)),
        meshes = posedMeshes(info, pose);
      let frameMinimum = Infinity;
      for (const mesh of meshes) {
        assert(
          mesh.vertices.every(Number.isFinite),
          `${character}/${animation.getName()}: nonfinite skin`,
        );
        const ids = new Set(mesh.indices);
        for (const id of ids) {
          minimumY = Math.min(minimumY, mesh.vertices[id * 3 + 1]);
          frameMinimum = Math.min(frameMinimum, mesh.vertices[id * 3 + 1]);
          maximumY = Math.max(maximumY, mesh.vertices[id * 3 + 1]);
        }
      }
      if (floorData) {
        const curve = floorData.profiles[character].clips[animation.getName()];
        assert(
          curve && curve.offsets.length === samples,
          "Floor curve sample contract mismatch",
        );
        minimumCorrectedY = Math.min(
          minimumCorrectedY,
          frameMinimum + curve.offsets[i],
        );
      }
      if (character === "watcher") {
        const hood = meshes.find(
            (m) => m.name === "new0_v7_rounded_cloth_hood",
          ),
          veil = meshes.find((m) => m.name === "new0_v7_compact_face_veil");
        for (let j = 0; j < 36; j++) {
          const a = new Vector3().fromArray(hood.vertices, j * 3),
            b = new Vector3().fromArray(veil.vertices, (1 + 7 * 36 + j) * 3);
          maximumVeilSeam = Math.max(maximumVeilSeam, a.distanceTo(b));
        }
      }
    }
    assert(
      maximumVeilSeam < 1e-6,
      `${character}/${animation.getName()}: face seam opens`,
    );
    if (floorData)
      assert(
        minimumCorrectedY >= 0.008 - 1e-6,
        `${character}/${animation.getName()}: corrected skin below 8mm clearance`,
      );
    reports.push({
      name: animation.getName(),
      samples,
      minimumY,
      maximumY,
      maximumVeilSeam,
      ...(floorData ? { minimumCorrectedY } : {}),
    });
  }
  return reports;
}

async function floorProfile(doc, character, geometryHash) {
  const info = structure(doc),
    root = doc.getRoot();
  const motion = await io.read(
    resolve(
      project,
      `public/assets/motion/${character === "gaoler" ? "gaoler" : "prisoner"}-combat.glb`,
    ),
  );
  const clips = [
    ...root
      .listAnimations()
      .filter((a) => ["Idle", "Walk", "Run"].includes(a.getName())),
    ...motion.getRoot().listAnimations(),
  ];
  assert.equal(
    clips.length,
    19,
    "Expected three native and sixteen combat clips",
  );
  const meshes = [];
  for (const node of info.nodes) {
    const mesh = node.getMesh(),
      skin = node.getSkin();
    if (!mesh || !skin) continue;
    for (const p of mesh.listPrimitives())
      meshes.push({
        pos: p.getAttribute("POSITION").getArray(),
        j: p.getAttribute("JOINTS_0").getArray(),
        w: p.getAttribute("WEIGHTS_0").getArray(),
        used: [...new Set(p.getIndices().getArray())],
        bones: skin.listJoints(),
        inverse: skin.getInverseBindMatrices().getArray(),
      });
  }
  function minimumY(pose) {
    const cache = new Map();
    let minimum = Infinity;
    for (const mesh of meshes) {
      const matrices = mesh.bones.map(
        (n, i) =>
          world(info, pose, n, cache).multiply(
            new Matrix4().fromArray(mesh.inverse, i * 16),
          ).elements,
      );
      for (const id of mesh.used) {
        const x = mesh.pos[id * 3],
          y = mesh.pos[id * 3 + 1],
          z = mesh.pos[id * 3 + 2];
        let py = 0;
        for (let k = 0; k < 4; k++)
          if (mesh.w[id * 4 + k]) {
            const m = matrices[mesh.j[id * 4 + k]];
            py += mesh.w[id * 4 + k] * (m[1] * x + m[5] * y + m[9] * z + m[13]);
          }
        minimum = Math.min(minimum, py);
      }
    }
    return minimum;
  }
  const output = { geometryHash, geometryFile: `${character}.glb`, clips: {} };
  for (const animation of clips) {
    const duration = Math.max(
        ...animation.listSamplers().map((s) => s.getInput().getArray().at(-1)),
      ),
      offsets = [];
    for (let i = 0; i <= Math.ceil(duration * 60); i++) {
      const y = minimumY(sample(info, animation, Math.min(duration, i / 60)));
      assert(Number.isFinite(y));
      offsets.push(
        Math.ceil(
          (animation.getName().startsWith("Death")
            ? 0.008 - y
            : Math.max(0, 0.008 - y)) * 1e6,
        ) / 1e6,
      );
    }
    output.clips[animation.getName()] = { duration, offsets };
  }
  return output;
}

export { floorProfile, invariants, fingerprints, PROTECTED };
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await mkdir(work, { recursive: true });
  const reports = [],
    apply = process.argv.includes("--apply"),
    check = process.argv.includes("--check"),
    rebuild = process.argv.includes("--rebuild"),
    candidateOnly = process.argv.includes("--candidate");
  const floors = {
    version: 1,
    sampleRate: 60,
    clearance: 0.008,
    sampling:
      "time[i]=min(duration,i/sampleRate). Linearly interpolate using the actual shorter final interval. Offsets are nonnegative model-space metres and exclude weapons/props.",
    profiles: {},
  };
  const verifyFloor = process.argv.includes("--verify-floor")
    ? JSON.parse(
        await readFile(
          resolve(project, "public/assets/cast/floor-v7.json"),
          "utf8",
        ),
      )
    : null;
  for (const name of ["prisoner", "watcher"]) {
    const file = resolve(project, `public/assets/cast/${name}.glb`),
      input = rebuild ? resolve(work, `before-${name}.glb`) : file,
      buffer = await readFile(input),
      doc = await io.read(input);
    const protectedBefore = invariants(doc);
    if (process.argv.includes("--fingerprints"))
      console.log(name, JSON.stringify(fingerprints(protectedBefore)));
    const report = {
      name,
      sha256: sha(buffer),
      bytes: buffer.length,
      invariants: protectedBefore,
      inspect: inspect(doc),
    };
    const alreadyFixed =
      doc.getRoot().getAsset().extras.new0GarmentV7?.revision ===
      (name === "watcher" ? 4 : 3);
    if (process.argv.includes("--study") && !apply)
      report.studyFrames = await study(
        doc,
        name,
        alreadyFixed ? "after" : "before",
      );
    if (apply && !alreadyFixed) {
      assert(
        rebuild || !doc.getRoot().getAsset().extras.new0GarmentV7,
        "Updating an earlier garment repair requires --rebuild to restore concealed body indices from the source backup",
      );
      const backup = resolve(work, `before-${name}.glb`);
      try {
        await stat(backup);
      } catch {
        await writeFile(backup, buffer);
      }
      report.changes = repair(doc, name);
      assert.deepEqual(
        invariants(doc),
        protectedBefore,
        "Protected rig/motion/image data changed",
      );
      const candidate = resolve(work, `candidate-${name}.glb`);
      await io.write(candidate, doc);
      const reloaded = await io.read(candidate);
      assert.deepEqual(
        invariants(reloaded),
        protectedBefore,
        "Protected data changed on GLB round-trip",
      );
      const after = await readFile(candidate);
      report.afterSha256 = sha(after);
      report.afterBytes = after.length;
      report.afterInspect = inspect(reloaded);
      if (candidateOnly && process.argv.includes("--poses"))
        report.posedValidation = await validatePoses(reloaded, name);
      if (process.argv.includes("--study"))
        await study(reloaded, name, "after");
      if (!candidateOnly) await writeFile(file, after);
    }
    if (check) {
      assert(alreadyFixed, `${name}: garment v7 repair not applied`);
      assert.deepEqual(
        fingerprints(invariants(doc)),
        PROTECTED,
        `${name}: protected rig/motion/image/body-record data drifted`,
      );
      for (const mesh of report.inspect.meshes.filter((m) =>
        m.name.startsWith("new0_v7_"),
      ))
        for (const primitive of mesh.primitives) {
          assert.equal(
            primitive.geometricBoundaryEdges,
            0,
            `${name}/${mesh.name}: open shell`,
          );
          assert.equal(
            primitive.nonManifoldEdges,
            0,
            `${name}/${mesh.name}: nonmanifold shell`,
          );
        }
      for (const mesh of doc
        .getRoot()
        .listMeshes()
        .filter((m) => m.getName().startsWith("new0_v7_")))
        for (const p of mesh.listPrimitives()) {
          const weights = p.getAttribute("WEIGHTS_0").getArray();
          for (let i = 0; i < weights.length; i += 4) {
            assert(
              Math.abs(
                weights[i] +
                  weights[i + 1] +
                  weights[i + 2] +
                  weights[i + 3] -
                  1,
              ) < 1e-6,
            );
            assert(
              [0, 1, 2, 3].every(
                (k) => weights[i + k] >= 0 && Number.isFinite(weights[i + k]),
              ),
            );
          }
          if (/tunic|robe/.test(mesh.getName())) {
            const ids = p.getAttribute("JOINTS_0").getArray(),
              jointNames = doc
                .getRoot()
                .listSkins()[0]
                .listJoints()
                .map((n) => n.getName());
            for (let i = 0; i < weights.length; i++)
              if (weights[i] > 0)
                assert(
                  !/^(head|upperarm_|forearm_|hand_|shin_|foot_|toe_)/.test(
                    jointNames[ids[i]],
                  ),
                  `${name}/${mesh.getName()}: unrelated limb weight`,
                );
          }
        }
      if (verifyFloor)
        assert.equal(
          verifyFloor.profiles[name].geometryHash,
          sha(buffer),
          `${name}: stale geometry hash in floor table`,
        );
      if (process.argv.includes("--poses"))
        report.posedValidation = await validatePoses(doc, name, verifyFloor);
    }
    if (process.argv.includes("--floor")) {
      assert(
        alreadyFixed && !rebuild,
        `${name}: floor table must use final public geometry`,
      );
      floors.profiles[name] = await floorProfile(doc, name, sha(buffer));
    }
    reports.push(report);
  }
  await writeFile(
    resolve(
      work,
      candidateOnly
        ? "candidate-report.json"
        : apply
          ? "repair-report.json"
          : check
            ? "check-report.json"
            : "before-inspection.json",
    ),
    JSON.stringify(reports, null, 2),
  );
  console.log(
    JSON.stringify(
      reports.map(({ invariants, inspect, afterInspect, ...r }) => r),
      null,
      2,
    ),
  );
  if (process.argv.includes("--floor")) {
    const output = resolve(project, "public/assets/cast/floor-v7.json"),
      encoded = JSON.stringify(floors) + "\n";
    await writeFile(output, encoded);
    console.log(
      JSON.stringify({
        floorTableBytes: Buffer.byteLength(encoded),
        sampleCounts: Object.fromEntries(
          Object.entries(floors.profiles).map(([n, p]) => [
            n,
            Object.values(p.clips).reduce(
              (sum, c) => sum + c.offsets.length,
              0,
            ),
          ]),
        ),
      }),
    );
  }
}
