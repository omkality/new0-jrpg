import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import headData from "./human-head-data.json" with { type: "json" };

type Palette = {
  skin: number;
  lips: number;
  hair: number;
  iris: number;
  age: number;
};
const g = (a: number, b: number, w: number) => Math.exp(-(((a - b) / w) ** 2));
const s = THREE.MathUtils.smoothstep;
function colours(
  geometry: THREE.BufferGeometry,
  paint: (v: THREE.Vector3) => THREE.Color,
) {
  const p = geometry.getAttribute("position"),
    c = new Float32Array(p.count * 3),
    v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++)
    paint(v.fromBufferAttribute(p, i)).toArray(c, i * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(c, 3));
  geometry.deleteAttribute("uv");
  return geometry;
}
function line(points: THREE.Vector3[], radius: number, c: number) {
  const geometry = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(points),
      12,
      radius,
      4,
      false,
    ),
    colour = new THREE.Color(c);
  return colours(geometry, () => colour);
}
// Anatomical head derived from the CC0 MakeHuman core mesh and adult macro
// targets. Provenance and a reproducible extraction live with the asset tools.
export function humanHead(
  kind: "pilgrim" | "watcher" | "effigy",
  palette: Palette,
) {
  const hero = kind === "pilgrim",
    data = hero ? headData.female : headData.male;
  const skin = new THREE.Color(palette.skin),
    lips = new THREE.Color(palette.lips),
    hairColour = new THREE.Color(palette.hair),
    parts: THREE.BufferGeometry[] = [];
  const face = new THREE.BufferGeometry(),
    positions = new Float32Array(data.positions);
  const nativeMouthY = hero ? 1.552 : 1.541;
  const faceY = (y: number) =>
    hero ? y + 0.009 * g(y, 1.538, 0.035) + 0.003 * g(y, 1.582, 0.025) : y;
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1],
      z = positions[i + 2];
    if (y < 1.528 && z < 0.045) {
      const t = 1 - s(y, 1.492, 1.528),
        radius = Math.hypot(positions[i] / 0.035, (z + 0.018) / 0.031);
      if (radius > 1) {
        const scale = THREE.MathUtils.lerp(1, 1 / radius, t);
        positions[i] *= scale;
        positions[i + 2] = -0.018 + (z + 0.018) * scale;
      }
    }
    // The neutral source has a very narrow lip opening. Close it by bringing
    // both lip margins together, keeping their volume and the surrounding jaw.
    if (!hero && z > 0.085 && Math.abs(positions[i]) < 0.039) {
      const d = y - nativeMouthY,
        weight = g(positions[i], 0, 0.031) * g(d, 0, 0.009);
      positions[i + 1] -= Math.sign(d) * 0.0013 * weight;
    }
    if (hero) {
      positions[i + 1] = faceY(positions[i + 1]);
      positions[i] +=
        Math.sign(positions[i]) *
        0.0019 *
        g(y, 1.587, 0.02) *
        g(Math.abs(positions[i]), 0.044, 0.023) *
        s(z, 0.015, 0.075);
      if (z > 0.085)
        positions[i + 2] =
          0.085 + (z - 0.085) * (0.84 + 0.16 * (1 - g(y, 1.58, 0.025)));
      const nose = g(y, 1.585, 0.016) * s(z, 0.088, 0.101);
      positions[i] *= 1 - 0.09 * nose;
    }
    if (kind === "effigy") positions[i] *= 0.97;
  }
  face.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  face.setIndex(data.indices);
  face.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(data.normals, 3),
  );
  parts.push(
    colours(face, (v) => {
      const front = s(v.z, 0.025, 0.075),
        c = skin.clone();
      const mouth =
        g(v.y, faceY(nativeMouthY), 0.0048) *
        Math.exp(-((v.x / (hero ? 0.025 : 0.029)) ** 6)) *
        front;
      c.lerp(lips, mouth * (hero ? 0.6 : 0.78));
      const cheeks =
        (g(v.x, -0.045, 0.023) + g(v.x, 0.045, 0.023)) *
        g(v.y, 1.58, 0.022) *
        front;
      c.lerp(
        new THREE.Color(hero ? 0xbf867d : 0x8d8577),
        cheeks * (hero ? 0.09 : 0.04),
      );
      const lids =
        (g(v.x, -0.028, 0.018) + g(v.x, 0.028, 0.018)) *
        g(v.y, 1.605, 0.006) *
        front;
      c.lerp(new THREE.Color(0x8c827b), lids * (0.035 + palette.age * 0.11));
      return c;
    }),
  );
  // Query the actual anatomical surface for the brows and conforming hair.
  const probeMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    probe = new THREE.Mesh(face, probeMaterial),
    ray = new THREE.Raycaster();
  probe.updateMatrixWorld(true);
  const surface = (x: number, y: number) => {
    ray.set(new THREE.Vector3(x, y, 0.3), new THREE.Vector3(0, 0, -1));
    return ray.intersectObject(probe, false)[0]?.point.z ?? 0.071;
  };
  for (const eye of data.eyes) {
    const center = new THREE.Vector3().fromArray(eye),
      radius = 0.01455;
    const globe = new THREE.SphereGeometry(radius, 16, 10);
    globe.translate(...(eye as [number, number, number]));
    const white = new THREE.Color(hero ? 0xcac6b8 : 0xb9b8a7);
    parts.push(colours(globe, () => white));
    const iris = new THREE.BufferGeometry(),
      ip: number[] = [],
      ic: number[] = [],
      ii: number[] = [],
      rings = 5,
      sides = 24;
    const base = new THREE.Color(palette.iris),
      pupil = new THREE.Color(0x111714);
    for (let j = 0; j <= rings; j++)
      for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * Math.PI * 2,
          r = (j / rings) * 0.0058;
        ip.push(
          center.x + Math.cos(a) * r,
          center.y + Math.sin(a) * r,
          center.z + Math.sqrt(radius * radius - r * r) + 0.00015,
        );
        const c =
          j < 2
            ? pupil.clone()
            : base.clone().multiplyScalar(0.72 + 0.25 * Math.sin(a * 11 + j));
        if (j === rings) c.multiplyScalar(0.55);
        c.toArray(ic, (j * (sides + 1) + i) * 3);
        if (j < rings && i < sides) {
          const a = j * (sides + 1) + i,
            b = a + sides + 1;
          ii.push(a, a + 1, b, b, a + 1, b + 1);
        }
      }
    iris.setAttribute("position", new THREE.Float32BufferAttribute(ip, 3));
    iris.setAttribute("color", new THREE.Float32BufferAttribute(ic, 3));
    iris.setIndex(ii);
    iris.computeVertexNormals();
    parts.push(iris);
    const brow: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) {
      const u = (i / 10) * 2 - 1,
        x = center.x + u * (hero ? 0.0175 : 0.0185),
        y =
          center.y +
          (hero ? 0.0135 : 0.019) +
          (hero ? 0.0018 : 0.0035) * (1 - u * u) +
          Math.sign(center.x) * u * 0.001;
      brow.push(new THREE.Vector3(x, y, surface(x, y) + 0.0004));
    }
    const browColour = hero
      ? hairColour.clone().lerp(skin, 0.15).getHex()
      : palette.hair;
    parts.push(line(brow, hero ? 0.0008 : 0.0016, browColour));
  }
  const mouthY = faceY(nativeMouthY);
  const mouthZ = surface(0, mouthY);
  // A recessed cap closes the male mouth. The heroine uses a small inverse
  // jaw-opening expression authored into the source mesh with correct normals.
  if (!hero) {
    const lp: number[] = [],
      li: number[] = [],
      lipSteps = 24;
    for (let i = 0; i <= lipSteps; i++) {
      const x = ((i / lipSteps) * 2 - 1) * (hero ? 0.025 : 0.027),
        falloff = Math.sqrt(Math.max(0, 1 - ((i / lipSteps) * 2 - 1) ** 2));
      const centerY = mouthY - 0.0004 * (Math.abs(x) / 0.025) ** 2;
      const z = surface(x, centerY) + 0.0022;
      for (const side of [-1, 1])
        lp.push(x, centerY + side * (hero ? 0.0038 : 0.0026) * falloff, z);
      if (i < lipSteps) {
        const a = i * 2;
        li.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
    const closedLips = new THREE.BufferGeometry();
    closedLips.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(lp, 3),
    );
    closedLips.setIndex(li);
    closedLips.computeVertexNormals();
    parts.push(
      colours(closedLips, () => skin.clone().lerp(lips, hero ? 0.48 : 0.62)),
    );
  }
  // Layered tapered bob follows the skull, with a side part and pointed ends.
  // It is a hair volume rather than the old flat-edged cylindrical cap.
  const hp: number[] = [],
    hi: number[] = [],
    rings = 16,
    sides = 36;
  for (let j = 0; j <= rings; j++)
    for (let i = 0; i <= sides; i++) {
      const theta = (i / sides) * Math.PI * 2,
        t = j / rings,
        front = Math.cos(theta),
        wrapped = Math.atan2(Math.sin(theta), Math.cos(theta));
      const fringe = hero ? 0.018 * g(wrapped, -0.42, 0.5) : 0.005;
      const bob = hero
        ? 1.489 +
          0.012 * Math.sin(theta * 2 + 0.7) +
          0.007 * Math.cos(theta * 5)
        : 1.55 + 0.009 * Math.cos(theta * 3);
      const bottom = THREE.MathUtils.lerp(
        bob,
        1.676 - fringe,
        s(front, 0.3, 0.87),
      );
      const y = THREE.MathUtils.lerp(1.734, bottom, t ** 1.55),
        crown = Math.max(0, (y - 1.607) / 0.127);
      const radius = Math.sqrt(Math.max(0, 1 - crown * crown)),
        taper = 1 - 0.11 * s(t, 0.75, 1) * (1 - s(front, 0.3, 0.87));
      ray.set(
        new THREE.Vector3(0, Math.max(1.605, y), 0.015),
        new THREE.Vector3(Math.sin(theta), 0, Math.cos(theta)),
      );
      const at = ray.intersectObject(probe, false)[0]?.point;
      const rounded = (hero ? 0.087 : 0.09) * radius;
      const r = at
        ? Math.max(Math.hypot(at.x, at.z - 0.015) + 0.006, rounded)
        : rounded;
      hp.push(
        Math.sin(theta) * r * taper,
        y,
        Math.cos(theta) * r * taper + 0.015,
      );
      if (j < rings && i < sides) {
        const a = j * (sides + 1) + i,
          b = a + sides + 1;
        hi.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  const hair = new THREE.BufferGeometry();
  hair.setAttribute("position", new THREE.Float32BufferAttribute(hp, 3));
  hair.setIndex(hi);
  hair.computeVertexNormals();
  parts.push(
    colours(hair, (v) =>
      hairColour
        .clone()
        .multiplyScalar(
          0.91 + 0.08 * Math.sin(v.x * 230 + v.z * 144 + v.y * 5),
        ),
    ),
  );
  const lock = (points: THREE.Vector3[], width: number) => {
    const curve = new THREE.CatmullRomCurve3(points),
      p: number[] = [],
      idx: number[] = [],
      n = 12;
    for (let i = 0; i <= n; i++) {
      const t = i / n,
        v = curve.getPoint(t),
        tangent = curve.getTangent(t),
        side = new THREE.Vector3(tangent.y, -tangent.x, 0).normalize();
      const w =
        width * (0.7 + 0.3 * Math.sin(t * Math.PI)) * (1 - s(t, 0.78, 1));
      for (const sign of [-1, 1])
        p.push(
          v.x + side.x * w * sign,
          v.y + side.y * w * sign,
          v.z + side.z * w * sign,
        );
      if (i < n) {
        const k = i * 2;
        idx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    geometry.setIndex(idx);
    geometry.computeVertexNormals();
    return colours(geometry, (v) =>
      hairColour.clone().multiplyScalar(1.04 + 0.08 * Math.sin(v.y * 170)),
    );
  };
  if (hero) {
    parts.push(
      lock(
        [
          new THREE.Vector3(0.019, 1.714, 0.058),
          new THREE.Vector3(-0.026, 1.683, 0.087),
          new THREE.Vector3(-0.064, 1.623, 0.068),
        ],
        0.008,
      ),
    );
  }
  probeMaterial.dispose();
  const geometry = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.84,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );
  mesh.name = "fixes1_sculpted_head";
  mesh.userData.fixes1OwnedGeometry = true;
  const group = new THREE.Group();
  group.name = `fixes2_${kind}_face`;
  group.add(mesh);
  const mouth = new THREE.Object3D();
  mouth.name = "fixes1_mouth";
  mouth.position.set(0, mouthY, mouthZ + 0.001);
  group.add(mouth);
  return group;
}
