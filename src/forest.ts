import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Point, Obstacle } from "./world-layout";
import { forestSupportHeight } from "./terrain-height.ts";

const rand = (i: number) => {
  const n = Math.sin(i * 127.13 + 6.71) * 43758.5453;
  return n - Math.floor(n);
};

function limb(
  a: THREE.Vector3,
  b: THREE.Vector3,
  r1: number,
  r2: number,
  segments = 2,
  sides = 7,
) {
  const g = new THREE.CylinderGeometry(
    r2,
    r1,
    a.distanceTo(b),
    sides,
    segments,
  );
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    b.clone().sub(a).normalize(),
  );
  g.applyQuaternion(q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

function branchTip(i: number, variant: number) {
  const y = 3.8 + (i % 4) * 0.97 + rand(i + variant * 9) * 0.9;
  const angle = i * 2.4 + variant * 0.7;
  const length = 1.5 + rand(i + variant * 14) * 1.7;
  return new THREE.Vector3(
    Math.sin(angle) * length,
    y + 1 + rand(i * 7) * 1.2,
    Math.cos(angle) * length,
  );
}

function treeGeometry(variant: number, detailed = true) {
  const pieces: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(
    0.115,
    0.385,
    9.1,
    detailed ? 9 : 8,
    detailed ? 10 : 6,
  );
  trunk.translate(0, 4.55, 0);
  const p = trunk.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / 9.1;
    p.setX(i, p.getX(i) + Math.sin(t * 2.8 + variant) * t * 0.42);
    p.setZ(i, p.getZ(i) + Math.sin(t * 2.1 + variant * 2) * t * 0.32);
  }
  trunk.computeVertexNormals();
  pieces.push(trunk);
  for (let i = 0; detailed && i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + variant * 0.7;
    pieces.push(
      limb(
        new THREE.Vector3(0, 0.2, 0),
        new THREE.Vector3(
          Math.sin(angle) * 0.78,
          -0.12,
          Math.cos(angle) * 0.78,
        ),
        0.14,
        0.035,
      ),
    );
  }
  for (const i of detailed ? [0, 1, 2, 3, 4, 5] : [0, 2, 4]) {
    const y = 3.8 + (i % 4) * 0.97 + rand(i + variant * 9) * 0.9;
    const a = i * 2.4 + variant * 0.7;
    const start = new THREE.Vector3(
      ((Math.sin((y / 9.1) * 2.8 + variant) * y) / 9.1) * 0.42,
      y,
      ((Math.sin((y / 9.1) * 2.1 + variant * 2) * y) / 9.1) * 0.32,
    );
    const end = branchTip(i, variant);
    pieces.push(
      limb(
        start,
        end,
        0.115 - i * 0.006,
        0.028,
        detailed ? 2 : 1,
        detailed ? 7 : 6,
      ),
    );
    if (detailed && i % 2 === 0) {
      const tip = end
        .clone()
        .add(
          new THREE.Vector3(
            Math.sin(a + 0.6) * 1.1,
            0.4,
            Math.cos(a + 0.6) * 1.1,
          ),
        );
      pieces.push(limb(end.clone().lerp(start, 0.3), tip, 0.046, 0.012));
    }
  }
  const geometry = mergeGeometries(pieces)!;
  for (const g of pieces) g.dispose();
  const positions = geometry.getAttribute("position"),
    uv = geometry.getAttribute("uv");
  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    const h = positions.getY(i),
      shade = 0.67 + 0.26 * Math.min(1, Math.max(0, h / 4));
    colors.set([shade * 0.98, shade, shade * 0.94], i * 3);
    uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 7);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function fernGeometry() {
  const positions: number[] = [],
    uv: number[] = [],
    colors: number[] = [];
  const triangle = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    shade: number,
  ) => {
    positions.push(...a.toArray(), ...b.toArray(), ...c.toArray());
    uv.push(0, 0, 1, 0, 0.5, 1);
    for (let i = 0; i < 3; i++) colors.push(shade * 0.92, shade, shade * 0.82);
  };
  for (let frond = 0; frond < 6; frond++) {
    const angle = (frond * Math.PI * 2) / 6;
    const forward = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    const side = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
    const length = 0.55 + rand(frond * 4) * 0.24;
    const point = (t: number) =>
      forward
        .clone()
        .multiplyScalar(length * t)
        .setY(Math.sin(t * Math.PI * 0.78) * 0.48);
    for (let stem = 0; stem < 6; stem++) {
      const a = point(stem / 7),
        b = point((stem + 1) / 7),
        width = 0.008 * (1 - stem / 8);
      triangle(
        a.clone().addScaledVector(side, -width),
        a.clone().addScaledVector(side, width),
        b,
        0.7,
      );
    }
    for (let leaf = 1; leaf <= 6; leaf++) {
      const t = leaf / 7.5;
      const root = point(t);
      const span = Math.sin(t * Math.PI) * 0.2 * (1 - t * 0.4);
      for (const sign of [-1, 1]) {
        const tip = root
          .clone()
          .addScaledVector(side, sign * span)
          .addScaledVector(forward, 0.095)
          .add(new THREE.Vector3(0, 0.015, 0));
        // A tapered curved leaflet, not one large triangular arrowhead.
        const mid = root
          .clone()
          .lerp(tip, 0.55)
          .addScaledVector(forward, -0.027)
          .add(new THREE.Vector3(0, 0.018, 0));
        const rear = mid.clone().addScaledVector(forward, 0.055);
        triangle(root, mid, tip, 0.69 + t * 0.2);
        triangle(root, tip, rear, 0.83 + t * 0.13);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

export function createForest(
  trees: readonly Point[],
  bark: THREE.MeshStandardMaterial,
  foliage: THREE.Texture,
  fern: THREE.Texture,
  solids: readonly Obstacle[] = [],
) {
  const root = new THREE.Group();
  root.name = "LayeredForest";
  const leafMaterial = new THREE.MeshStandardMaterial({
    map: foliage,
    color: 0xa0aa88,
    roughness: 1,
    alphaTest: 0.48,
    side: THREE.DoubleSide,
    fog: true,
  });
  const leafGeometry = new THREE.PlaneGeometry(4.2, 3.2);
  const farTree = (t: Point) => Math.abs(t.x) > 12 || t.z < -13.5;
  const shrubSites = Array.from({ length: 40 }, (_, i) => ({
    x: (i % 2 ? -1 : 1) * (4.9 + rand(i + 881) * 4.2),
    z: 11.6 - rand(i + 902) * 24.8,
  })).filter((p) =>
    solids.every((o) => {
      if ((o.minY ?? -Infinity) > 0.8 || (o.maxY ?? Infinity) < 0) return true;
      return (
        Math.hypot(
          Math.max(0, Math.abs(p.x - o.x) - o.hx),
          Math.max(0, Math.abs(p.z - o.z) - o.hz),
        ) > 0.8
      );
    }),
  );
  const leafCount =
    trees.reduce((n, t) => n + (farTree(t) ? 6 : 9), 0) + shrubSites.length * 4;
  const leaves = new THREE.InstancedMesh(leafGeometry, leafMaterial, leafCount);
  leaves.name = "ForestCanopies";
  const matrix = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    position = new THREE.Vector3(),
    scale = new THREE.Vector3();
  let leafCursor = 0;
  for (let group = 0; group < 4; group++) {
    const far = group === 3,
      variant = far ? 0 : group;
    const selected = trees
      .map((t, index) => ({ ...t, index }))
      .filter((t) =>
        far ? farTree(t) : !farTree(t) && t.index % 3 === variant,
      );
    const trunks = new THREE.InstancedMesh(
      treeGeometry(variant, !far),
      bark,
      selected.length,
    );
    trunks.name = `BranchedTrunks${far ? "Far" : variant}`;
    for (let j = 0; j < selected.length; j++) {
      const t = selected[j],
        i = t.index;
      const height = 0.86 + rand(i + 100) * 0.42;
      const ground = forestSupportHeight(t.x, t.z);
      position.set(t.x, ground - 0.07, t.z);
      const yaw = rand(i + 31) * Math.PI * 2,
        width = 0.9 + rand(i + 19) * 0.18;
      q.setFromEuler(new THREE.Euler(0, yaw, 0));
      scale.set(width, height, width);
      matrix.compose(position, q, scale);
      trunks.setMatrixAt(j, matrix);
      for (let slot = 0; slot < (far ? 6 : 9); slot++) {
        const layer = far ? [0, 2, 4, 6, 7, 8][slot] : slot;
        const angle = (layer % 6) * 2.4 + variant * 0.7 + yaw;
        // Each lower cluster grows around the end of a visible branch. The
        // final three clusters are anchored to the upper part of the trunk.
        const crownY = 8.0 + (layer - 6) * 0.38;
        const tip =
          layer < 6
            ? branchTip(layer, variant)
            : new THREE.Vector3(
                ((Math.sin((crownY / 9.1) * 2.8 + variant) * crownY) / 9.1) *
                  0.42,
                crownY,
                ((Math.sin((crownY / 9.1) * 2.1 + variant * 2) * crownY) /
                  9.1) *
                  0.32,
              );
        tip.x *= width;
        tip.y *= height;
        tip.z *= width;
        tip.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        position.set(t.x + tip.x, ground - 0.07 + tip.y + 0.24, t.z + tip.z);
        q.setFromEuler(
          new THREE.Euler(
            -0.25 + rand(layer + i * 9) * 0.8,
            angle,
            rand(layer + 41) * 0.55 - 0.27,
          ),
        );
        scale.set(
          0.9 + rand(i + layer * 9) * 0.5,
          0.82 + rand(i + layer) * 0.55,
          1,
        );
        matrix.compose(position, q, scale);
        leaves.setMatrixAt(leafCursor++, matrix);
      }
    }
    trunks.computeBoundingSphere();
    root.add(trunks);
  }
  for (let i = 0; i < shrubSites.length; i++) {
    const site = shrubSites[i],
      h = 0.42 + rand(i + 983) * 0.38;
    for (let j = 0; j < 4; j++) {
      const a = (j * Math.PI) / 2 + rand(i + 91);
      position.set(
        site.x + Math.sin(a) * 0.18,
        forestSupportHeight(site.x, site.z) + h * 0.405,
        site.z + Math.cos(a) * 0.18,
      );
      q.setFromEuler(
        new THREE.Euler(-0.22 + (j % 2) * 0.42, a, 0.08 * Math.sin(i + j)),
      );
      scale.set(0.28 + rand(i + j + 8) * 0.09, h / 3.2, 1);
      matrix.compose(position, q, scale);
      leaves.setMatrixAt(leafCursor++, matrix);
    }
  }
  leaves.computeBoundingSphere();
  root.add(leaves);
  const fernMaterial = new THREE.MeshStandardMaterial({
    map: fern,
    color: 0x909e78,
    roughness: 1,
    fog: true,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  const plants: { x: number; z: number; scale: number; yaw: number }[] = [];
  for (let i = 0; i < 500 && plants.length < 96; i++) {
    const side = i % 2 ? -1 : 1;
    const x = side * (3.4 + rand(i + 65) * 5.8);
    const z = 12.8 - rand(i + 132) * 25.0;
    const size = 0.65 + rand(i + 29) * 0.9;
    const radius = 0.83 * size + 0.08;
    const clear = solids.every((o) => {
      if ((o.minY ?? -Infinity) > 0.8 || (o.maxY ?? Infinity) < 0) return true;
      const dx = Math.max(0, Math.abs(x - o.x) - o.hx);
      const dz = Math.max(0, Math.abs(z - o.z) - o.hz);
      return dx * dx + dz * dz > radius * radius;
    });
    if (clear)
      plants.push({ x, z, scale: size, yaw: rand(i + 151) * Math.PI * 2 });
  }
  const ferns = new THREE.InstancedMesh(
    fernGeometry(),
    fernMaterial,
    plants.length,
  );
  ferns.name = "ForestUnderstory";
  for (let i = 0; i < plants.length; i++) {
    const plant = plants[i];
    position.set(
      plant.x,
      forestSupportHeight(plant.x, plant.z) + 0.015,
      plant.z,
    );
    q.setFromEuler(new THREE.Euler(0, plant.yaw, 0));
    scale.setScalar(plant.scale);
    matrix.compose(position, q, scale);
    ferns.setMatrixAt(i, matrix);
  }
  ferns.computeBoundingSphere();
  root.add(ferns);
  return root;
}
