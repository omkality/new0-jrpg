import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { AppearanceKind } from "../character-appearance";

type Point = [number, number, number];
type Ring = [number, number, number, number?]; // height, width, depth, depth offset
const v = (p: Point) => new T.Vector3(...p);
const TAU = Math.PI * 2;

// Each costume is modelled in metres in the unobstructed bind pose. Rigid pieces
// attach to their actual bones; each bone submits just one vertex-painted mesh.
function patina() {
  const size = 64,
    pixels = new Uint8Array(size * size * 4);
  let seed = 716216;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const nick = (x * 7 + y * 13) % 53 < 2 && y % 15 < 9;
      const value = Math.round(
        229 +
          12 * (seed / 4294967296) +
          5 * Math.sin(y * 0.93 + x * 0.18) -
          (nick ? 28 : 0),
      );
      pixels.set([value, value, value, 255], (y * size + x) * 4);
    }
  const tex = new T.DataTexture(pixels, size, size);
  tex.colorSpace = T.SRGBColorSpace;
  tex.wrapS = tex.wrapT = T.RepeatWrapping;
  tex.magFilter = T.NearestFilter;
  tex.minFilter = T.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
class Carving {
  private pieces: T.BufferGeometry[] = [];
  private material = new T.MeshStandardMaterial({
    vertexColors: true,
    map: patina(),
    side: T.DoubleSide,
    roughness: 0.72,
    metalness: 0.1,
  });
  add(g: T.BufferGeometry, tint: number) {
    const attr = g.getAttribute("position"),
      color = new T.Color(tint),
      data: number[] = [],
      uv: number[] = [];
    for (let i = 0; i < attr.count; i++) {
      const x = attr.getX(i),
        y = attr.getY(i),
        z = attr.getZ(i);
      const stain =
        0.89 +
        0.09 * Math.sin(x * 29 + y * 41 + z * 27) +
        0.05 * Math.sin(x * 89 - y * 52);
      data.push(color.r * stain, color.g * stain, color.b * stain);
      uv.push((x + 0.33 * z) * 3.7, (y + 0.61 * z) * 3.7);
    }
    g.setAttribute("color", new T.Float32BufferAttribute(data, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    if (g.index) {
      this.pieces.push(g.toNonIndexed());
      g.dispose();
    } else this.pieces.push(g);
  }
  bulb(c: Point, r: Point, colour: number, tilt = 0) {
    const g = new T.SphereGeometry(1, 12, 9);
    g.scale(...r);
    g.rotateZ(tilt);
    g.translate(...c);
    this.add(g, colour);
  }
  // Tapered, curved ridge. Width can fall to a needle at either end.
  horn(points: Point[], radii: number[], color: number, depth = 1) {
    const p: number[] = [],
      ix: number[] = [];
    const sides = 8;
    for (let i = 0; i < points.length; i++) {
      const axis = v(points[Math.min(i + 1, points.length - 1)])
        .sub(v(points[Math.max(0, i - 1)]))
        .normalize();
      const across = new T.Vector3()
        .crossVectors(
          axis,
          Math.abs(axis.x) > 0.88
            ? new T.Vector3(0, 0, 1)
            : new T.Vector3(1, 0, 0),
        )
        .normalize();
      const up = axis.clone().cross(across).normalize();
      for (let j = 0; j < sides; j++) {
        const a = (TAU * j) / sides;
        p.push(
          ...v(points[i])
            .addScaledVector(across, radii[i] * Math.cos(a) * depth)
            .addScaledVector(up, radii[i] * Math.sin(a))
            .toArray(),
        );
        if (i) {
          const a0 = (i - 1) * sides + j,
            b = (i - 1) * sides + ((j + 1) % sides);
          ix.push(a0, b, a0 + sides, b, b + sides, a0 + sides);
        }
      }
    }
    this.surface(p, ix, color);
  }
  shell(
    rows: Ring[],
    color: number,
    opening = 0,
    flutes = 0,
    hem = 0,
    centreX = 0,
  ) {
    const sides = 32,
      p: number[] = [],
      ix: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const [h, w, d, z = 0] = rows[i];
      for (let j = 0; j <= sides; j++) {
        const a = opening + ((TAU - 2 * opening) * j) / sides,
          fold = 1 + flutes * Math.cos(12 * a + 0.3 * i);
        p.push(
          centreX + w * Math.sin(a) * fold,
          h + (i === 0 ? hem * Math.cos(7 * a) : 0),
          z + d * Math.cos(a) * fold,
        );
        if (i && j) {
          const k = i * (sides + 1) + j;
          ix.push(k - sides - 2, k - sides - 1, k, k - sides - 2, k, k - 1);
        }
      }
    }
    this.surface(p, ix, color);
  }
  feather(a: Point, b: Point, width: number, colour: number) {
    const base = v(a),
      tip = v(b);
    const path = tip.clone().sub(base);
    const side = new T.Vector3(1, 0, 0)
      .addScaledVector(path, -path.x / path.lengthSq())
      .normalize();
    const mid = base.clone().lerp(tip, 0.43),
      ridge = mid.clone();
    ridge.z += a[2] >= 0 ? 0.012 : -0.012;
    const points = [
      base,
      mid.clone().addScaledVector(side, width),
      tip,
      mid.clone().addScaledVector(side, -width),
      ridge,
    ];
    this.surface(
      points.flatMap((p) => p.toArray()),
      [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4],
      colour,
    );
  }
  private surface(p: number[], ix: number[], colour: number) {
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(p, 3));
    g.setIndex(ix);
    g.computeVertexNormals();
    this.add(g, colour);
  }
  mount(rig: T.Object3D, bone: string, name: string) {
    const joint = rig.getObjectByName(bone);
    if (!joint) throw new Error("Missing costume bone " + bone);
    const geometry = mergeGeometries(this.pieces)!;
    this.pieces.forEach((g) => g.dispose());
    this.pieces = [];
    const mesh = new T.Mesh(geometry, this.material);
    mesh.name = name;
    mesh.frustumCulled = false;
    rig.add(mesh);
    rig.updateWorldMatrix(true, true);
    joint.attach(mesh);
  }
}
const bone = 0xc5c4ac,
  root = 0x49433f,
  feathers = [0x343d45, 0x49535a, 0x586262, 0x3e444c];
