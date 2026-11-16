import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { registerArmourShoulders } from "./character-appearance.ts";

// Small original meshes. They share geometry/materials when cloned and have no
// decoder, network, animation-mixer or per-frame allocation cost.
export function flaskModel() {
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
      color: 0x753e45,
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
export function setFlaskFill(root: THREE.Object3D, fraction: number) {
  const liquid = root.getObjectByName("FlaskLiquid") as THREE.Mesh | undefined;
  if (!liquid) return;
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
function hammeredSteel() {
  if (steelTexture) return steelTexture;
  const size = 128,
    data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const noise = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      const grain = noise - Math.floor(noise);
      const hammer =
        Math.sin(x * 0.57 + Math.sin(y * 0.39)) *
        Math.cos(y * 0.51 + Math.sin(x * 0.42));
      const tone = 0.82 + grain * 0.13 + hammer * 0.06;
      const index = (y * size + x) * 4;
      data[index] = 180 * tone;
      data[index + 1] = 177 * tone;
      data[index + 2] = 169 * tone;
      data[index + 3] = 255;
    }
  steelTexture = new THREE.DataTexture(data, size, size);
  steelTexture.colorSpace = THREE.SRGBColorSpace;
  steelTexture.wrapS = steelTexture.wrapT = THREE.RepeatWrapping;
  steelTexture.needsUpdate = true;
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
      Math.max(12, points.length * 2),
      radius,
      6,
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
      const width = 0.176 + 0.048 * Math.sin(t * Math.PI * 0.83);
      const y = THREE.MathUtils.lerp(-0.09, 0.195 + 0.045 * Math.abs(xUnit), t);
      const depth = back
        ? 0.177 - t * 0.025
        : 0.148 + Math.sin(t * Math.PI) * 0.034;
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
  new THREE.Vector3(0.169, 0.185, 0.126),
  new THREE.Vector3(0.1755, 0.265, 0.025),
  new THREE.Vector3(0.169, 0.185, -0.15),
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
          p.x + width * 0.018,
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

export function armourModel(rig?: THREE.Object3D) {
  const root = new THREE.Group();
  root.userData.fixes1StrapPath = new THREE.CatmullRomCurve3(STRAP_PATH)
    .getPoints(8)
    .map((p) => new THREE.Vector2(p.y, p.z));
  const metal = new THREE.MeshStandardMaterial({
    color: 0x858078,
    map: hammeredSteel(),
    metalness: 0.7,
    roughness: 0.57,
    side: THREE.DoubleSide,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x443c32,
    metalness: 0.06,
    roughness: 0.96,
  });
  const edge = new THREE.MeshStandardMaterial({
    color: 0xa09a8c,
    map: hammeredSteel(),
    metalness: 0.68,
    roughness: 0.58,
  });
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
        Math.sin(a) * THREE.MathUtils.lerp(0.1875, 0.18, t),
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
      const width = 0.176 + 0.048 * Math.sin(t * Math.PI * 0.83);
      points.push(
        new THREE.Vector3(
          s * width,
          top ? 0.195 + 0.045 * Math.abs(s) : -0.09,
          c * (c < 0 ? 0.177 - t * 0.025 : 0.148),
        ),
      );
    }
    root.add(curveTube(points, 0.005, edge));
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
          Math.sin(a) * THREE.MathUtils.lerp(0.1875, 0.18, t),
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
      rivet.position.set(side * 0.178, y, 0.112);
      rivet.scale.z = 0.55;
      root.add(rivet);
    }
    const buckle = new THREE.Mesh(
      new THREE.TorusGeometry(0.013, 0.003, 5, 10),
      edge,
    );
    buckle.position.set(side * 0.164, 0.178, 0.143);
    buckle.scale.y = 1.3;
    root.add(buckle);
  }
  const shoulders: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const cap = new THREE.Group();
    cap.name = side < 0 ? "ArmourShoulderR" : "ArmourShoulderL";
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      metal,
    );
    shell.scale.set(0.103, 0.06, 0.113);
    cap.add(shell);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.034, 5, 28), edge);
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(0.102, 0.112, 0.102);
    cap.add(rim);
    batchStatic(cap);
    if (rig) {
      cap.position.set(side * 0.212, 1.366, -0.01);
      rig.add(cap);
      rig.updateWorldMatrix(true, true);
      rig.getObjectByName(side < 0 ? "upperarm_R" : "upperarm_L")?.attach(cap);
      cap.visible = false;
      shoulders.push(cap);
    } else {
      cap.position.set(side * 0.212, 0.206, -0.02);
      root.add(cap);
    }
  }
  if (rig) registerArmourShoulders(rig, shoulders, root, fauldRoot);
  batchStatic(root);
  root.name = "ArmourGuardianCuirass";
  return root;
}

export function blackGate() {
  const root = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({
    color: 0x161d22,
    metalness: 0.45,
    roughness: 0.8,
  });
  const edge = new THREE.MeshStandardMaterial({
    color: 0x737e82,
    metalness: 0.65,
    roughness: 0.6,
  });
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.name = side < 0 ? "GateLeft" : "GateRight";
    pivot.position.x = side * 1.52;
    const leaf = new THREE.Group();
    leaf.position.x = -side * 0.76;
    pivot.add(leaf);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.95, 0.12), metal);
    panel.position.y = 1.49;
    leaf.add(panel);
    for (const y of [0.18, 1, 2.05, 2.82]) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.065, 0.18), edge);
      rib.position.y = y;
      leaf.add(rib);
      for (const x of [-0.61, -0.3, 0, 0.3, 0.61]) {
        const rivet = new THREE.Mesh(
          new THREE.SphereGeometry(0.022, 6, 4),
          edge,
        );
        rivet.position.set(x, y, 0.11);
        leaf.add(rivet);
      }
    }
    for (const x of [-0.67, 0.67]) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.09, 3, 0.2), edge);
      rib.position.set(x, 1.5, 0);
      leaf.add(rib);
    }
    const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const mesh of [...leaf.children] as THREE.Mesh[]) {
      mesh.updateMatrix();
      const material = mesh.material as THREE.Material;
      const batch = batches.get(material) ?? [];
      batch.push(mesh.geometry.clone().applyMatrix4(mesh.matrix));
      batches.set(material, batch);
      mesh.geometry.dispose();
    }
    leaf.clear();
    for (const [material, geometries] of batches) {
      leaf.add(new THREE.Mesh(mergeGeometries(geometries)!, material));
      for (const g of geometries) g.dispose();
    }
    root.add(pivot);
  }
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
