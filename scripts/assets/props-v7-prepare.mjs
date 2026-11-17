import { NodeIO, Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  dedup,
  prune,
  simplify,
  textureCompress,
  weld,
} from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import { createRequire } from "node:module";
import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mkdir, readFile, writeFile, copyFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const require = createRequire(import.meta.url);
const sharp = require("sharp");
const work = path.join(project, "work/props-v7"),
  out = path.join(project, "public/assets/props-v7");
await mkdir(out, { recursive: true });
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS),
  reports = [];
const woodImage = new Uint8Array(
  await sharp(await readFile(path.join(work, "rough_wood_diff_1k.jpg")))
    .resize(512, 512)
    .jpeg({ quality: 83 })
    .toBuffer(),
);
const metalImage = new Uint8Array(
  await sharp(await readFile(path.join(work, "rusty_metal_02_diff_1k.jpg")))
    .resize(512, 512)
    .modulate({ saturation: 0.38, brightness: 0.72 })
    .jpeg({ quality: 83 })
    .toBuffer(),
);

function proceduralImage(kind) {
  const pixels = new Uint8Array(128 * 128 * 3);
  let seed = kind === "flesh" ? 357 : kind === "bone" ? 979 : 621;
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const noise = (seed >>> 24) / 255;
      let colour;
      if (kind === "flesh") {
        const vein =
          Math.abs(
            Math.sin(
              x * 0.19 + Math.sin(y * 0.1) * 2.1 + Math.sin(y * 0.033) * 3,
            ),
          ) < 0.13;
        const v = 0.7 + noise * 0.28;
        colour = vein
          ? [50, 12, 15]
          : [Math.round(118 * v), Math.round(39 * v), Math.round(43 * v)];
      } else if (kind === "bone") {
        const streak = Math.sin(x * 0.41 + Math.sin(y * 0.075)) > 0.85;
        const v = 0.7 + noise * 0.22;
        colour = streak
          ? [Math.round(129 * v), Math.round(113 * v), Math.round(75 * v)]
          : [Math.round(225 * v), Math.round(213 * v), Math.round(170 * v)];
      } else {
        const v =
          0.7 +
          noise * 0.22 +
          (x % 3 === 0 ? -0.13 : 0) +
          (y % 3 === 0 ? -0.12 : 0);
        colour = [Math.round(71 * v), Math.round(33 * v), Math.round(29 * v)];
      }
      pixels.set(colour, (y * 128 + x) * 3);
    }
  return sharp(pixels, { raw: { width: 128, height: 128, channels: 3 } })
    .png()
    .toBuffer();
}
const [fleshImage, boneImage, clothImage] = await Promise.all(
  ["flesh", "bone", "cloth"].map(proceduralImage),
);

