import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { registerArmourShoulders } from "./character-appearance.ts";

// Small original meshes. They share geometry/materials when cloned and have no
// decoder, network, animation-mixer or per-frame allocation cost.
export const FLASK_COLORS = { healing: 0x753e45, regeneration: 0x659e7f };
export function flaskModel(liquidColor = FLASK_COLORS.healing) {
  const root = new THREE.Group();
  const profile = [
    [0.035, 0],
    [0.095, 0.025],
    [0.12, 0.12],
    [0.105, 0.22],
    [0.046, 0.28],
    [0.046, 0.36],
    [0.055, 0.37],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const glass = new THREE.MeshStandardMaterial({
    color: 0xaac2bb,
    metalness: 0.25,
    roughness: 0.25,
    emissive: 0x34463f,
    emissiveIntensity: 0.18,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  root.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 12), glass));
  const liquid = new THREE.Mesh(
    liquidGeometry(),
    new THREE.MeshStandardMaterial({
      color: liquidColor,
      roughness: 0.3,
      metalness: 0,
    }),
  );
  liquid.name = "FlaskLiquid";
  liquid.renderOrder = 1;
  root.add(liquid);
  const shell = root.children[0] as THREE.Mesh;
  shell.renderOrder = 2;
  const stopper = new THREE.Mesh(
    new THREE.CylinderGeometry(0.043, 0.038, 0.065, 10),
    new THREE.MeshStandardMaterial({ color: 0x69594c, roughness: 1 }),
  );
  stopper.name = "FlaskStopper";
  stopper.position.y = 0.39;
  root.add(stopper);
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.05, 0.009, 5, 12),
    new THREE.MeshStandardMaterial({
      color: 0xc2c0a8,
      metalness: 0.7,
      roughness: 0.5,
    }),
  );
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.31;
  root.add(band);
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) o.userData.fixes1OwnedGeometry = true;
  });
  setFlaskFill(root, 1);
  return root;
}

const LIQUID_SIDES = 16,
  LIQUID_RINGS = 14;
const innerProfile = [
  [0.014, 0.03],
  [0.032, 0.086],
  [0.12, 0.111],
  [0.22, 0.097],
  [0.245, 0.075],
];
function innerRadius(y: number) {
  for (let i = 1; i < innerProfile.length; i++) {
    const a = innerProfile[i - 1],
      b = innerProfile[i];
    if (y <= b[0])
      return THREE.MathUtils.lerp(
        a[1],
        b[1],
        THREE.MathUtils.clamp((y - a[0]) / (b[0] - a[0]), 0, 1),
      );
  }
  return innerProfile.at(-1)![1];
}
const fluidVolumes = [0];
for (let i = 1; i <= 128; i++) {
  const y = THREE.MathUtils.lerp(0.014, 0.225, (i - 0.5) / 128);
  fluidVolumes.push(
    fluidVolumes[i - 1] +
      (Math.PI * innerRadius(y) ** 2 * (0.225 - 0.014)) / 128,
  );
}
function liquidGeometry() {
  const rows = LIQUID_RINGS + 3,
    width = LIQUID_SIDES + 1;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(rows * width * 3), 3),
  );
  geometry.setAttribute(
    "normal",
    new THREE.BufferAttribute(new Float32Array(rows * width * 3), 3),
  );
  const indices: number[] = [];
  for (let j = 0; j < rows - 1; j++)
    for (let i = 0; i < LIQUID_SIDES; i++) {
      const a = j * width + i,
        b = a + width;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  geometry.setIndex(indices);
  return geometry;
}
// Fill changes volume and a horizontal surface. The liquid never contracts into
// a separate ball, and no geometry or material is allocated during a drink.
export function setFlaskFill(
  root: THREE.Object3D,
  fraction: number,
  color?: number,
) {
  const liquid = root.getObjectByName("FlaskLiquid") as THREE.Mesh | undefined;
  if (!liquid) return;
  if (color !== undefined && liquid.userData.liquidColor !== color) {
    (liquid.material as THREE.MeshStandardMaterial).color.setHex(color);
    liquid.userData.liquidColor = color;
  }
  const fill = THREE.MathUtils.clamp(fraction, 0, 1);
  if (liquid.userData.fill === fill) return;
  liquid.userData.fill = fill;
  liquid.visible = fill > 0.001;
  liquid.scale.setScalar(1);
  const volume = fill * fluidVolumes[128];
  let bucket = 1;
  while (bucket < 128 && fluidVolumes[bucket] < volume) bucket++;
  const a = fluidVolumes[bucket - 1],
    b = fluidVolumes[bucket];
  const level = THREE.MathUtils.lerp(
    0.014,
    0.225,
    (bucket - 1 + (b > a ? (volume - a) / (b - a) : 0)) / 128,
  );
  const geometry = liquid.geometry,
    positions = geometry.getAttribute("position"),
    normals = geometry.getAttribute("normal");
  for (let row = 0; row < LIQUID_RINGS + 3; row++) {
    const sideRow = Math.max(0, Math.min(LIQUID_RINGS, row - 1));
    let y = THREE.MathUtils.lerp(0.014, level, sideRow / LIQUID_RINGS);
    const radius = row === 0 || row === LIQUID_RINGS + 2 ? 0 : innerRadius(y);
    if (row === LIQUID_RINGS + 2) y = level - 0.0007;
    const dy = 0.0002,
      slope = (innerRadius(y + dy) - innerRadius(y - dy)) / (dy * 2);
    for (let i = 0; i <= LIQUID_SIDES; i++) {
      const theta = (i / LIQUID_SIDES) * Math.PI * 2,
        index = row * (LIQUID_SIDES + 1) + i;
      positions.setXYZ(
        index,
        Math.sin(theta) * radius,
        y,
        Math.cos(theta) * radius,
      );
      if (row === 0) normals.setXYZ(index, 0, -1, 0);
      else if (row >= LIQUID_RINGS + 1) normals.setXYZ(index, 0, 1, 0);
      else {
        const scale = 1 / Math.hypot(1, slope);
        normals.setXYZ(
          index,
          Math.sin(theta) * scale,
          -slope * scale,
          Math.cos(theta) * scale,
        );
      }
    }
  }
  positions.needsUpdate = true;
  normals.needsUpdate = true;
  geometry.computeBoundingSphere();
}