function singer(rig: T.Object3D, c: Carving) {
  c.shell(
    [
      [1.46, 0.061, 0.083],
      [1.53, 0.107, 0.128],
      [1.64, 0.135, 0.148],
      [1.7, 0.103, 0.117],
      [1.737, 0.029, 0.049],
      [1.742, 0.002, 0.002],
    ],
    bone,
    0,
    0.025,
  );
  // Two separate hooked mandibles; the dark opening remains visible in profile.
  c.horn(
    [
      [0, 1.607, 0.096],
      [0, 1.609, 0.164],
      [0, 1.585, 0.227],
      [0, 1.547, 0.287],
      [0, 1.514, 0.294],
    ],
    [0.071, 0.054, 0.036, 0.014, 0.001],
    0xb8ac8c,
    0.68,
  );
  c.horn(
    [
      [0, 1.521, 0.093],
      [0, 1.535, 0.166],
      [0, 1.543, 0.221],
      [0, 1.538, 0.254],
    ],
    [0.05, 0.028, 0.015, 0.001],
    0x807565,
    0.52,
  );
  for (const s of [-1, 1]) {
    c.bulb(
      [s * 0.092, 1.626, 0.094],
      [0.049, 0.032, 0.032],
      0x1f272a,
      s * -0.39,
    );
    c.bulb([s * 0.098, 1.623, 0.126], [0.013, 0.008, 0.007], 0xdedbc7);
    c.horn(
      [
        [s * 0.133, 1.622, 0.042],
        [s * 0.124, 1.573, 0.068],
        [s * 0.08, 1.544, 0.12],
        [s * 0.033, 1.533, 0.144],
      ],
      [0.014, 0.017, 0.012, 0.006],
      0x928c78,
    );
    c.horn(
      [
        [s * 0.113, 1.645, 0.077],
        [s * 0.094, 1.673, 0.094],
        [s * 0.063, 1.69, 0.111],
      ],
      [0.007, 0.009, 0.002],
      0xf1edd3,
    );
    c.bulb([s * 0.038, 1.614, 0.18], [0.011, 0.009, 0.019], 0x4b473e);
    c.horn(
      [
        [s * 0.036, 1.654, 0.131],
        [s * 0.1, 1.668, 0.105],
        [s * 0.137, 1.656, 0.052],
        [s * 0.139, 1.631, 0.021],
      ],
      [0.016, 0.022, 0.017, 0.007],
      0xd6d2b9,
    );
    c.horn(
      [
        [s * 0.1, 1.65, -0.025],
        [s * 0.144, 1.77, -0.084],
        [s * 0.183, 1.84, -0.136],
        [s * 0.201, 1.94, -0.182],
        [s * 0.228, 1.98, -0.202],
      ],
      [0.033, 0.024, 0.019, 0.011, 0.001],
      root,
    );
    c.horn(
      [
        [s * 0.177, 1.83, -0.128],
        [s * 0.24, 1.86, -0.116],
        [s * 0.267, 1.92, -0.1],
      ],
      [0.017, 0.012, 0.001],
      0x807e70,
    );
    c.horn(
      [
        [s * 0.141, 1.764, -0.082],
        [s * 0.105, 1.827, -0.15],
        [s * 0.105, 1.879, -0.172],
      ],
      [0.014, 0.009, 0.001],
      0x776e60,
    );
  }
  c.mount(rig, "head", "CantorSkull");
  c.shell(
    [
      [1.15, 0.255, 0.16],
      [1.36, 0.241, 0.155],
      [1.46, 0.119, 0.11],
      [1.51, 0.074, 0.089],
    ],
    0x3c4347,
    0,
    0.09,
    0.039,
  );
  for (let layer = 0; layer < 2; layer++)
    for (let i = 0; i < 24; i++) {
      const a = (TAU * (i + 0.45 * layer)) / 24,
        w = Math.sin(a),
        d = Math.cos(a),
        fringe = (i % 5) * 0.014;
      c.feather(
        [
          w * (0.12 + layer * 0.095),
          1.435 - layer * 0.09,
          d * (0.12 + layer * 0.032),
        ],
        [
          w * (0.28 + 0.045 * layer),
          1.18 - layer * 0.11 - fringe,
          d * (0.174 + 0.039 * layer),
        ],
        0.035,
        feathers[(i + layer) % feathers.length],
      );
    }
  c.mount(rig, "chest", "CantorRuff");
  for (const [s, side] of [
    [1, "L"],
    [-1, "R"],
  ] as const) {
    for (let i = 0; i < 5; i++) {
      const u = i / 5;
      c.feather(
        [s * (0.31 + 0.12 * u), 1.117 - 0.15 * u, -0.054 + 0.04 * u],
        [s * (0.43 + 0.1 * u), 0.947 - 0.145 * u, -0.141 + 0.023 * u],
        0.031,
        feathers[i % 4],
      );
    }
    c.mount(rig, "forearm_" + side, "CantorFlightFeathers" + side);
    c.horn(
      [
        [s * 0.103, 0.48, 0.03],
        [s * 0.11, 0.3, 0.012],
        [s * 0.12, 0.135, 0.009],
      ],
      [0.03, 0.023, 0.013],
      0x938e7e,
      0.65,
    );
    c.mount(rig, "shin_" + side, "CantorGreave" + side);
    for (let i = -1; i <= 1; i++)
      c.horn(
        [
          [s * 0.116 + i * 0.021, 0.061, 0.047],
          [s * 0.118 + i * 0.036, 0.048, 0.106],
          [s * 0.118 + i * 0.052, 0.041, 0.158 - i * i * 0.02],
          [s * 0.12 + i * 0.052, 0.024, 0.17 - i * i * 0.02],
        ],
        [0.015, 0.013, 0.007, 0.001],
        0x8a8274,
      );
    c.mount(rig, "foot_" + side, "CantorTalons" + side);
  }
}
function sexton(rig: T.Object3D, c: Carving) {
  const iron = 0x626c75,
    edge = 0xa5a8a1,
    brass = 0x9a8661;
  // The pointed helm is open across the eyes. A dark recess and individual
  // slats give the iron cage a different profile from the singer's skull.
  c.shell(
    [
      [1.415, 0.121, 0.135],
      [1.49, 0.151, 0.159],
      [1.576, 0.16, 0.167],
    ],
    iron,
    0,
    0.045,
  );
  c.bulb([0, 1.613, -0.015], [0.13, 0.115, 0.139], 0x665f59);
  c.horn(
    [
      [0, 1.656, 0.126],
      [0, 1.615, 0.148],
      [0, 1.583, 0.158],
    ],
    [0.022, 0.015, 0.009],
    0xa29381,
  );
  for (const s of [-1, 1]) {
    c.bulb(
      [s * 0.066, 1.622, 0.106],
      [0.039, 0.024, 0.025],
      0x25292e,
      s * -0.19,
    );
    c.bulb([s * 0.066, 1.621, 0.131], [0.009, 0.007, 0.007], 0xd4d1ae);
    c.horn(
      [
        [s * 0.105, 1.615, 0.08],
        [s * 0.09, 1.586, 0.115],
        [s * 0.046, 1.57, 0.129],
      ],
      [0.012, 0.015, 0.007],
      0x938778,
    );
  }
  c.shell(
    [
      [1.652, 0.172, 0.174],
      [1.708, 0.154, 0.164],
      [1.82, 0.107, 0.121],
      [1.965, 0.031, 0.044],
      [2.025, 0.003, 0.003],
    ],
    iron,
    0,
    0.075,
  );
  for (let i = 0; i < 13; i++) {
    const a = (i * TAU) / 13;
    const s = Math.sin(a),
      d = Math.cos(a);
    c.horn(
      [
        [s * 0.156, 1.566, d * 0.167],
        [s * 0.169, 1.605, d * 0.18],
        [s * 0.171, 1.667, d * 0.175],
      ],
      [0.01, 0.007, 0.011],
      edge,
    );
  }
  for (const s of [-1, 1]) {
    c.horn(
      [
        [s * 0.038, 1.609, 0.136],
        [s * 0.074, 1.617, 0.119],
      ],
      [0.009, 0.003],
      0xced8ce,
    );
    c.horn(
      [
        [s * 0.138, 1.671, -0.02],
        [s * 0.197, 1.786, -0.023],
        [s * 0.195, 1.834, -0.04],
      ],
      [0.025, 0.014, 0.001],
      brass,
    );
  }
  for (const s of [-1, 1])
    c.horn(
      [
        [s * 0.13, 1.678, 0.092],
        [s * 0.093, 1.78, 0.085],
        [s * 0.047, 1.89, 0.062],
        [s * 0.014, 1.976, 0.03],
      ],
      [0.008, 0.008, 0.006, 0.002],
      brass,
    );
  for (const s of [-1, 1]) {
    c.horn(
      [
        [s * 0.132, 1.571, 0.097],
        [s * 0.094, 1.553, 0.14],
        [s * 0.054, 1.518, 0.164],
        [s * 0.017, 1.478, 0.154],
      ],
      [0.012, 0.009, 0.012, 0.006],
      edge,
    );
    for (let i = 0; i < 3; i++)
      c.horn(
        [
          [s * (0.089 - i * 0.014), 1.552 - i * 0.009, 0.144 + i * 0.006],
          [s * (0.091 - i * 0.014), 1.525 - i * 0.011, 0.151 + i * 0.006],
        ],
        [0.005, 0.0025],
        0x282b31,
      );
  }
  c.mount(rig, "head", "SextonIronCage");
  c.shell(
    [
      [1.032, 0.177, 0.14],
      [1.17, 0.212, 0.154],
      [1.35, 0.241, 0.161],
      [1.45, 0.123, 0.121],
      [1.455, 0.082, 0.093],
    ],
    0x505861,
    0,
    0.065,
  );
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++)
      c.bulb(
        [s * (0.181 + i * 0.026), 1.336 - i * 0.042, -0.006],
        [0.096, 0.075, 0.138],
        i % 2 ? 0x70777b : 0x535c64,
        s * -0.28,
      );
    for (let i = 0; i < 5; i++)
      c.bulb(
        [s * (0.18 - i * 0.032), 1.35 - i * 0.035, 0.135 + i * 0.003],
        [0.014, 0.021, 0.009],
        i % 2 ? brass : edge,
        s * 0.55,
      );
    c.feather(
      [s * 0.094, 1.285, 0.148],
      [s * 0.115, 0.934, 0.174],
      0.052,
      0x655454,
    );
  }
  c.horn(
    [
      [-0.11, 1.402, 0.128],
      [-0.083, 1.325, 0.157],
      [0, 1.244, 0.175],
      [0.061, 1.287, 0.165],
      [0.116, 1.401, 0.126],
    ],
    [0.011, 0.012, 0.01, 0.011, 0.009],
    0xb29c78,
  );
  c.bulb([0, 1.225, 0.18], [0.034, 0.044, 0.012], brass);
  c.horn(
    [
      [0, 1.196, 0.176],
      [0.008, 1.134, 0.174],
      [0.032, 1.13, 0.168],
    ],
    [0.008, 0.008, 0.005],
    edge,
  );
  c.mount(rig, "chest", "SextonGorget");
  c.shell(
    [
      [0.83, 0.184, 0.153],
      [0.91, 0.182, 0.147],
      [0.96, 0.172, 0.141],
    ],
    0x695c53,
    0,
    0.052,
    0.016,
  );
  c.bulb([0, 0.918, 0.149], [0.034, 0.028, 0.01], brass);
  c.mount(rig, "pelvis", "SextonBelt");
  for (const [s, side] of [
    [1, "L"],
    [-1, "R"],
  ] as const) {
    c.feather(
      [s * 0.099, 0.912, 0.14],
      [s * 0.125, 0.435, 0.115],
      0.082,
      0x6c4346,
    );
    c.feather(
      [s * 0.103, 0.884, 0.151],
      [s * 0.14, 0.522, 0.133],
      0.022,
      0x867458,
    );
    c.feather(
      [s * 0.13, 0.896, -0.14],
      [s * 0.16, 0.45, -0.146],
      0.084,
      0x474755,
    );
    c.mount(rig, "thigh_" + side, "SextonStole" + side);
    c.bulb([s * 0.107, 0.378, 0.045], [0.061, 0.135, 0.048], iron);
    c.horn(
      [
        [s * 0.108, 0.47, 0.089],
        [s * 0.111, 0.33, 0.09],
        [s * 0.116, 0.237, 0.07],
      ],
      [0.007, 0.009, 0.003],
      edge,
    );
    c.mount(rig, "shin_" + side, "SextonGreave" + side);
  }
}
function pilgrim(rig: T.Object3D, c: Carving) {
  // Open-front cowl preserves the original face and gaze.
  c.shell(
    [
      [1.418, 0.134, 0.126, -0.024],
      [1.53, 0.145, 0.139, -0.01],
      [1.65, 0.14, 0.145, -0.002],
      [1.74, 0.121, 0.128, -0.023],
      [1.783, 0.057, 0.085, -0.055],
      [1.786, 0.002, 0.003, -0.1],
    ],
    0x777e82,
    0.82,
    0.055,
    0.018,
  );
  c.horn(
    [
      [-0.119, 1.495, 0.085],
      [-0.099, 1.63, 0.111],
      [-0.064, 1.713, 0.104],
      [0, 1.747, 0.089],
      [0.072, 1.704, 0.106],
      [0.11, 1.616, 0.102],
      [0.116, 1.504, 0.082],
    ],
    [0.012, 0.012, 0.015, 0.016, 0.013, 0.011, 0.009],
    0x9b9b90,
  );
  c.mount(rig, "head", "PilgrimAshCowl");
  c.shell(
    [
      [1.26, 0.243, 0.161],
      [1.34, 0.246, 0.155],
      [1.427, 0.143, 0.124],
      [1.455, 0.079, 0.092],
    ],
    0x76818a,
    0.34,
    0.065,
    0.026,
  );
  for (let i = 0; i < 11; i++) {
    const a = 1.18 + (i * (TAU - 2.36)) / 10;
    c.feather(
      [Math.sin(a) * 0.19, 1.34, Math.cos(a) * 0.14],
      [Math.sin(a) * 0.24, 1.1 - 0.12 * Math.sin(a / 2), Math.cos(a) * 0.183],
      0.03,
      i % 3 === 0 ? 0x69727b : 0x626b74,
    );
  }
  c.bulb([0.107, 1.348, 0.135], [0.023, 0.029, 0.012], 0xb7a079);
  c.mount(rig, "chest", "PilgrimMantle");
}
export function dressProcession(rig: T.Object3D, kind: AppearanceKind) {
  if (kind === "gaoler") return;
  const c = new Carving();
  if (kind === "pilgrim") pilgrim(rig, c);
  else {
    const face = rig.getObjectByName(`fixes2_${kind}_face`);
    if (face) face.visible = false;
    if (kind === "effigy") singer(rig, c);
    else if (kind === "watcher") sexton(rig, c);
  }
}
