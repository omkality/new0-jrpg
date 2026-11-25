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
import {
  TREES,
  OBSTACLES,
  ARCH_PORTALS,
  floorHeight,
} from "../../src/world-layout.ts";

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
// Trace the actual batched masonry. A ground plane can pass a walking test
// while exposing empty sky below the landing from the approach camera.
env.root.updateMatrixWorld(true);
const structuralRay = new T.Raycaster();
const structure = new Map(
  ["roofs", "chapel", "crypt", "world"].map((area) => {
    const meshes = [];
    env.root.getObjectByName(area).traverse((o) => {
      if (
        o.isMesh &&
        o.material.isMeshStandardMaterial &&
        !o.material.transparent
      )
        meshes.push(o);
    });
    return [area, meshes];
  }),
);
function stoneHit(area, x, y, z, dx, dy, dz, far) {
  structuralRay.set(new T.Vector3(x, y, z), new T.Vector3(dx, dy, dz));
  structuralRay.far = far;
  return structuralRay.intersectObjects(structure.get(area), false)[0];
}
let courtSamples = 0,
  faced = 0;
for (const x of [-7.03, -5, -2.55, -1, 0, 2.55, 5, 7.03])
  for (let z = -16.16; z > -23.9; z -= 0.32) {
    const y = floorHeight(x, z);
    assert(
      stoneHit("roofs", x, y + 0.18, z, 0, -1, 0, 0.31),
      `Unsupported courtyard at ${x}, ${z}`,
    );
    courtSamples++;
  }
for (const x of [-6.9, -4.3, 4.3, 6.9])
  for (const y of [0.2, 0.9, 1.55, 2.25]) {
    assert(
      stoneHit("roofs", x, y, -15.9, 0, 0, -1, 6.5),
      `Daylight below the landing at ${x}, ${y}`,
    );
    faced++;
  }
for (const side of [-1, 1])
  for (const z of [-22.75, -24.5, -28.3, -33.2])
    for (const y of [0.2, 1.2, 2.16]) {
      assert(
        stoneHit("roofs", side * 8.35, y, z, -side, 0, 0, 0.95),
        "Open side below the raised yard",
      );
      faced++;
    }
for (const p of ARCH_PORTALS) {
  for (const side of [-1, 1]) {
    for (const x of [-0.75, 0, 0.75])
      assert(
        !stoneHit(p.area, x, p.base + 1.65, p.z + side * 0.8, 0, 0, -side, 1.6),
        "Masonry blocks the passage beneath the arch",
      );
    for (const x of [-1.85, 0, 1.85]) {
      const archY = p.base + p.stem + Math.sqrt(p.radius ** 2 - x ** 2);
      for (const y of [archY + 0.04, p.base + p.wallHeight - 0.08])
        assert(
          stoneHit(p.area, x, y, p.z + side, 0, 0, -side, 1.5),
          `Open spandrel at ${p.z}, ${x}, ${y}`,
        );
    }
  }
}
// Daylight used to show between the timber leaf and the gallery arch.
let solidVestrySamples = 0,
  passageFloorSamples = 0;
for (const side of [-1, 1])
  for (const x of [4.64, 5, 5.36])
    for (const y of [7.46, 7.69, 7.86]) {
      assert(
        stoneHit("chapel", x, y, -60.4 + side * 0.62, 0, 0, -side, 1.15),
        `Daylight through the vestry tympanum at ${x}, ${y}, side ${side}`,
      );
      solidVestrySamples++;
    }
const galleryLeaf = env.vestryDoor.getObjectByName("DoorPivot");
for (const angle of [0, 1.65, -1.65]) {
  galleryLeaf.rotation.y = angle;
  env.root.updateMatrixWorld(true);
  for (const side of [-1, 1]) {
    assert.equal(
      !!stoneHit("chapel", 5, 6.45, -60.4 + side * 0.85, 0, 0, -side, 1.6),
      angle === 0,
      "Door leaf and passage disagree",
    );
    assert(
      stoneHit("chapel", 5, 7.68, -60.4 + side * 0.85, 0, 0, -side, 1.6),
      "The transom moved with the door",
    );
  }
}
galleryLeaf.rotation.y = 0;
env.root.updateMatrixWorld(true);
for (const z of [-69.8, -70.4, -72, -74.8, -75.9, -76.3, -77.2]) {
  for (const x of [-1.52, 0, 1.52]) {
    const owners = ["chapel", "crypt"].filter((sector) =>
      stoneHit(sector, x, 2.46, z, 0, -1, 0, 0.14),
    );
    assert.equal(
      owners.length,
      1,
      "Missing or overlapping pavement in the ossuary passage",
    );
    passageFloorSamples++;
  }
  for (const side of [-1, 1])
    assert(
      stoneHit("chapel", 0, 3.5, z, side, 0, 0, 3.1),
      "Open flank in the ossuary passage",
    );
}
let gallerySamples = 0;
// Adjacent sectors render together at the choir gate. Exactly one floor must
// own each slice of the threshold, including both sides of the door.
for (const z of [-42.75, -42.25, -41.75, -41.25, -40.75]) {
  for (const x of [-1.2, 0, 1.2]) {
    const owners = ["roofs", "chapel"].filter((sector) =>
      stoneHit(sector, x, 2.47, z, 0, -1, 0, 0.12),
    );
    assert.equal(
      owners.length,
      1,
      `Threshold floor owners at ${x}, ${z}: ${owners.join(", ")}`,
    );
  }
}
for (const x of [3.52, 4.15, 5, 5.85, 6.48])
  for (let z = -49.12; z >= -67.8; z -= 0.45) {
    const y = floorHeight(x, z);
    assert(
      stoneHit("chapel", x, y + 0.18, z, 0, -1, 0, 0.34),
      `Missing gallery tread or landing at ${x}, ${z}`,
    );
    gallerySamples++;
  }
for (const side of [-1, 1]) {
  for (const x of [-1.65, 0, 1.65])
    assert(
      stoneHit(
        "world",
        x,
        2.4 + 2.6 + Math.sqrt(1.9 ** 2 - x * x) + 0.06,
        -37 + side * 2,
        0,
        0,
        -side,
        3,
      ),
      "Open bridge spandrel",
    );
  for (const x of [4.15, 5, 5.85])
    assert(
      stoneHit(
        "chapel",
        x,
        5.2 + 1.9 + Math.sqrt(1.14 ** 2 - (x - 5) ** 2) + 0.08,
        -60.4 + side,
        0,
        0,
        -side,
        1.4,
      ),
      "Open vestry spandrel",
    );
}
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
const lightVersion = env.localLighting.texture.version;
const lightData = env.localLighting.texture.image.data.slice();
for (let i = 0; i < 600; i++)
  env.update(i / 60, { x: 0, y: 2.4, z: -99 }, "crypt", i > 300);
assert.equal(
  fire.instanceMatrix.version,
  version,
  "Fire uploaded instance matrices per frame",
);
assert.equal(
  env.localLighting.texture.version,
  lightVersion,
  "Local illumination was uploaded again during movement",
);
assert.deepEqual(
  env.localLighting.texture.image.data,
  lightData,
  "Walking or changing area changed a static source",
);
assert.equal(env.localLighting.texture.image.data.byteLength, 187500);
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
assert.equal(
  lights,
  3,
  "Static sources must not return to a nearest-point/spot pool",
);
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
  solidVestrySamples,
  passageFloorSamples,
  supportedCourtSamples: courtSamples,
  supportedGallerySamples: gallerySamples,
  solidCourtFaces: faced,
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