let steelTexture: THREE.DataTexture | undefined;
let steelFinish: THREE.DataTexture | undefined;
function hammeredSteel() {
  if (steelTexture) return steelTexture;
  const size = 256,
    data = new Uint8Array(size * size * 4),
    finish = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const noise = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      const grain = noise - Math.floor(noise);
      const hammer =
        Math.sin(x * 0.14 + Math.sin(y * 0.19)) *
        Math.cos(y * 0.13 + Math.sin(x * 0.17));
      const scratch =
        Math.max(0, Math.sin(x * 1.87 + Math.sin(y * 0.03) * 0.6) - 0.975) * 10;
      const tone = 0.89 + grain * 0.025 + hammer * 0.01 + scratch * 0.025;
      const index = (y * size + x) * 4;
      data[index] = 226 * tone;
      data[index + 1] = 233 * tone;
      data[index + 2] = 238 * tone;
      data[index + 3] = 255;
      finish[index] = 255;
      finish[index + 1] = 168 + grain * 28 + hammer * 7 - scratch * 9;
      finish[index + 2] = 176 + grain * 15;
      finish[index + 3] = 255;
    }
  steelTexture = new THREE.DataTexture(data, size, size);
  steelTexture.colorSpace = THREE.SRGBColorSpace;
  steelTexture.wrapS = steelTexture.wrapT = THREE.RepeatWrapping;
  steelTexture.generateMipmaps = true;
  steelTexture.minFilter = THREE.LinearMipmapLinearFilter;
  steelTexture.magFilter = THREE.LinearFilter;
  steelTexture.needsUpdate = true;
  steelFinish = new THREE.DataTexture(finish, size, size);
  steelFinish.wrapS = steelFinish.wrapT = THREE.RepeatWrapping;
  steelFinish.generateMipmaps = true;
  steelFinish.minFilter = THREE.LinearMipmapLinearFilter;
  steelFinish.magFilter = THREE.LinearFilter;
  steelFinish.needsUpdate = true;
  return steelTexture;
}
function curveTube(
  points: THREE.Vector3[],
  radius: number,
  material: THREE.Material,
) {
  return new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(points),
      Math.max(12, Math.min(48, points.length)),
      radius,
      4,
      false,
    ),
    material,
  );
}
function metalShell(back: boolean, material: THREE.Material) {
  const geometry = new THREE.BufferGeometry(),
    positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const levels = 12,
    segments = 32;
  for (let j = 0; j <= levels; j++)
    for (let i = 0; i <= segments; i++) {
      const t = j / levels,
        angle = (back ? Math.PI / 2 : -Math.PI / 2) + (i / segments) * Math.PI;
      const xUnit = Math.sin(angle),
        zUnit = Math.cos(angle);
      const width = 0.156 + 0.035 * Math.sin(t * Math.PI * 0.83);
      const y = THREE.MathUtils.lerp(-0.09, 0.195 + 0.045 * Math.abs(xUnit), t);
      const depth = back
        ? 0.159 - t * 0.009
        : 0.13 + Math.sin(t * Math.PI) * 0.016;
      const keel = back
        ? 0
        : 0.01 * Math.exp(-((xUnit / 0.23) ** 2)) * Math.sin(t * Math.PI);
      positions.push(xUnit * width, y, zUnit * depth + keel);
      uv.push((i / segments) * 2, t * 3);
      if (i < segments && j < levels) {
        const a = j * (segments + 1) + i,
          b = a + segments + 1;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = back ? "ArmourBackplate" : "ArmourBreastplate";
  return mesh;
}
function batchStatic(root: THREE.Group) {
  root.updateMatrixWorld(true);
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const list = groups.get(o.material as THREE.Material) ?? [];
    list.push(o.geometry.clone().applyMatrix4(o.matrixWorld));
    groups.set(o.material as THREE.Material, list);
    o.geometry.dispose();
  });
  root.clear();
  for (const [material, pieces] of groups) {
    const geometry = mergeGeometries(pieces)!;
    for (const p of pieces) p.dispose();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.fixes1OwnedGeometry = true;
    root.add(mesh);
  }
}
const STRAP_PATH = [
  new THREE.Vector3(0.126, 0.17, 0.112),
  new THREE.Vector3(0.145, 0.237, 0.015),
  new THREE.Vector3(0.126, 0.17, -0.123),
];
function armourStrap(side: number, material: THREE.Material) {
  const curve = new THREE.CatmullRomCurve3(
    STRAP_PATH.map((p) => new THREE.Vector3(p.x * side, p.y, p.z)),
  );
  const vertices: number[] = [],
    indices: number[] = [],
    sections = 20;
  for (let i = 0; i <= sections; i++) {
    const p = curve.getPoint(i / sections),
      t = curve.getTangent(i / sections);
    const normal = new THREE.Vector3(0, -t.z, t.y).normalize();
    for (const width of [-1, 1])
      for (const thickness of [-1, 1]) {
        vertices.push(
          p.x + width * 0.013,
          p.y + normal.y * thickness * 0.0025,
          p.z + normal.z * thickness * 0.0025,
        );
      }
    if (i < sections)
      for (const [a, b] of [
        [0, 1],
        [1, 3],
        [3, 2],
        [2, 0],
      ]) {
        const k = i * 4;
        indices.push(k + a, k + b, k + a + 4, k + a + 4, k + b, k + b + 4);
      }
  }
  indices.push(0, 2, 1, 1, 2, 3);
  const end = sections * 4;
  indices.push(end, end + 1, end + 2, end + 1, end + 3, end + 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

// Narrow overlapping steel lames wrap the outside of the upper arm. Their
// axis is the original upper-arm-to-elbow direction, so the bone carries them
// naturally when the arm hangs, bends or lifts. No hovering oval shoulder cap.
function shoulderLames(
  side: number,
  metal: THREE.Material,
  edge: THREE.Material,
) {
  const root = new THREE.Group(),
    axis = new THREE.Vector3(0.16 * side, -0.24, -0.01).normalize();
  const outward = new THREE.Vector3(0, 1, 0)
    .addScaledVector(axis, -axis.y)
    .normalize();
  const transverse = new THREE.Vector3()
    .crossVectors(axis, outward)
    .normalize();
  const surface = (t: number, angle: number, layer: number) =>
    new THREE.Vector3()
      .addScaledVector(axis, t)
      .addScaledVector(
        outward,
        Math.cos(angle) * (0.068 - 0.107 * t + layer * 0.001),
      )
      .addScaledVector(
        transverse,
        Math.sin(angle) * (0.068 - 0.107 * t + layer * 0.001),
      );
  for (let layer = 0; layer < 3; layer++) {
    const positions: number[] = [],
      uv: number[] = [],
      indices: number[] = [],
      rows = 3,
      segments = 16;
    const start = 0.003 + layer * 0.041,
      length = 0.057;
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i <= segments; i++) {
        const angle = THREE.MathUtils.lerp(-1.5, 1.5, i / segments),
          t = start + (j / rows) * length;
        surface(t, angle, 2 - layer).toArray(positions, positions.length);
        uv.push(i / segments, (j / rows) * 0.65 + layer * 0.4);
        if (i < segments && j < rows) {
          const a = j * (segments + 1) + i,
            b = a + segments + 1;
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    root.add(new THREE.Mesh(geometry, metal));
    const rolledEdge: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++)
      rolledEdge.push(
        surface(
          start + length,
          THREE.MathUtils.lerp(-1.5, 1.5, i / segments),
          2 - layer,
        ),
      );
    root.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(rolledEdge),
          16,
          0.0016,
          4,
          false,
        ),
        edge,
      ),
    );
    for (const angle of [-1.24, 1.24]) {
      const rivet = new THREE.Mesh(
        new THREE.SphereGeometry(0.0026, 6, 4),
        edge,
      );
      rivet.position.copy(surface(start + 0.015, angle, 3 - layer));
      root.add(rivet);
    }
  }
  batchStatic(root);
  return root;
}