function context(doc) {
  const root = doc.getRoot(),
    buffer = root.listBuffers()[0] || doc.createBuffer("PropsBuffer");
  const makeTexture = (name, image, mime = "image/jpeg") =>
    doc.createTexture(name).setImage(new Uint8Array(image)).setMimeType(mime);
  const wood = makeTexture("PolyHaven_RoughWood_512", woodImage),
    metal = makeTexture("PolyHaven_RustyMetal02_512", metalImage);
  const cloth = makeTexture("Original_WornLining_128", clothImage, "image/png");
  const flesh = makeTexture("Original_MimicFlesh_128", fleshImage, "image/png"),
    bone = makeTexture("Original_StainedBone_128", boneImage, "image/png");
  const material = (name, color, roughness = 0.8, metallic = 0, texture) => {
    const m = doc
      .createMaterial(name)
      .setBaseColorFactor([...color, 1])
      .setRoughnessFactor(roughness)
      .setMetallicFactor(metallic);
    if (texture) m.setBaseColorTexture(texture);
    return m;
  };
  const materials = {
    wood: material("Worn_RealWood", [0.72, 0.62, 0.48], 0.94, 0, wood),
    iron: material("Oxidised_ForgedIron", [0.36, 0.38, 0.39], 0.75, 0.7, metal),
    edge: material(
      "Worn_SteelCuttingEdge",
      [0.65, 0.67, 0.67],
      0.4,
      0.8,
      metal,
    ),
    leather: material(
      "Old_WrappedLeather",
      [0.19, 0.12, 0.075],
      0.96,
      0,
      cloth,
    ),
    lining: material(
      "Torn_MaroonFabric",
      [0.62, 0.46, 0.41],
      1,
      0,
      cloth,
    ).setDoubleSided(true),
    gold: material("Aged_CoinGold", [0.64, 0.44, 0.14], 0.4, 0.72, metal),
    flesh: material(
      "Veined_MimicFlesh",
      [0.9, 0.68, 0.64],
      0.32,
      0,
      flesh,
    ).setDoubleSided(true),
    bone: material("Stained_FangBone", [0.91, 0.85, 0.66], 0.69, 0, bone),
    dark: material("Recessed_DarkIron", [0.035, 0.028, 0.022], 0.96, 0.15),
  };
  const batches = new Map();
  const acc = (name, type, array) =>
    doc.createAccessor(name).setType(type).setArray(array).setBuffer(buffer);
  function add(parent, geometry, mat) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const name of Object.keys(g.attributes))
      if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    if (!g.getAttribute("uv"))
      g.setAttribute(
        "uv",
        new T.BufferAttribute(
          new Float32Array(g.getAttribute("position").count * 2),
          2,
        ),
      );
    if (!batches.has(parent)) batches.set(parent, new Map());
    const map = batches.get(parent);
    if (!map.has(mat)) map.set(mat, []);
    map.get(mat).push(g);
    return g;
  }
  function flush() {
    for (const [parent, mats] of batches) {
      const mesh = doc.createMesh(`${parent.getName()}_Mesh`);
      let i = 0;
      for (const [mat, geos] of mats) {
        const g = mergeGeometries(geos, false),
          prefix = `${parent.getName()}_${i++}`;
        const p = doc
          .createPrimitive()
          .setMaterial(mat)
          .setAttribute(
            "POSITION",
            acc(
              prefix + "_P",
              "VEC3",
              new Float32Array(g.getAttribute("position").array),
            ),
          )
          .setAttribute(
            "NORMAL",
            acc(
              prefix + "_N",
              "VEC3",
              new Float32Array(g.getAttribute("normal").array),
            ),
          )
          .setAttribute(
            "TEXCOORD_0",
            acc(
              prefix + "_UV",
              "VEC2",
              new Float32Array(g.getAttribute("uv").array),
            ),
          );
        const ids = Array.from(
          { length: g.getAttribute("position").count },
          (_, i) => i,
        );
        p.setIndices(
          acc(
            prefix + "_I",
            "SCALAR",
            ids.length > 65535 ? new Uint32Array(ids) : new Uint16Array(ids),
          ),
        );
        mesh.addPrimitive(p);
      }
      parent.setMesh(mesh);
    }
    batches.clear();
  }
  return { doc, root, buffer, materials, add, flush, acc };
}
function translated(g, x = 0, y = 0, z = 0) {
  return g.translate(x, y, z);
}
function bevelBox(w, h, d, b = 0.004) {
  const s = new T.Shape();
  s.moveTo(-w / 2, -h / 2);
  s.lineTo(w / 2, -h / 2);
  s.lineTo(w / 2, h / 2);
  s.lineTo(-w / 2, h / 2);
  s.closePath();
  return new T.ExtrudeGeometry(s, {
    depth: d,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 1,
    steps: 1,
    curveSegments: 4,
  }).translate(0, 0, -d / 2);
}
function cylinder(radiusTop, radiusBottom, height, segments = 16) {
  return new T.CylinderGeometry(
    radiusTop,
    radiusBottom,
    height,
    segments,
    1,
    false,
  );
}
function torus(radius, tube = 0.008, segments = 24) {
  return new T.TorusGeometry(radius, tube, 6, segments);
}
function chainTube(points, radius, closed = false, segments = 32) {
  return new T.TubeGeometry(
    new T.CatmullRomCurve3(
      points.map((p) => new T.Vector3(...p)),
      closed,
      "catmullrom",
      0.3,
    ),
    segments,
    radius,
    7,
    closed,
  );
}
function extruded(shape, depth, bevel = 0.003) {
  return new T.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 10,
  }).translate(0, 0, -depth / 2);
}
function node(ctx, name, parent, translation) {
  const n = ctx.doc.createNode(name);
  if (translation) n.setTranslation(translation);
  if (parent) parent.addChild(n);
  return n;
}
function newDocument(rootName) {
  const doc = new Document();
  const scene = doc.createScene("Scene"),
    root = doc.createNode(rootName);
  scene.addChild(root);
  return { doc, scene, root, ctx: context(doc) };
}
function rotateX(angle) {
  return new T.Quaternion()
    .setFromAxisAngle(new T.Vector3(1, 0, 0), angle)
    .toArray();
}
function rotateY(angle) {
  return new T.Quaternion()
    .setFromAxisAngle(new T.Vector3(0, 1, 0), angle)
    .toArray();
}
function clip(ctx, name, tracks) {
  const a = ctx.doc.createAnimation(name);
  for (const { target, path = "rotation", times, values } of tracks) {
    const input = ctx.acc(
      `${name}_${target.getName()}_time`,
      "SCALAR",
      new Float32Array(times),
    );
    const output = ctx.acc(
      `${name}_${target.getName()}_${path}`,
      path === "rotation" ? "VEC4" : "VEC3",
      new Float32Array(values.flat()),
    );
    const sampler = ctx.doc
      .createAnimationSampler()
      .setInput(input)
      .setOutput(output)
      .setInterpolation("LINEAR");
    a.addSampler(sampler).addChannel(
      ctx.doc
        .createAnimationChannel()
        .setSampler(sampler)
        .setTargetNode(target)
        .setTargetPath(path),
    );
  }
  return a;
}
function bladeGeometry(levels, thickness = 0.012) {
  const p = [],
    uv = [],
    idx = [];
  for (const [y, w] of levels) {
    for (const [x, z] of [
      [-w, 0],
      [0, thickness],
      [w, 0],
      [0, -thickness],
    ]) {
      p.push(x, y, z);
      uv.push((x + w) / (w * 2 || 1), y);
    }
  }
  for (let j = 0; j < levels.length - 1; j++)
    for (let i = 0; i < 4; i++) {
      const a = j * 4 + i,
        b = j * 4 + ((i + 1) % 4),
        c = (j + 1) * 4 + i,
        d = (j + 1) * 4 + ((i + 1) % 4);
      idx.push(a, b, c, b, d, c);
    }
  idx.push(0, 2, 1, 0, 3, 2);
  const g = new T.BufferGeometry()
    .setAttribute("position", new T.Float32BufferAttribute(p, 3))
    .setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function addHandleWrap(ctx, parent, yMin, yMax, radius) {
  for (let y = yMin; y <= yMax; y += 0.025) {
    const g = torus(radius, 0.0048, 14);
    g.rotateX(Math.PI / 2);
    ctx.add(parent, g.translate(0, y, 0), ctx.materials.leather);
  }
}
function coin(ctx, parent, x, y, z, angle = 0, r = 0.043) {
  const mat = ctx.materials.gold,
    g = cylinder(r, r, 0.009, 24);
  g.rotateZ(angle);
  g.translate(x, y, z);
  ctx.add(parent, g, mat);
  const rim = torus(r * 0.88, 0.0027, 24);
  rim.rotateX(Math.PI / 2);
  rim.rotateZ(angle);
  rim.translate(x, y + 0.005, z);
  ctx.add(parent, rim, mat);
  const seal = torus(r * 0.38, 0.0023, 18);
  seal.rotateX(Math.PI / 2);
  seal.rotateZ(angle);
  seal.translate(x, y + 0.006, z);
  ctx.add(parent, seal, mat);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    ctx.add(
      parent,
      bevelBox(0.005, 0.0015, 0.009, 0.0008)
        .rotateY(a)
        .translate(
          x + Math.cos(a) * r * 0.63,
          y + 0.006,
          z + Math.sin(a) * r * 0.63,
        ),
      mat,
    );
  }
}
function addKeyGeometry(ctx, parent, scale = 1) {
  const m = ctx.materials.iron;
  ctx.add(parent, torus(0.044, 0.01, 24), m);
  ctx.add(parent, cylinder(0.009, 0.011, 0.17, 12).translate(0, -0.115, 0), m);
  ctx.add(
    parent,
    bevelBox(0.07, 0.027, 0.019, 0.003).translate(0.028, -0.196, 0),
    m,
  );
  ctx.add(
    parent,
    bevelBox(0.018, 0.026, 0.02, 0.002).translate(0.054, -0.215, 0),
    m,
  );
  ctx.add(
    parent,
    bevelBox(0.014, 0.02, 0.02, 0.002).translate(0.013, -0.212, 0),
    m,
  );
  ctx.add(
    parent,
    cylinder(0.015, 0.015, 0.025, 12).translate(0, -0.037, 0),
    ctx.materials.edge,
  );
}
function addLoot(ctx, root) {
  const loot = node(ctx, "Loot", root),
    coins = node(ctx, "CoinScatter", loot);
  const points = [
    [-0.21, 0.035, -0.11],
    [-0.17, 0.04, -0.06],
    [-0.15, 0.049, -0.03],
    [-0.24, 0.035, 0.035],
    [-0.25, 0.044, 0.08],
    [-0.12, 0.034, 0.13],
    [0.16, 0.033, 0.12],
    [0.21, 0.035, 0.09],
    [0.26, 0.043, 0.11],
  ];
  points.forEach((p, i) =>
    coin(ctx, coins, ...p, ((i % 3) - 1) * 0.1, 0.036 + (i % 2) * 0.007),
  );
  const cloth = node(ctx, "FoldedLining", loot),
    p = [],
    uv = [],
    ix = [];
  const cols = 10,
    rows = 8;
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++) {
      const x = -0.34 + (i / cols) * 0.68,
        z = -0.165 + (j / rows) * 0.33,
        y =
          0.023 +
          0.004 * Math.sin(i * 0.7 + j * 0.9) +
          0.004 * Math.cos(i * 2 + j * 0.6);
      p.push(x, y, z);
      uv.push((i / cols) * 3, (j / rows) * 2);
    }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i,
        b = a + 1,
        c = a + cols + 1,
        d = c + 1;
      ix.push(a, c, b, b, c, d);
    }
  const g = new T.BufferGeometry()
    .setAttribute("position", new T.Float32BufferAttribute(p, 3))
    .setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setIndex(ix);
  g.computeVertexNormals();
  ctx.add(cloth, g, ctx.materials.lining);
  node(ctx, "LootAnchor", root, [0.24, 0.09, -0.02]);
  return loot;
}
function fangs(ctx, parent, upper, pivot) {
  const positions = [],
    uv = [],
    indices = [],
    count = 13;
  for (let n = 0; n < count; n++) {
    const x = -0.36 + (n / (count - 1)) * 0.72,
      z = 0.181 - (n % 2) * 0.012,
      y = upper ? 0.414 : 0.305,
      length = 0.065 + (0.5 + 0.5 * Math.sin(n * 2.7)) * 0.055;
    const start = positions.length / 3,
      rings = 5,
      segs = 7;
    for (let k = 0; k < rings; k++) {
      const t = k / (rings - 1),
        radius = 0.021 * (1 - t) + 0.0008,
        cy = y + (upper ? -1 : 1) * length * t,
        cz = z + 0.032 * t * t;
      for (let a = 0; a <= segs; a++) {
        const angle = (a / segs) * Math.PI * 2;
        positions.push(
          x + Math.cos(angle) * radius - pivot[0],
          cy - pivot[1],
          cz + Math.sin(angle) * radius - pivot[2],
        );
        uv.push(a / segs, t);
      }
    }
    for (let k = 0; k < rings - 1; k++)
      for (let a = 0; a < segs; a++) {
        const q = start + k * (segs + 1) + a,
          b = q + 1,
          c = q + segs + 1,
          d = c + 1;
        indices.push(q, b, c, b, d, c);
      }
  }
  const g = new T.BufferGeometry()
    .setAttribute("position", new T.Float32BufferAttribute(positions, 3))
    .setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  ctx.add(parent, g, ctx.materials.bone);
}
function tongueSection(length, r0, r1) {
  const p = [],
    uv = [],
    ix = [],
    rows = 7,
    segs = 10;
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2,
        t = j / rows,
        r = r0 + (r1 - r0) * t;
      p.push(Math.cos(a) * r * 1.7, Math.sin(a) * r * 0.48, t * length);
      uv.push(i / segs, t);
    }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < segs; i++) {
      const a = j * (segs + 1) + i,
        b = a + 1,
        c = a + segs + 1,
        d = c + 1;
      ix.push(a, b, c, b, d, c);
    }
  const g = new T.BufferGeometry()
    .setAttribute("position", new T.Float32BufferAttribute(p, 3))
    .setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setIndex(ix);
  g.computeVertexNormals();
  return g;
}
async function chestDocument(mimic = false) {
  const doc = await io.read(
    path.join(work, "treasure_chest/treasure_chest.gltf"),
  );
  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: 0.13, error: 0.002 }),
    textureCompress({
      encoder: sharp,
      targetFormat: "jpeg",
      resize: [512, 512],
      quality: 85,
    }),
    dedup(),
  );
  const ctx = context(doc),
    scene = doc.getRoot().listScenes()[0],
    root = doc.createNode("ChestRoot");
  for (const child of [...scene.listChildren()]) {
    scene.removeChild(child);
    root.addChild(child);
  }
  scene.addChild(root);
  const find = (n) =>
    doc
      .getRoot()
      .listNodes()
      .find((x) => x.getName() === n);
  const body = find("treasure_chest_bottom").setName("ChestBody"),
    lid = find("treasure_chest_lid").setName("ChestLid"),
    lock = find("treasure_chest_lock").setName("ChestLatch");
  find("treasure_chest_handle_left").setName("ChestHandleLeft");
  find("treasure_chest_handle_right").setName("ChestHandleRight");
  const lp = lid.getTranslation(),
    lockp = lock.getTranslation();
  root.removeChild(lock);
  lid.addChild(lock);
  lock.setTranslation(lockp.map((x, i) => x - lp[i]));
  const loot = addLoot(ctx, root);
  let mid, tip, tongue, lower;
  if (mimic) {
    const upper = node(ctx, "UpperTeeth", lid);
    lower = node(ctx, "LowerTeeth", root);
    fangs(ctx, upper, true, lp);
    fangs(ctx, lower, false, [0, 0, 0]);
    const gumPoints = [
      [-0.37, 0.395, -0.19],
      [-0.41, 0.39, 0],
      [-0.36, 0.395, 0.185],
      [0, 0.395, 0.2],
      [0.36, 0.395, 0.185],
      [0.41, 0.39, 0],
      [0.37, 0.395, -0.19],
      [0, 0.395, -0.2],
    ];
    const gums = node(ctx, "LowerGums", root);
    ctx.add(gums, chainTube(gumPoints, 0.023, true, 48), ctx.materials.flesh);
    const upperGums = node(ctx, "UpperGums", lid);
    ctx.add(
      upperGums,
      chainTube(
        gumPoints.map((p) => [
          p[0] - lp[0],
          p[1] + 0.025 - lp[1],
          p[2] - lp[2],
        ]),
        0.021,
        true,
        48,
      ),
      ctx.materials.flesh,
    );
    const floor = node(ctx, "MouthFloor", root);
    ctx.add(
      floor,
      new T.SphereGeometry(1, 20, 10)
        .scale(0.35, 0.11, 0.16)
        .translate(0, 0.22, 0),
      ctx.materials.flesh,
    );
    tongue = node(ctx, "TongueRoot", root, [0, 0.19, -0.1]);
    mid = node(ctx, "TongueMid", tongue, [0, 0, 0.2]);
    tip = node(ctx, "TongueTip", mid, [0, 0, 0.18]);
    mid.setRotation(rotateX(2.2));
    tip.setRotation(rotateX(2.2));
    ctx.add(tongue, tongueSection(0.2, 0.04, 0.037), ctx.materials.flesh);
    ctx.add(mid, tongueSection(0.18, 0.038, 0.029), ctx.materials.flesh);
    ctx.add(tip, tongueSection(0.15, 0.029, 0.003), ctx.materials.flesh);
    for (const joint of [mid, tip])
      ctx.add(
        joint,
        new T.SphereGeometry(1, 12, 7).scale(0.05, 0.018, 0.035),
        ctx.materials.flesh,
      );
  }
  const times = [0, 0.25, 0.78, 1.1],
    openAngles = [0, -0.14, -1.57, -1.75],
    closeAngles = [-1.75, -1.57, -0.14, 0];
  if (!mimic) {
    clip(ctx, "Open", [
      { target: lid, times, values: openAngles.map(rotateX) },
    ]);
    clip(ctx, "Close", [
      { target: lid, times, values: closeAngles.map(rotateX) },
    ]);
  } else {
    // Lift the folded tongue above the wooden rim before unrolling. A direct
    // interpolation from the tucked pose otherwise sweeps through the front wall.
    const openTracks = [
      {
        target: lid,
        times: [0, 0.2, 0.5, 1.1],
        values: [0, -0.14, -1.57, -1.75].map(rotateX),
      },
      {
        target: mid,
        times: [0, 0.52, 0.88, 1.1],
        values: [2.2, 2.2, -0.25, -0.25].map(rotateX),
      },
      {
        target: tip,
        times: [0, 0.56, 0.9, 1.1],
        values: [2.2, 2.2, -0.4, -0.4].map(rotateX),
      },
      {
        target: tongue,
        path: "translation",
        times: [0, 0.25, 0.52, 0.9, 1.1],
        values: [0.19, 0.19, 0.7, 0.7, 0.43].map((y) => [0, y, -0.1]),
      },
      {
        target: tongue,
        times: [0, 0.25, 0.52, 0.9, 1.1],
        values: [0, 0, -0.15, -0.15, -0.15].map(rotateX),
      },
      {
        target: lower,
        path: "translation",
        times: [0, 0.3, 0.7, 1.1],
        values: [0, 0, 0.09, 0.09].map((y) => [0, y, 0]),
      },
    ];
    clip(ctx, "Open", openTracks);
    clip(ctx, "Close", [
      {
        target: lid,
        times: [0, 0.65, 0.85, 1.1],
        values: [-1.75, -1.57, -0.14, 0].map(rotateX),
      },
      {
        target: mid,
        times: [0, 0.12, 0.4, 0.62, 1.1],
        values: [-0.25, -0.25, 2.2, 2.2, 2.2].map(rotateX),
      },
      {
        target: tip,
        times: [0, 0.12, 0.4, 0.62, 1.1],
        values: [-0.4, -0.4, 2.2, 2.2, 2.2].map(rotateX),
      },
      {
        target: tongue,
        path: "translation",
        times: [0, 0.12, 0.4, 0.62, 1.1],
        values: [0.43, 0.7, 0.7, 0.19, 0.19].map((y) => [0, y, -0.1]),
      },
      {
        target: tongue,
        times: [0, 0.12, 0.4, 0.62, 1.1],
        values: [-0.15, -0.15, -0.15, 0, 0].map(rotateX),
      },
      {
        target: lower,
        path: "translation",
        times: [0, 0.55, 0.85, 1.1],
        values: [0.09, 0.09, 0, 0].map((y) => [0, y, 0]),
      },
    ]);
    clip(
      ctx,
      "Reveal",
      openTracks.map((track) => ({
        ...track,
        times: track.times.map((t) => t / 1.1),
      })),
    );
    const times = [0, 0.08, 0.2, 0.29, 0.34, 0.48, 0.55, 0.65, 0.72];
    clip(ctx, "Bite", [
      {
        target: lid,
        times,
        values: [
          -1.75, -1.75, -1.75, -0.4, -0.12, -1.57, -1.75, -1.75, -1.75,
        ].map(rotateX),
      },
      {
        target: mid,
        times,
        values: [-0.25, -0.25, 2.2, 2.2, 2.2, 2.2, 2.2, -0.25, -0.25].map(
          rotateX,
        ),
      },
      {
        target: tip,
        times,
        values: [-0.4, -0.4, 2.2, 2.2, 2.2, 2.2, 2.2, -0.4, -0.4].map(rotateX),
      },
      {
        target: tongue,
        path: "translation",
        times,
        values: [0.43, 0.7, 0.7, 0.19, 0.19, 0.19, 0.7, 0.7, 0.43].map((y) => [
          0,
          y,
          -0.1,
        ]),
      },
      {
        target: tongue,
        times,
        values: [-0.15, -0.15, -0.15, 0, 0, 0, -0.15, -0.15, -0.15].map(
          rotateX,
        ),
      },
      {
        target: lower,
        path: "translation",
        times,
        values: [0.09, 0.09, 0.09, 0, 0, 0, 0.09, 0.09, 0.09].map((y) => [
          0,
          y,
          0,
        ]),
      },
    ]);
  }
  ctx.flush();
  doc.getRoot().getAsset().copyright =
    "Treasure Chest by Rico Cilliers / Poly Haven, CC0. Original new0 loot, cloth, and mimic anatomy/animations are scripted derivatives. No game-ripped content.";
  doc.getRoot().getAsset().extras = {
    source: "https://polyhaven.com/a/treasure_chest",
    license: "CC0-1.0",
    derivative: mimic
      ? "Mimic teeth/gums/tongue and new clips; original loot/lining; optimized 512px maps"
      : "Original loot/lining and lid clips; optimized 512px maps",
    hollow: true,
    lootAnchor: "LootAnchor",
  };
  return doc;
}
function makeWeapon(kind) {
  const { doc, root, ctx } = newDocument("WeaponRoot");
  node(ctx, "Grip", root, [0, 0, 0]);
  const model = node(ctx, "WeaponMesh", root),
    m = ctx.materials;
  if (kind === "sword") {
    ctx.add(
      model,
      bladeGeometry(
        [
          [0.13, 0.04],
          [0.25, 0.04],
          [0.75, 0.026],
          [0.98, 0.016],
          [1.08, 0.0005],
        ],
        0.011,
      ),
      m.edge,
    );
    const guard = new T.Shape();
    guard.moveTo(-0.18, 0.1);
    guard.quadraticCurveTo(-0.12, 0.16, -0.045, 0.145);
    guard.lineTo(0.045, 0.145);
    guard.quadraticCurveTo(0.12, 0.16, 0.18, 0.1);
    guard.lineTo(0.17, 0.075);
    guard.quadraticCurveTo(0.1, 0.12, 0.035, 0.115);
    guard.lineTo(-0.035, 0.115);
    guard.quadraticCurveTo(-0.1, 0.12, -0.17, 0.075);
    guard.closePath();
    ctx.add(model, extruded(guard, 0.033, 0.004), m.iron);
    ctx.add(
      model,
      cylinder(0.022, 0.025, 0.28, 14).translate(0, -0.035, 0),
      m.leather,
    );
    addHandleWrap(ctx, model, -0.16, 0.075, 0.024);
    ctx.add(
      model,
      new T.SphereGeometry(1, 12, 8)
        .scale(0.039, 0.049, 0.025)
        .translate(0, -0.22, 0),
      m.iron,
    );
    ctx.add(
      model,
      bevelBox(0.009, 0.54, 0.002, 0.001).translate(0, 0.49, 0.011),
      m.iron,
    );
  } else if (kind === "axe") {
    const points = [
      new T.Vector2(0.025, -0.22),
      new T.Vector2(0.03, -0.18),
      new T.Vector2(0.022, 0.45),
      new T.Vector2(0.03, 0.69),
      new T.Vector2(0.02, 0.74),
    ];
    ctx.add(model, new T.LatheGeometry(points, 14), m.wood);
    const head = new T.Shape();
    head.moveTo(-0.045, 0.72);
    head.lineTo(0.08, 0.77);
    head.quadraticCurveTo(0.18, 0.89, 0.32, 0.84);
    head.quadraticCurveTo(0.27, 0.62, 0.29, 0.45);
    head.quadraticCurveTo(0.16, 0.44, 0.09, 0.57);
    head.lineTo(-0.045, 0.57);
    head.closePath();
    ctx.add(model, extruded(head, 0.045, 0.004), m.iron);
    const edge = new T.Shape();
    edge.moveTo(0.32, 0.84);
    edge.quadraticCurveTo(0.27, 0.62, 0.29, 0.45);
    edge.lineTo(0.262, 0.456);
    edge.quadraticCurveTo(0.245, 0.63, 0.291, 0.825);
    edge.closePath();
    ctx.add(model, extruded(edge, 0.021, 0.002), m.edge);
    ctx.add(
      model,
      cylinder(0.039, 0.039, 0.16, 12).translate(0, 0.65, 0),
      m.iron,
    );
    addHandleWrap(ctx, model, -0.19, 0.1, 0.032);
    for (const y of [0.6, 0.7])
      ctx.add(
        model,
        new T.SphereGeometry(0.012, 8, 5)
          .scale(1, 1, 0.5)
          .translate(0.015, y, 0.027),
        m.edge,
      );
  } else {
    ctx.add(
      model,
      cylinder(0.018, 0.024, 1.4, 14).translate(0, 0.25, 0),
      m.wood,
    );
    ctx.add(
      model,
      bladeGeometry(
        [
          [0.96, 0.028],
          [1.06, 0.064],
          [1.29, 0.043],
          [1.48, 0.0005],
        ],
        0.014,
      ),
      m.edge,
    );
    ctx.add(
      model,
      cylinder(0.033, 0.024, 0.18, 12).translate(0, 0.94, 0),
      m.iron,
    );
    for (const side of [-1, 1]) {
      const barb = new T.Shape();
      barb.moveTo(side * 0.027, 1.08);
      barb.lineTo(side * 0.135, 1.2);
      barb.lineTo(side * 0.075, 0.99);
      barb.closePath();
      ctx.add(model, extruded(barb, 0.018, 0.002), m.iron);
    }
    addHandleWrap(ctx, model, -0.14, 0.23, 0.025);
    ctx.add(
      model,
      new T.ConeGeometry(0.029, 0.13, 12)
        .rotateZ(Math.PI)
        .translate(0, -0.49, 0),
      m.iron,
    );
  }
  ctx.flush();
  doc.getRoot().getAsset().copyright =
    "Original new0 weapon geometry, scripted for the prototype. Rough Wood and Rusty Metal 02 textures by Rob Tuytel / Poly Haven, CC0.";
  return doc;
}
function makeKey() {
  const { doc, root, ctx } = newDocument("KeyRoot");
  addKeyGeometry(ctx, root);
  ctx.flush();
  return doc;
}
function makeCoins() {
  const { doc, root, ctx } = newDocument("CoinPile");
  for (let i = 0; i < 12; i++) {
    const a = i * 2.4,
      r = 0.03 + Math.sqrt(i) * 0.026;
    coin(
      ctx,
      root,
      Math.cos(a) * r,
      0.009 + (i % 3) * 0.007,
      Math.sin(a) * r,
      ((i % 3) - 1) * 0.12,
      0.041,
    );
  }
  ctx.flush();
  return doc;
}
function makeDoor() {
  const { doc, root, ctx } = newDocument("DoorRoot"),
    m = ctx.materials,
    frame = node(ctx, "DoorFrame", root),
    pivot = node(ctx, "DoorPivot", root, [-0.56, 0, 0]),
    leaf = node(ctx, "DoorLeaf", pivot);
  const outline = new T.Shape();
  outline.moveTo(-0.7, 0);
  outline.lineTo(-0.7, 1.6);
  outline.absellipse(0, 1.6, 0.7, 0.7, Math.PI, 0, true);
  outline.lineTo(0.7, 0);
  outline.closePath();
  const hole = new T.Path();
  hole.moveTo(-0.56, 0);
  hole.lineTo(0.56, 0);
  hole.lineTo(0.56, 1.59);
  hole.absellipse(0, 1.59, 0.56, 0.56, 0, Math.PI, false);
  hole.lineTo(-0.56, 0);
  outline.holes.push(hole);
  ctx.add(frame, extruded(outline, 0.18, 0.008), m.wood);
  const width = 1.1,
    planks = 7;
  for (let i = 0; i < planks; i++) {
    const x0 = -width / 2 + (i * width) / planks + 0.006,
      x1 = -width / 2 + ((i + 1) * width) / planks - 0.006,
      top = (x) => 1.59 + Math.sqrt(Math.max(0, 0.55 * 0.55 - x * x));
    const s = new T.Shape();
    s.moveTo(x0, 0.045);
    s.lineTo(x1, 0.045);
    s.lineTo(x1, top(x1));
    s.lineTo((x0 + x1) / 2, top((x0 + x1) / 2));
    s.lineTo(x0, top(x0));
    s.closePath();
    ctx.add(leaf, extruded(s, 0.075, 0.003).translate(0.56, 0, 0), m.wood);
  }
  for (const y of [0.4, 1.04, 1.58]) {
    ctx.add(
      leaf,
      bevelBox(1.01, 0.065, 0.022, 0.004).translate(0.56, y, 0.058),
      m.iron,
    );
    for (const x of [0.1, 0.29, 0.82, 1.02])
      ctx.add(
        leaf,
        new T.SphereGeometry(0.013, 8, 5)
          .scale(1, 1, 0.45)
          .translate(x, y, 0.076),
        m.edge,
      );
  }
  for (const side of [-1, 1])
    for (const y of [0.3, 0.85, 1.4]) {
      ctx.add(
        frame,
        bevelBox(0.16, 0.048, 0.022, 0.003).translate(side * 0.63, y, 0.11),
        m.iron,
      );
      ctx.add(
        frame,
        new T.SphereGeometry(0.013, 8, 5).translate(side * 0.63, y, 0.127),
        m.edge,
      );
    }
  const latch = node(ctx, "DoorLatch", pivot, [0.94, 0.94, 0.095]);
  ctx.add(latch, bevelBox(0.11, 0.2, 0.025, 0.006), m.iron);
  ctx.add(
    latch,
    new T.SphereGeometry(1, 10, 7)
      .scale(0.013, 0.019, 0.004)
      .translate(0, 0.025, 0.018),
    m.dark,
  );
  ctx.add(
    latch,
    bevelBox(0.014, 0.035, 0.006, 0.001).translate(0, -0.003, 0.019),
    m.dark,
  );
  const knocker = node(ctx, "DoorKnocker", pivot, [0.56, 1.25, 0.13]);
  ctx.add(knocker, torus(0.07, 0.01, 28), m.iron);
  ctx.add(
    knocker,
    new T.SphereGeometry(0.023, 12, 7).translate(0, 0.075, -0.006),
    m.edge,
  );
  for (const y of [0.4, 1.58])
    ctx.add(
      frame,
      cylinder(0.026, 0.026, 0.16, 12).translate(-0.58, y, 0),
      m.iron,
    );
  clip(ctx, "Open", [
    {
      target: pivot,
      times: [0, 0.2, 1.2],
      values: [0, -0.08, -1.55].map(rotateY),
    },
  ]);
  clip(ctx, "Close", [
    {
      target: pivot,
      times: [0, 0.2, 1.2],
      values: [-1.55, -1.47, 0].map(rotateY),
    },
  ]);
  ctx.flush();
  return doc;
}
async function save(name, doc) {
  await doc.transform(
    weld(),
    dedup(),
    prune({ keepLeaves: true, keepAttributes: true }),
  );
  const asset = doc.getRoot().getAsset();
  asset.extras ??= {};
  asset.extras.propsVersion = 7;
  asset.extras.up = "+Y";
  asset.extras.front = "+Z";
  asset.extras.unit = "metre";
  const file = path.join(out, name + ".glb");
  await io.write(file, doc);
  const root = doc.getRoot(),
    primitives = root.listMeshes().flatMap((m) => m.listPrimitives());
  const details = {
    name,
    file: "/assets/props-v7/" + name + ".glb",
    bytes: (await stat(file)).size,
    triangles: primitives.reduce(
      (s, p) => s + p.getIndices().getCount() / 3,
      0,
    ),
    vertices: primitives.reduce(
      (s, p) => s + p.getAttribute("POSITION").getCount(),
      0,
    ),
    materials: root.listMaterials().length,
    primitives: primitives.length,
    nodes: root.listNodes().map((n) => ({
      name: n.getName(),
      translation: n.getTranslation(),
      rotation: n.getRotation(),
    })),
    clips: root.listAnimations().map((a) => ({
      name: a.getName(),
      duration: Math.max(
        ...a.listSamplers().map((s) => s.getInput().getMaxNormalized([0])[0]),
      ),
    })),
    images: await Promise.all(
      root.listTextures().map(async (t) => {
        const x = await sharp(t.getImage()).metadata();
        return {
          name: t.getName(),
          width: x.width,
          height: x.height,
          bytes: t.getImage().length,
        };
      }),
    ),
  };
  reports.push(details);
  console.log(
    JSON.stringify({
      name,
      bytes: details.bytes,
      triangles: details.triangles,
      materials: details.materials,
      primitives: details.primitives,
      clips: details.clips,
    }),
  );
}
await save("chest", await chestDocument(false));
await save("mimic", await chestDocument(true));
for (const name of ["sword", "axe", "spear"])
  await save("weapon-" + name, makeWeapon(name));
await save("key", makeKey());
await save("coins", makeCoins());
await save("door", makeDoor());
await writeFile(
  path.join(work, "prepared-report.json"),
  JSON.stringify(reports, null, 2),
);
await copyFile(path.join(work, "CC0-1.0.txt"), path.join(out, "CC0-1.0.txt"));
const contract = JSON.parse(
  await readFile(path.join(out, "contract.json"), "utf8"),
);
contract.status = "prepared";
contract.report = reports.map(
  ({ name, file, bytes, triangles, materials, primitives, clips }) => ({
    name,
    file,
    bytes,
    triangles,
    materials,
    primitives,
    clips,
  }),
);
contract.chest.clips = [
  { name: "Open", duration: 1.1 },
  { name: "Close", duration: 1.1 },
];
contract.door.pivotPosition = [-0.56, 0, 0];
contract.door.outerDimensions = [1.416, 2.316, 0.196];
contract.door.leafWidth = 1.1;
contract.weaponAttachment = {
  position: [0, 0, 0],
  gripNode: "Grip",
  bladeAxis: "+Y",
  handChildRotationEulerXYZ: [-Math.PI / 2, 0, 0],
};
await writeFile(
  path.join(out, "contract.json"),
  JSON.stringify(contract, null, 2),
);
