import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
import * as T from "../../node_modules/three/build/three.module.js";
import {
  forestSupportHeight,
  terrainHeight,
} from "../../src/terrain-height.ts";
import { CRYPT_FURNISHINGS } from "../../src/castle-furnishings.ts";
import { TREES, OBSTACLES } from "../../src/world-layout.ts";

// No WebGL rendering is replaced here. The stub supplies only construction-time
// drawing methods, so the audit can inspect actual generated geometry in Node.
globalThis.document = {
  createElement() {
    const canvas = { width: 256, height: 256 };
    canvas.getContext = () =>
      new Proxy(
        {
          canvas,
          createImageData(w, h) {
            return { data: new Uint8ClampedArray(w * h * 4) };
          },
          createLinearGradient() {
            return { addColorStop() {} };
          },
          createRadialGradient() {
            return { addColorStop() {} };
          },
        },
        { get: (o, k) => (k in o ? o[k] : () => {}) },
      );
    return canvas;
  },
};
globalThis.__ASSET_REVISION__ = "geometry-check";
globalThis.__CLIENT_REVISION__ = "geometry-check";
const { ConnectedEnvironment, LOCATIONS } =
  await import("../../src/locations.ts");
const env = new ConnectedEnvironment({
  load(_path, ready) {
    const t = new T.Texture();
    ready?.(t);
    return t;
  },
});
for (const f of env.assetReview.furnishings) {
  const s = CRYPT_FURNISHINGS[f.index];
  assert(
    f.min[0] >= s.x - s.hx - 0.001 && f.max[0] <= s.x + s.hx + 0.001,
    `${f.kind} x exceeds collider`,
  );
  assert(
    f.min[2] >= s.z - s.hz - 0.001 && f.max[2] <= s.z + s.hz + 0.001,
    `${f.kind} z exceeds collider`,
  );
  assert(
    f.min[1] >= 2.4 - 0.001 && f.max[1] <= 2.4 + s.height + 0.001,
    `${f.kind} y exceeds collider`,
  );
}
assert.equal(env.assetReview.furnishings.length, 8);
assert.equal(new Set(env.assetReview.furnishings.map((f) => f.kind)).size, 4);
// New furniture must not intersect a legacy prop or a structural collider.
// The same matching footprint is its own shared visual/physics record.
for (const f of CRYPT_FURNISHINGS)
  for (const o of OBSTACLES) {
    if (o.x === f.x && o.z === f.z && o.hx === f.hx && o.hz === f.hz) continue;
    const overlapsHeight =
      (o.maxY ?? Infinity) > 2.405 &&
      (o.minY ?? -Infinity) < 2.4 + f.height - 0.005;
    assert(
      !overlapsHeight ||
        Math.abs(f.x - o.x) >= f.hx + o.hx - 0.005 ||
        Math.abs(f.z - o.z) >= f.hz + o.hz - 0.005,
      `Crypt furnishing ${f.kind} at ${f.x},${f.z} intersects ${JSON.stringify(o)}`,
    );
  }
for (const c of env.assetReview.candleFlames) {
  // Atlas alpha begins about 3% above the bottom of the 0.55m plane. Its
  // nominal low edge is -0.065m. Visible fire overlaps the black wick.
  const fireLow = c.flameBase + (-0.065 + 0.03 * 0.55) * c.scale;
  assert(
    fireLow >= c.waxTop - 0.005 && fireLow <= c.wickTop + 0.001,
    "Floating candle flame",
  );
}
assert(env.assetReview.candleFlames.length >= 18);
const m = new T.Matrix4(),
  p = new T.Vector3();
let roots = 0,
  maxRootError = 0;
env.root.traverse((o) => {
  if (o.name.startsWith("BranchedTrunks"))
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      const error = Math.abs(p.y - (forestSupportHeight(p.x, p.z) - 0.07));
      maxRootError = Math.max(maxRootError, error);
      roots++;
      assert(error < 0.00001, "Tree root has a floating support height");
    }
});
assert.equal(roots, TREES.length);
// Independently raycast the actual rendered outer height mesh at each far tree.
const outer = new T.PlaneGeometry(170, 230, 46, 64);
outer.rotateX(-Math.PI / 2);
outer.translate(0, -0.12, -48);
const attr = outer.getAttribute("position");
for (let i = 0; i < attr.count; i++)
  attr.setY(i, terrainHeight(attr.getX(i), attr.getZ(i)));
const ground = new T.Mesh(
  outer,
  new T.MeshBasicMaterial({ side: T.DoubleSide }),
);
ground.updateMatrixWorld();
const ray = new T.Raycaster();
let supported = 0,
  maxSurfaceError = 0;
for (const tree of TREES) {
  if (Math.abs(tree.x) <= 9 && tree.z >= -17 && tree.z <= 14) continue;
  ray.set(new T.Vector3(tree.x, 30, tree.z), new T.Vector3(0, -1, 0));
  const hit = ray.intersectObject(ground)[0];
  assert(hit, "Missing terrain ray");
  const error = Math.abs(hit.point.y - forestSupportHeight(tree.x, tree.z));
  maxSurfaceError = Math.max(maxSurfaceError, error);
  assert(error < 0.000005, "Root support differs from rendered triangle");
  supported++;
}
const fire = env.root.getObjectByName("AlwaysBurningTexturedFlames");
const version = fire.instanceMatrix.version;
for (let i = 0; i < 600; i++)
  env.update(i / 60, { x: 0, y: 2.4, z: -99 }, "crypt", i > 300);
assert.equal(
  fire.instanceMatrix.version,
  version,
  "Fire uploaded instance matrices per frame",
);
let triangles = 0,
  meshes = 0,
  lights = 0,
  nonFogged = 0;
env.root.traverse((o) => {
  if (o.isLight) lights++;
  if (o.isMesh) {
    meshes++;
    const p = o.geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++)
      assert(
        Number.isFinite(p.getX(i)) &&
          Number.isFinite(p.getY(i)) &&
          Number.isFinite(p.getZ(i)),
        "Nonfinite geometry",
      );
    triangles +=
      ((o.geometry.index?.count ?? p.count) / 3) *
      (o.isInstancedMesh ? o.count : 1);
    for (const material of Array.isArray(o.material)
      ? o.material
      : [o.material])
      if (material.fog === false) nonFogged++;
  }
});
assert.equal(
  nonFogged,
  0,
  "A textured scene material opts out of atmospheric fog",
);
assert(lights <= 9, "Unexpected new dynamic light pool");
assert(
  LOCATIONS.crypt.density < LOCATIONS.forest.density &&
    LOCATIONS.chapel.density < LOCATIONS.forest.density,
);
const exit = env.root.getObjectByName("FinalWhiteThreshold");
assert(
  exit && exit.material.opacity > 0.8,
  "Ending threshold does not brighten",
);
const report = {
  furnishings: env.assetReview.furnishings,
  candleFlames: env.assetReview.candleFlames.length,
  roots,
  maxRootError,
  outerRootsRaycast: supported,
  maxSurfaceError,
  fireMatrixUploadsAfter600Frames: fire.instanceMatrix.version - version,
  meshes,
  triangles,
  lights,
  nonFogged,
  endingOpacity: exit.material.opacity,
};
await mkdir("work/fixes2", { recursive: true });
await writeFile(
  "work/fixes2/environment-audit.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