export function armourModel(rig?: THREE.Object3D) {
  const root = new THREE.Group();
  root.userData.fixes1StrapPath = new THREE.CatmullRomCurve3(STRAP_PATH)
    .getPoints(8)
    .map((p) => new THREE.Vector2(p.y, p.z));
  // Share the exact twenty generated strap sections with cloth coverage.
  root.userData.fixes2StrapSurface = new THREE.CatmullRomCurve3(
    STRAP_PATH,
  ).getPoints(20);
  root.userData.fixes2StrapNormals = Array.from({ length: 21 }, (_, i) => {
    const t = new THREE.CatmullRomCurve3(STRAP_PATH).getTangent(i / 20);
    return new THREE.Vector2(-t.z, t.y).normalize();
  });
  const metal = new THREE.MeshStandardMaterial({
    color: 0xc2c5c8,
    map: hammeredSteel(),
    metalness: 0.62,
    roughness: 0.7,
    roughnessMap: steelFinish,
    metalnessMap: steelFinish,
    bumpMap: hammeredSteel(),
    bumpScale: 0.00055,
    side: THREE.DoubleSide,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x443c32,
    metalness: 0.06,
    roughness: 0.96,
  });
  const edge = metal;
  root.add(metalShell(false, metal), metalShell(true, metal));
  const fauldRoot = new THREE.Group();
  fauldRoot.name = "ArmourFauld";
  const fauldPositions: number[] = [],
    fauldUV: number[] = [],
    fauldIndices: number[] = [],
    fauldLevels = 4,
    fauldSides = 32;
  for (let j = 0; j <= fauldLevels; j++)
    for (let i = 0; i <= fauldSides; i++) {
      const t = j / fauldLevels,
        a = (i / fauldSides) * Math.PI * 2;
      const bottom = -0.16 + 0.065 * Math.max(0, Math.cos(a));
      fauldPositions.push(
        Math.sin(a) * THREE.MathUtils.lerp(0.165, 0.16, t),
        THREE.MathUtils.lerp(bottom, -0.085, t),
        Math.cos(a) * THREE.MathUtils.lerp(0.1574, 0.153, t),
      );
      fauldUV.push((i / fauldSides) * 2, t * 2);
      if (i < fauldSides && j < fauldLevels) {
        const k = j * (fauldSides + 1) + i,
          n = k + fauldSides + 1;
        fauldIndices.push(k, k + 1, n, n, k + 1, n + 1);
      }
    }
  const fauld = new THREE.BufferGeometry();
  fauld.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(fauldPositions, 3),
  );
  fauld.setAttribute("uv", new THREE.Float32BufferAttribute(fauldUV, 2));
  fauld.setIndex(fauldIndices);
  fauld.computeVertexNormals();
  fauldRoot.add(new THREE.Mesh(fauld, metal));
  for (const top of [false, true]) {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2,
        s = Math.sin(a),
        c = Math.cos(a),
        t = top ? 1 : 0;
      const width = 0.156 + 0.035 * Math.sin(t * Math.PI * 0.83);
      points.push(
        new THREE.Vector3(
          s * width,
          top ? 0.195 + 0.045 * Math.abs(s) : -0.09,
          c * (c < 0 ? 0.159 - t * 0.009 : 0.13),
        ),
      );
    }
    // Keep the narrow rolled neckline smooth enough to match its physical
    // 3 mm section. Coarse long chords pushed its inner edge through cloth.
    root.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(points),
          128,
          0.003,
          4,
          false,
        ),
        edge,
      ),
    );
  }
  // The waist lames move with the pelvis. The short breast/back plate follows
  // the chest, so a deep crouch does not drag one long rigid bucket through legs.
  for (const t of [0, 0.5, 1]) {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2,
        bottom = -0.16 + 0.065 * Math.max(0, Math.cos(a));
      points.push(
        new THREE.Vector3(
          Math.sin(a) * THREE.MathUtils.lerp(0.165, 0.16, t),
          THREE.MathUtils.lerp(bottom, -0.085, t),
          Math.cos(a) * THREE.MathUtils.lerp(0.1574, 0.153, t),
        ),
      );
    }
    fauldRoot.add(curveTube(points, 0.002, edge));
  }
  batchStatic(fauldRoot);
  if (rig) {
    fauldRoot.position.set(0, 1.16, 0.01);
    rig.add(fauldRoot);
    rig.updateWorldMatrix(true, true);
    rig.getObjectByName("pelvis")?.attach(fauldRoot);
    fauldRoot.visible = false;
  } else root.add(fauldRoot);
  for (const side of [-1, 1]) {
    root.add(armourStrap(side, dark));
    for (const y of [-0.075, 0.045, 0.17]) {
      const rivet = new THREE.Mesh(
        new THREE.SphereGeometry(0.0048, 8, 6),
        edge,
      );
      const t = THREE.MathUtils.clamp(
        (y + 0.09) / (0.195 + 0.045 * 0.72 + 0.09),
        0,
        1,
      );
      const w = 0.156 + 0.035 * Math.sin(t * Math.PI * 0.83),
        d = 0.13 + Math.sin(t * Math.PI) * 0.016;
      rivet.position.set(
        side * 0.72 * w,
        y,
        Math.sqrt(1 - 0.72 ** 2) * d + 0.0005,
      );
      rivet.scale.z = 0.55;
      root.add(rivet);
    }
    const buckle = new THREE.Mesh(
      // A smooth centerline keeps the physical torus inside the exact 3 mm
      // cloth-coverage volume, including the inner side of the buckle.
      new THREE.TorusGeometry(0.013, 0.003, 8, 36),
      edge,
    );
    buckle.position.set(side * 0.126, 0.169, 0.116);
    buckle.scale.y = 1.3;
    root.add(buckle);
  }
  const shoulders: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const cap = shoulderLames(side, metal, edge);
    cap.name = side < 0 ? "ArmourShoulderR" : "ArmourShoulderL";
    if (rig) {
      cap.position.set(side * 0.15, 1.36, -0.02);
      rig.add(cap);
      rig.updateWorldMatrix(true, true);
      rig.getObjectByName(side < 0 ? "upperarm_R" : "upperarm_L")?.attach(cap);
      cap.visible = false;
      shoulders.push(cap);
    } else {
      cap.position.set(side * 0.15, 0.2, -0.03);
      root.add(cap);
    }
  }
  if (rig) registerArmourShoulders(rig, shoulders, root, fauldRoot);
  batchStatic(root);
  root.name = "ArmourGuardianCuirass";
  return root;
}

let glowTexture: THREE.CanvasTexture | undefined;
export function lootGlow(color: number) {
  if (!glowTexture) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "#fffffff0");
    gradient.addColorStop(0.2, "#ffffff70");
    gradient.addColorStop(1, "#ffffff00");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    glowTexture = new THREE.CanvasTexture(canvas);
  }
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture,
      color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  sprite.scale.setScalar(0.65);
  return sprite;
}
