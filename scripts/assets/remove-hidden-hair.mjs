/**
 * Remove the source topknot hidden under the prisoner/watcher head cloth.
 * Pure Node.js, no image/geometry packages and no machine-specific paths.
 *
 * node scripts/assets/remove-hidden-hair.mjs --check
 * node scripts/assets/remove-hidden-hair.mjs
 *
 * The cut is specific to the inspected, metre-scale Patch woman source.
 * It removes rendered triangles, compacts the complete interleaved body
 * records (including skin weights), and preserves all other buffer data.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const TYPE_WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const COMPONENT_BYTES = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
const aligned = (n) => (n + 3) & ~3;

export function parseGlb(buffer) {
  assert.equal(buffer.readUInt32LE(0), 0x46546c67, "Expected binary glTF");
  assert.equal(buffer.readUInt32LE(4), 2, "Expected glTF 2");
  assert.equal(buffer.readUInt32LE(8), buffer.length, "Invalid GLB length");
  const jsonLength = buffer.readUInt32LE(12);
  assert.equal(buffer.readUInt32LE(16), 0x4e4f534a, "Expected JSON first");
  const json = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength).trim());
  const binStart = 20 + jsonLength;
  assert.equal(
    buffer.readUInt32LE(binStart + 4),
    0x004e4942,
    "Expected BIN chunk",
  );
  const binary = buffer.subarray(
    binStart + 8,
    binStart + 8 + buffer.readUInt32LE(binStart),
  );
  assert.equal(
    json.buffers.length,
    1,
    "Only embedded single-buffer assets are supported",
  );
  assert(
    !json.extensionsRequired?.length,
    "Decode compressed assets before this operation",
  );
  return { json, binary };
}
function accessorBytes(parsed, index) {
  const a = parsed.json.accessors[index],
    v = parsed.json.bufferViews[a.bufferView];
  assert(!a.sparse, "Sparse data is not supported by this operation");
  const size = TYPE_WIDTH[a.type] * COMPONENT_BYTES[a.componentType],
    stride = v.byteStride || size;
  const out = Buffer.alloc(a.count * size);
  for (let i = 0; i < a.count; i++)
    parsed.binary.copy(
      out,
      i * size,
      (v.byteOffset || 0) + (a.byteOffset || 0) + i * stride,
      (v.byteOffset || 0) + (a.byteOffset || 0) + i * stride + size,
    );
  return out;
}
function bodyPrimitive(parsed) {
  const j = parsed.json;
  assert.equal(
    j.asset.extras?.new0Character?.source,
    "Patch woman",
    "This operation only supports the inspected Patch woman derivatives",
  );
  const mesh = j.meshes.find((m) => m.name?.startsWith("tripo_mesh_"));
  assert(mesh, "Source body mesh missing");
  const primitive = mesh.primitives.find(
    (p) => j.materials[p.material]?.name === "woman",
  );
  assert(primitive, "Source woman primitive missing");
  return primitive;
}
function componentRead(buffer, type, offset) {
  if (type === 5123) return buffer.readUInt16LE(offset);
  if (type === 5125) return buffer.readUInt32LE(offset);
  throw new Error(`Unsupported index type ${type}`);
}
function componentWrite(buffer, type, value, offset) {
  if (type === 5123) buffer.writeUInt16LE(value, offset);
  else if (type === 5125) buffer.writeUInt32LE(value, offset);
  else throw new Error(`Unsupported index type ${type}`);
}
// Source inspection: the knot is the rear upper head lobe, approximately
// X[-.085,.085], Y[1.58,1.70], Z[-.170,-.065]. It is painted hair and entirely
// behind the cloth. The visible skin/face is farther forward along +Z.
const hiddenHair = (x, y, z) => Math.abs(x) < 0.11 && y >= 1.58 && z <= -0.065;
export function inspectHiddenHair(buffer) {
  const parsed = parseGlb(buffer),
    p = bodyPrimitive(parsed),
    j = parsed.json;
  const positions = accessorBytes(parsed, p.attributes.POSITION);
  const indices = accessorBytes(parsed, p.indices),
    type = j.accessors[p.indices].componentType,
    width = COMPONENT_BYTES[type];
  const vertices = Array.from({ length: positions.length / 12 }, (_, i) => [
    positions.readFloatLE(i * 12),
    positions.readFloatLE(i * 12 + 4),
    positions.readFloatLE(i * 12 + 8),
  ]);
  const removed = [],
    kept = [];
  for (let i = 0; i < indices.length / width; i += 3) {
    const tri = [0, 1, 2].map((k) =>
      componentRead(indices, type, (i + k) * width),
    );
    if (tri.some((id) => hiddenHair(...vertices[id]))) removed.push(tri);
    else kept.push(...tri);
  }
  const removedPoints = removed.flatMap((tri) => tri.map((id) => vertices[id]));
  const bounds = removedPoints.length
    ? {
        min: [0, 1, 2].map((k) => Math.min(...removedPoints.map((v) => v[k]))),
        max: [0, 1, 2].map((k) => Math.max(...removedPoints.map((v) => v[k]))),
      }
    : null;
  if (bounds) {
    // Guard against accidental deletion of forward skin, eyes, nose or mask.
    assert(bounds.max[2] < 0.025, "Hair cut unexpectedly reaches forward skin");
    assert(bounds.min[1] > 1.53, "Hair cut unexpectedly reaches the neck");
    assert(
      bounds.min[0] > -0.13 && bounds.max[0] < 0.13,
      "Hair cut unexpectedly reaches outside the head",
    );
  }
  return {
    parsed,
    primitive: p,
    kept,
    removed,
    vertices,
    removedBounds: bounds,
  };
}
function invariantDigest(parsed, body) {
  const j = parsed.json;
  const otherPrimitives = j.meshes
    .flatMap((m) => m.primitives)
    .filter((p) => p !== body)
    .map((p) => ({
      attributes: Object.fromEntries(
        Object.entries(p.attributes).map(([k, v]) => [
          k,
          sha(accessorBytes(parsed, v)),
        ]),
      ),
      indices: sha(accessorBytes(parsed, p.indices)),
      material: p.material,
    }));
  const clips = j.animations.map((a) => ({
    name: a.name,
    channels: a.channels,
    samplers: a.samplers.map((s) => ({
      interpolation: s.interpolation,
      input: sha(accessorBytes(parsed, s.input)),
      output: sha(accessorBytes(parsed, s.output)),
    })),
  }));
  const binds = j.skins.map((s) => ({
    joints: s.joints,
    skeleton: s.skeleton,
    inverseBindMatrices: sha(accessorBytes(parsed, s.inverseBindMatrices)),
  }));
  const images = j.images.map((i) =>
    sha(
      parsed.binary.subarray(
        j.bufferViews[i.bufferView].byteOffset,
        j.bufferViews[i.bufferView].byteOffset +
          j.bufferViews[i.bufferView].byteLength,
      ),
    ),
  );
  return {
    nodes: j.nodes,
    skins: binds,
    clips,
    otherPrimitives,
    materials: j.materials,
    images,
  };
}
function encodeGlb(json, views) {
  let cursor = 0;
  const chunks = [];
  json.bufferViews.forEach((view, i) => {
    const data = views.get(i);
    assert(data);
    view.byteOffset = cursor;
    view.byteLength = data.length;
    chunks.push(data, Buffer.alloc(aligned(data.length) - data.length));
    cursor += aligned(data.length);
  });
  const binary = Buffer.concat(chunks);
  json.buffers[0].byteLength = binary.length;
  const encoded = Buffer.from(JSON.stringify(json));
  const text = Buffer.concat([
    encoded,
    Buffer.alloc(aligned(encoded.length) - encoded.length, 0x20),
  ]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + text.length + binary.length, 8);
  header.writeUInt32LE(text.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binary.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, text, binHeader, binary]);
}
export function removeHiddenHair(buffer) {
  const inspection = inspectHiddenHair(buffer),
    { parsed, primitive, removed, kept, removedBounds } = inspection,
    j = parsed.json;
  if (!removed.length)
    return {
      buffer,
      report: {
        changed: false,
        removedTriangles: 0,
        beforeBytes: buffer.length,
        afterBytes: buffer.length,
      },
    };
  const invariantBefore = invariantDigest(parsed, primitive);
  const attributeIds = Object.values(primitive.attributes),
    position = j.accessors[primitive.attributes.POSITION];
  const vertexViewId = position.bufferView,
    vertexView = j.bufferViews[vertexViewId],
    stride = vertexView.byteStride;
  assert(stride, "Expected interleaved body records");
  assert(
    attributeIds.every((i) => j.accessors[i].bufferView === vertexViewId),
    "Expected a single body vertex buffer view",
  );
  assert(
    j.accessors.every(
      (a, i) => a.bufferView !== vertexViewId || attributeIds.includes(i),
    ),
    "Body buffer view is shared with unrelated data",
  );
  const used = [...new Set(kept)].sort((a, b) => a - b),
    remap = new Map(used.map((v, i) => [v, i]));
  const views = new Map(
    j.bufferViews.map((v, i) => [
      i,
      Buffer.from(
        parsed.binary.subarray(
          v.byteOffset || 0,
          (v.byteOffset || 0) + v.byteLength,
        ),
      ),
    ]),
  );
  const oldRecords = views.get(vertexViewId),
    records = Buffer.alloc(used.length * stride);
  used.forEach((v, i) =>
    oldRecords.copy(records, i * stride, v * stride, v * stride + stride),
  );
  views.set(vertexViewId, records);
  const beforeVertices = position.count;
  for (const id of attributeIds) j.accessors[id].count = used.length;
  const newPositions = used.map((i) => inspection.vertices[i]);
  position.min = [0, 1, 2].map((k) =>
    Math.min(...newPositions.map((v) => v[k])),
  );
  position.max = [0, 1, 2].map((k) =>
    Math.max(...newPositions.map((v) => v[k])),
  );
  const index = j.accessors[primitive.indices],
    indexViewId = index.bufferView,
    width = COMPONENT_BYTES[index.componentType],
    offset = index.byteOffset || 0,
    oldLength = index.count * width;
  const indices = Buffer.alloc(kept.length * width);
  kept.forEach((v, i) =>
    componentWrite(indices, index.componentType, remap.get(v), i * width),
  );
  const oldIndices = views.get(indexViewId),
    end = offset + oldLength,
    removedBytes = oldLength - indices.length;
  views.set(
    indexViewId,
    Buffer.concat([
      oldIndices.subarray(0, offset),
      indices,
      oldIndices.subarray(end),
    ]),
  );
  for (const [i, a] of j.accessors.entries())
    if (a.bufferView === indexViewId && i !== primitive.indices) {
      const start = a.byteOffset || 0;
      assert(
        start >= end ||
          start +
            TYPE_WIDTH[a.type] * COMPONENT_BYTES[a.componentType] * a.count <=
            offset,
        "Unrelated accessor overlaps body index range",
      );
      if (start >= end) a.byteOffset = start - removedBytes;
    }
  index.count = kept.length;
  if (index.min) index.min = [0];
  if (index.max) index.max = [used.length - 1];
  const changes = j.asset.extras.license.changes || [];
  j.asset.extras.license.changes = [
    ...changes.filter((s) => !s.startsWith("Removed hidden source topknot")),
    "Removed hidden source topknot/hair triangles behind the head cloth; compacted all body vertex attributes without changing rig, clothing, skin, mask or motion data.",
  ];
  j.asset.extras.new0Character.hiddenHairRemoval = {
    region: "rear upper source head",
    removedTriangles: removed.length,
    removedVertices: beforeVertices - used.length,
    method: "triangle removal and interleaved body record compaction",
  };
  const output = encodeGlb(j, views),
    after = parseGlb(output),
    afterPrimitive = bodyPrimitive(after);
  assert.deepEqual(
    invariantDigest(after, afterPrimitive),
    invariantBefore,
    "Unrelated rig/motion/material/garment/image data changed",
  );
  assert.equal(
    inspectHiddenHair(output).removed.length,
    0,
    "Hidden topknot triangles remain",
  );
  return {
    buffer: output,
    report: {
      changed: true,
      removedTriangles: removed.length,
      removedVertices: beforeVertices - used.length,
      beforeVertices,
      afterVertices: used.length,
      removedBounds,
      beforeBytes: buffer.length,
      afterBytes: output.length,
      preserved: [
        "all node names/hierarchy/rest TRS",
        "inverse bind matrices",
        "all animation channels and accessor values",
        "all non-body mesh attribute/index values",
        "materials and embedded images",
      ],
      rigHash: sha(Buffer.from(JSON.stringify(invariantBefore.nodes))),
    },
  };
}

async function main() {
  const check = process.argv.includes("--check"),
    reports = [];
  const reportDir = path.join(PROJECT_ROOT, "work/assets-v4");
  await mkdir(reportDir, { recursive: true });
  for (const name of ["prisoner", "watcher"]) {
    const file = path.join(PROJECT_ROOT, "public/assets/cast", `${name}.glb`),
      before = await readFile(file);
    if (check) {
      const result = inspectHiddenHair(before);
      reports.push({
        name,
        remainingHiddenHairTriangles: result.removed.length,
      });
      continue;
    }
    const backup = path.join(reportDir, `hair-fix-before-${name}.glb`);
    try {
      await stat(backup);
    } catch {
      await writeFile(backup, before);
    }
    const result = removeHiddenHair(before);
    if (result.report.changed) await writeFile(file, result.buffer);
    reports.push({ name, ...result.report });
  }
  console.log(JSON.stringify(reports, null, 2));
  if (check) {
    if (reports.some((r) => r.remainingHiddenHairTriangles > 0))
      process.exitCode = 1;
  } else
    await writeFile(
      path.join(reportDir, "hair-fix-report.json"),
      JSON.stringify(reports, null, 2),
    );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await main();
